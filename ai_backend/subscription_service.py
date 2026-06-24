from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Header, HTTPException

from plan_config import PLAN_CONFIG, USAGE_ERRORS


class UsageLimitError(Exception):
    def __init__(self, kind: str, intent: Optional[str] = None) -> None:
        self.kind = kind
        self.code = {
            "chat_message": "CHAT_LIMIT_REACHED",
            "upload": "UPLOAD_LIMIT_REACHED",
            "generated_plan": "PLAN_LIMIT_REACHED",
        }[kind]
        self.message = USAGE_ERRORS[kind]
        self.intent = intent
        super().__init__(self.message)

try:
    from supabase import create_client
except Exception:  # pragma: no cover
    create_client = None


def _client():
    url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")).strip()
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY", "")).strip()
    if not url or not key or create_client is None:
        return None
    return create_client(url, key)


async def authenticated_user(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Authentication required.")
    token = authorization.split(" ", 1)[1].strip()
    client = _client()
    if client is None:
        raise HTTPException(503, "Subscription service is not configured.")
    try:
        result = client.auth.get_user(token)
        user = result.user
        if not user:
            raise ValueError("missing user")
        return {"id": str(user.id), "email": user.email or ""}
    except Exception as exc:
        raise HTTPException(401, "Invalid or expired session.") from exc


def ensure_subscription(user_id: str) -> dict[str, Any]:
    client = _client()
    if client is None:
        raise HTTPException(503, "Subscription service is not configured.")
    try:
        response = client.rpc("ensure_user_subscription", {"p_user_id": user_id}).execute()
        row = response.data[0] if isinstance(response.data, list) else response.data
        return row or {}
    except Exception as exc:
        raise HTTPException(503, "Unable to load subscription.") from exc


def subscription_payload(row: dict[str, Any]) -> dict[str, Any]:
    admin = bool(row.get("is_admin"))
    return {
        "plan": row.get("subscription_plan", "free"),
        "status": row.get("subscription_status", "active"),
        "currentPeriodStart": row.get("current_period_start"),
        "currentPeriodEnd": row.get("current_period_end"),
        "isUnlimited": admin,
        "usage": {
            "uploadsUsed": int(row.get("uploads_used", 0)),
            "uploadsLimit": None if admin else int(row.get("uploads_limit", 2)),
            "chatMessagesUsed": int(row.get("chat_messages_used", 0)),
            "chatMessagesLimit": None if admin else int(row.get("chat_messages_limit", 30)),
            "generatedPlansUsed": int(row.get("generated_plans_used", 0)),
            "generatedPlansLimit": None if admin else int(row.get("generated_plans_limit", 1)),
        },
    }


def consume_usage(user_id: str, kind: str, idempotency_key: Optional[str] = None) -> dict[str, Any]:
    if kind not in USAGE_ERRORS:
        raise HTTPException(400, "Unknown usage type.")
    client = _client()
    if client is None:
        raise HTTPException(503, "Subscription service is not configured.")
    try:
        result = client.rpc("consume_subscription_credit", {
            "p_user_id": user_id,
            "p_kind": kind,
            "p_idempotency_key": idempotency_key,
        }).execute()
        data = result.data or {}
        if isinstance(data, list):
            data = data[0] if data else {}
        if not data.get("allowed", False):
            raise UsageLimitError(kind)
        return data
    except UsageLimitError:
        raise
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Unable to verify plan credits.") from exc


def check_usage(user_id: str, kind: str, amount: int = 1) -> dict[str, Any]:
    row = ensure_subscription(user_id)
    if bool(row.get("is_admin")):
        return row
    if amount <= 0:
        return row
    fields = {
        "chat_message": ("chat_messages_used", "chat_messages_limit"),
        "upload": ("uploads_used", "uploads_limit"),
        "generated_plan": ("generated_plans_used", "generated_plans_limit"),
    }
    if kind not in fields:
        raise HTTPException(400, "Unknown usage type.")
    used_field, limit_field = fields[kind]
    if int(row.get(used_field, 0)) + amount > int(row.get(limit_field, 0)):
        raise UsageLimitError(kind)
    return row


def apply_plan(user_id: str, plan: str, status: str, customer_id: Optional[str], subscription_id: Optional[str],
               period_start: Optional[datetime], period_end: Optional[datetime]) -> None:
    client = _client()
    if client is None:
        raise HTTPException(503, "Subscription service is not configured.")
    config = PLAN_CONFIG.get(plan, PLAN_CONFIG["free"])
    existing = ensure_subscription(user_id)
    old_start = existing.get("current_period_start")
    new_start = period_start.isoformat() if period_start else existing.get("current_period_start")
    reset = bool(new_start and old_start and str(new_start) != str(old_start))
    values: dict[str, Any] = {
        "subscription_plan": plan,
        "subscription_status": status,
        "payment_provider": "paypal",
        "provider_customer_id": customer_id,
        "provider_subscription_id": subscription_id,
        "current_period_start": new_start,
        "current_period_end": period_end.isoformat() if period_end else existing.get("current_period_end"),
        **{k: config[k] for k in ("uploads_limit", "chat_messages_limit", "generated_plans_limit")},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if reset:
        values.update(uploads_used=0, chat_messages_used=0, generated_plans_used=0)
    client.table("user_subscriptions").update(values).eq("user_id", user_id).execute()
