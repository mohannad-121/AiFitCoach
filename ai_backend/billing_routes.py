from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from plan_config import PLAN_CONFIG
from subscription_service import _client, apply_plan, authenticated_user, ensure_subscription, subscription_payload

logger = logging.getLogger(__name__)
router = APIRouter()


class CheckoutRequest(BaseModel):
    plan: str


def _base_url() -> str:
    return "https://api-m.paypal.com" if os.getenv("PAYPAL_ENVIRONMENT", "sandbox").lower() == "live" else "https://api-m.sandbox.paypal.com"


def _access_token() -> str:
    client_id = os.getenv("PAYPAL_CLIENT_ID", "").strip()
    secret = os.getenv("PAYPAL_CLIENT_SECRET", "").strip()
    if not client_id or not secret:
        raise HTTPException(503, "PayPal Business is not configured.")
    try:
        response = requests.post(f"{_base_url()}/v1/oauth2/token", auth=(client_id, secret),
                                 data={"grant_type": "client_credentials"}, timeout=20)
        response.raise_for_status()
        return response.json()["access_token"]
    except requests.RequestException as exc:
        logger.exception("PayPal authentication failed")
        raise HTTPException(502, "Unable to connect to PayPal.") from exc


def _paypal(method: str, path: str, *, json: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        response = requests.request(method, f"{_base_url()}{path}", json=json, timeout=25, headers={
            "Authorization": f"Bearer {_access_token()}", "Content-Type": "application/json",
            "Accept": "application/json", "PayPal-Request-Id": os.urandom(16).hex(),
        })
        if response.status_code >= 400:
            logger.error("PayPal API %s %s failed: %s", method, path, response.text[:1000])
            raise HTTPException(502, "PayPal could not complete this request.")
        return response.json() if response.content else {}
    except requests.RequestException as exc:
        raise HTTPException(502, "Unable to connect to PayPal.") from exc


@router.get("/api/subscription/me")
async def get_subscription(user=Depends(authenticated_user)):
    return subscription_payload(ensure_subscription(user["id"]))


@router.post("/api/billing/create-checkout-session")
async def create_checkout(body: CheckoutRequest, user=Depends(authenticated_user)):
    if body.plan not in ("plus", "pro"):
        raise HTTPException(400, "Choose Plus or Pro.")
    plan_id = os.getenv(f"PAYPAL_{body.plan.upper()}_PLAN_ID", "").strip()
    if not plan_id:
        raise HTTPException(503, f"PayPal {body.plan.title()} plan is not configured.")
    frontend = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    data = _paypal("POST", "/v1/billing/subscriptions", json={
        "plan_id": plan_id,
        "custom_id": user["id"],
        "subscriber": {"email_address": user["email"]},
        "application_context": {
            "brand_name": "FitCoach AI", "user_action": "SUBSCRIBE_NOW", "shipping_preference": "NO_SHIPPING",
            "return_url": f"{frontend}/subscription?checkout=success",
            "cancel_url": f"{frontend}/subscription?checkout=canceled",
        },
    })
    approval = next((link["href"] for link in data.get("links", []) if link.get("rel") == "approve"), None)
    if not approval:
        raise HTTPException(502, "PayPal did not return an approval link.")
    return {"url": approval, "subscriptionId": data.get("id")}


@router.post("/api/billing/create-portal-session")
async def create_portal(user=Depends(authenticated_user)):
    row = ensure_subscription(user["id"])
    if not row.get("provider_subscription_id"):
        raise HTTPException(400, "No paid billing account exists yet.")
    return {"url": "https://www.paypal.com/myaccount/autopay/"}


@router.post("/api/billing/cancel-subscription")
async def cancel_subscription(user=Depends(authenticated_user)):
    row = ensure_subscription(user["id"])
    subscription_id = row.get("provider_subscription_id")
    if not subscription_id:
        raise HTTPException(400, "No active PayPal subscription exists.")
    _paypal("POST", f"/v1/billing/subscriptions/{subscription_id}/cancel", json={"reason": "Canceled by the FitCoach member."})
    return {"canceled": True, "message": "PayPal is processing the cancellation."}


def _parse_time(value: Any):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _sync_subscription(subscription: dict[str, Any]) -> None:
    user_id = subscription.get("custom_id")
    subscription_id = subscription.get("id")
    if not user_id and subscription_id:
        rows = _client().table("user_subscriptions").select("user_id").eq("provider_subscription_id", subscription_id).limit(1).execute().data
        user_id = rows[0]["user_id"] if rows else None
    if not user_id:
        logger.warning("PayPal subscription has no FitCoach user: %s", subscription_id)
        return
    plan_id = subscription.get("plan_id")
    plan = "pro" if plan_id == os.getenv("PAYPAL_PRO_PLAN_ID") else "plus"
    paypal_status = str(subscription.get("status") or "INACTIVE").upper()
    statuses = {"ACTIVE": "active", "APPROVAL_PENDING": "inactive", "SUSPENDED": "past_due",
                "CANCELLED": "canceled", "EXPIRED": "canceled"}
    status = statuses.get(paypal_status, "inactive")
    if paypal_status in ("CANCELLED", "EXPIRED"):
        existing = ensure_subscription(user_id)
        paid_until = _parse_time(existing.get("current_period_end"))
        if not paid_until or paid_until <= datetime.now(timezone.utc):
            plan = "free"
    billing = subscription.get("billing_info") or {}
    subscriber = subscription.get("subscriber") or {}
    apply_plan(user_id, plan, status, subscriber.get("payer_id"), subscription_id,
               _parse_time(billing.get("last_payment", {}).get("time")) or datetime.now(timezone.utc),
               _parse_time(billing.get("next_billing_time")))


async def _verified_webhook(request: Request) -> dict[str, Any]:
    event = await request.json()
    webhook_id = os.getenv("PAYPAL_WEBHOOK_ID", "").strip()
    if not webhook_id:
        raise HTTPException(503, "PayPal webhook is not configured.")
    verification = _paypal("POST", "/v1/notifications/verify-webhook-signature", json={
        "auth_algo": request.headers.get("paypal-auth-algo"),
        "cert_url": request.headers.get("paypal-cert-url"),
        "transmission_id": request.headers.get("paypal-transmission-id"),
        "transmission_sig": request.headers.get("paypal-transmission-sig"),
        "transmission_time": request.headers.get("paypal-transmission-time"),
        "webhook_id": webhook_id, "webhook_event": event,
    })
    if verification.get("verification_status") != "SUCCESS":
        raise HTTPException(400, "Invalid PayPal webhook signature.")
    return event


@router.post("/api/billing/webhook")
async def paypal_webhook(request: Request):
    event = await _verified_webhook(request)
    event_type = str(event.get("event_type") or "")
    if os.getenv("ENVIRONMENT", "development") == "development":
        logger.info("PayPal webhook: %s", event_type)
    resource = event.get("resource") or {}
    if event_type.startswith("BILLING.SUBSCRIPTION."):
        subscription_id = resource.get("id")
        subscription = _paypal("GET", f"/v1/billing/subscriptions/{subscription_id}") if subscription_id else resource
        _sync_subscription(subscription)
    elif event_type in ("PAYMENT.SALE.COMPLETED", "PAYMENT.SALE.DENIED", "PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"):
        subscription_id = resource.get("billing_agreement_id")
        if subscription_id:
            _sync_subscription(_paypal("GET", f"/v1/billing/subscriptions/{subscription_id}"))
    return {"received": True}
