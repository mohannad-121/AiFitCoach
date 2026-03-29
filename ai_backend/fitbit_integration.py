from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode

import requests

from supabase_context import SupabaseContextRepository


logger = logging.getLogger(__name__)

FITBIT_AUTH_URL = "https://www.fitbit.com/oauth2/authorize"
FITBIT_TOKEN_URL = "https://api.fitbit.com/oauth2/token"
FITBIT_REVOKE_URL = "https://api.fitbit.com/oauth2/revoke"
FITBIT_PROFILE_URL = "https://api.fitbit.com/1/user/-/profile.json"
FITBIT_ACTIVITY_BY_DATE_URL = "https://api.fitbit.com/1/user/-/activities/date/{day}.json"
FITBIT_HEART_BY_DATE_URL = "https://api.fitbit.com/1/user/-/activities/heart/date/{day}/1d.json"
FITBIT_SLEEP_BY_DATE_URL = "https://api.fitbit.com/1.2/user/-/sleep/date/{day}.json"
FITBIT_SERIES_URL = "https://api.fitbit.com/1/user/-/{resource_path}/date/today/{period}.json"
DEFAULT_SCOPES = "activity heartrate profile sleep"
STATE_TTL_MINUTES = 15
AUTO_SYNC_INTERVAL_MINUTES = 30
DEFAULT_HISTORY_DAYS = 7


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _safe_json_loads(value: Any, fallback: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if value in (None, ""):
        return fallback
    try:
        return json.loads(str(value))
    except Exception:
        return fallback


class FitbitConnectionStore:
    def __init__(self, supabase_context: SupabaseContextRepository, fallback_path: Path) -> None:
        self.supabase_context = supabase_context
        self.fallback_path = Path(fallback_path)
        self.fallback_path.parent.mkdir(parents=True, exist_ok=True)

    def _load_file(self) -> dict[str, dict[str, Any]]:
        if not self.fallback_path.exists():
            return {}
        try:
            payload = json.loads(self.fallback_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                return {str(key): value for key, value in payload.items() if isinstance(value, dict)}
        except Exception:
            logger.warning("Failed loading Fitbit fallback store", exc_info=True)
        return {}

    def _save_file(self, data: dict[str, dict[str, Any]]) -> None:
        self.fallback_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def get(self, user_id: str) -> Optional[dict[str, Any]]:
        user_id = str(user_id or "").strip()
        if not user_id:
            return None

        client = self.supabase_context.client
        if client is not None:
            try:
                response = client.table("fitbit_connections").select("*").eq("user_id", user_id).limit(1).execute()
                rows = getattr(response, "data", None) or []
                if rows:
                    row = rows[0]
                    if isinstance(row, dict):
                        return self._normalize_row(row)
            except Exception:
                logger.warning("Failed reading Fitbit connection from Supabase", exc_info=True)

        return self._load_file().get(user_id)

    def upsert(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        user_id = str(user_id or "").strip()
        if not user_id:
            raise ValueError("user_id is required")

        now_iso = _utc_now().isoformat()
        record = {
            "user_id": user_id,
            "provider": "fitbit",
            "access_token": payload.get("access_token", ""),
            "refresh_token": payload.get("refresh_token", ""),
            "token_type": payload.get("token_type", "Bearer"),
            "scope": payload.get("scope", ""),
            "expires_at": payload.get("expires_at"),
            "fitbit_user_id": payload.get("fitbit_user_id", ""),
            "profile_data": payload.get("profile_data") or {},
            "last_sync_data": payload.get("last_sync_data") or {},
            "last_sync_at": payload.get("last_sync_at"),
            "created_at": payload.get("created_at") or now_iso,
            "updated_at": now_iso,
        }

        client = self.supabase_context.client
        if client is not None:
            try:
                client.table("fitbit_connections").upsert(
                    record,
                    on_conflict="user_id",
                ).execute()
                return record
            except Exception:
                logger.warning("Failed writing Fitbit connection to Supabase", exc_info=True)

        all_records = self._load_file()
        existing = all_records.get(user_id, {})
        merged = {**existing, **record}
        all_records[user_id] = merged
        self._save_file(all_records)
        return merged

    def delete(self, user_id: str) -> None:
        user_id = str(user_id or "").strip()
        if not user_id:
            return

        client = self.supabase_context.client
        if client is not None:
            try:
                client.table("fitbit_connections").delete().eq("user_id", user_id).execute()
                return
            except Exception:
                logger.warning("Failed deleting Fitbit connection from Supabase", exc_info=True)

        all_records = self._load_file()
        if user_id in all_records:
            del all_records[user_id]
            self._save_file(all_records)

    def _normalize_row(self, row: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(row)
        normalized["profile_data"] = _safe_json_loads(normalized.get("profile_data"), {})
        normalized["last_sync_data"] = _safe_json_loads(normalized.get("last_sync_data"), {})
        return normalized


class FitbitIntegration:
    def __init__(self, supabase_context: SupabaseContextRepository, fallback_path: Path) -> None:
        self.client_id = str(os.getenv("FITBIT_CLIENT_ID", "")).strip()
        self.client_secret = str(os.getenv("FITBIT_CLIENT_SECRET", "")).strip()
        self.redirect_uri = str(os.getenv("FITBIT_REDIRECT_URI", "")).strip()
        self.frontend_redirect_uri = str(os.getenv("FITBIT_FRONTEND_REDIRECT_URI", "")).strip()
        self.scope = " ".join(str(os.getenv("FITBIT_SCOPES", DEFAULT_SCOPES)).split())
        self.state_secret = str(os.getenv("FITBIT_STATE_SECRET", "")).strip() or self.client_secret
        self.store = FitbitConnectionStore(supabase_context, fallback_path)

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.redirect_uri and self.state_secret)

    def begin_auth(self, user_id: str, frontend_redirect: Optional[str] = None) -> str:
        if not self.configured:
            raise ValueError("Fitbit integration is not configured on the backend")

        final_frontend_redirect = str(frontend_redirect or self.frontend_redirect_uri or "").strip()
        if not final_frontend_redirect:
            final_frontend_redirect = "http://localhost:8080/profile"

        state = self._sign_state(
            {
                "user_id": str(user_id or "").strip(),
                "frontend_redirect": final_frontend_redirect,
                "issued_at": _utc_now().isoformat(),
            }
        )
        query = urlencode(
            {
                "client_id": self.client_id,
                "response_type": "code",
                "redirect_uri": self.redirect_uri,
                "scope": self.scope,
                "expires_in": 604800,
                "state": state,
            }
        )
        return f"{FITBIT_AUTH_URL}?{query}"

    def handle_callback(self, code: Optional[str], state: Optional[str], error: Optional[str] = None) -> str:
        payload = self._verify_state(state)
        frontend_redirect = str(payload.get("frontend_redirect") or self.frontend_redirect_uri or "http://localhost:8080/profile")

        if error:
            return self._append_query(frontend_redirect, fitbit="error", fitbit_message=error)
        if not code:
            return self._append_query(frontend_redirect, fitbit="error", fitbit_message="Missing authorization code")

        try:
            token_payload = self._exchange_code(code)
            profile_payload = self._fetch_profile(token_payload["access_token"])
            sync_payload = self._fetch_sync_payload(token_payload["access_token"])
            expires_at = (_utc_now() + timedelta(seconds=max(0, int(token_payload.get("expires_in") or 0)))).isoformat()
            self.store.upsert(
                str(payload.get("user_id") or ""),
                {
                    "access_token": token_payload.get("access_token", ""),
                    "refresh_token": token_payload.get("refresh_token", ""),
                    "token_type": token_payload.get("token_type", "Bearer"),
                    "scope": token_payload.get("scope", self.scope),
                    "expires_at": expires_at,
                    "fitbit_user_id": token_payload.get("user_id") or profile_payload.get("encodedId") or "",
                    "profile_data": self._normalize_profile(profile_payload),
                    "last_sync_data": sync_payload,
                    "last_sync_at": _utc_now().isoformat(),
                },
            )
            return self._append_query(frontend_redirect, fitbit="connected")
        except Exception as exc:
            logger.warning("Fitbit callback failed: %s", exc, exc_info=True)
            return self._append_query(frontend_redirect, fitbit="error", fitbit_message=str(exc))

    def get_status(self, user_id: str) -> dict[str, Any]:
        if not self.configured:
            return {"configured": False, "connected": False}

        record = self.store.get(user_id)
        if not record:
            return {"configured": True, "connected": False}

        return self._status_payload(record)

    def get_coach_tracking_summary(self, user_id: str) -> Optional[dict[str, Any]]:
        if not self.configured:
            return None

        record = self.store.get(user_id)
        if not record:
            return {"fitbit": self._coach_payload(None)}

        try:
            if self._should_auto_sync(record):
                record = self._sync_record(user_id, record)
        except Exception:
            logger.warning("Failed auto-syncing Fitbit coach context", exc_info=True)

        return {"fitbit": self._coach_payload(record)}

    def sync(self, user_id: str) -> dict[str, Any]:
        if not self.configured:
            raise ValueError("Fitbit integration is not configured on the backend")

        record = self.store.get(user_id)
        if not record:
            raise ValueError("No Fitbit connection found for this user")

        updated = self._sync_record(user_id, record)
        return self._status_payload(updated)

    def disconnect(self, user_id: str) -> None:
        record = self.store.get(user_id)
        if record and record.get("access_token"):
            try:
                self._revoke_token(record["access_token"])
            except Exception:
                logger.warning("Failed revoking Fitbit token", exc_info=True)
        self.store.delete(user_id)

    def _sign_state(self, payload: dict[str, Any]) -> str:
        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, sort_keys=True)
        signature = hmac.new(self.state_secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
        token = json.dumps({"payload": payload, "sig": signature}, separators=(",", ":"), ensure_ascii=False)
        return base64.urlsafe_b64encode(token.encode("utf-8")).decode("utf-8")

    def _verify_state(self, state: Optional[str]) -> dict[str, Any]:
        if not state:
            raise ValueError("Missing Fitbit state")
        try:
            decoded = base64.urlsafe_b64decode(state.encode("utf-8")).decode("utf-8")
            token = json.loads(decoded)
        except Exception as exc:
            raise ValueError("Invalid Fitbit state") from exc

        payload = token.get("payload") if isinstance(token, dict) else None
        signature = token.get("sig") if isinstance(token, dict) else None
        if not isinstance(payload, dict) or not isinstance(signature, str):
            raise ValueError("Invalid Fitbit state payload")

        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, sort_keys=True)
        expected = hmac.new(self.state_secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Fitbit state signature mismatch")

        issued_at = _parse_iso_datetime(payload.get("issued_at"))
        if issued_at is None or (_utc_now() - issued_at) > timedelta(minutes=STATE_TTL_MINUTES):
            raise ValueError("Fitbit state expired")
        if not str(payload.get("user_id") or "").strip():
            raise ValueError("Fitbit state is missing the user id")
        return payload

    def _exchange_code(self, code: str) -> dict[str, Any]:
        response = requests.post(
            FITBIT_TOKEN_URL,
            headers=self._token_headers(),
            data={
                "client_id": self.client_id,
                "grant_type": "authorization_code",
                "redirect_uri": self.redirect_uri,
                "code": code,
            },
            timeout=20,
        )
        payload = self._parse_fitbit_response(response)
        if not payload.get("access_token"):
            raise ValueError("Fitbit did not return an access token")
        return payload

    def _refresh_if_needed(self, record: dict[str, Any]) -> dict[str, Any]:
        expires_at = _parse_iso_datetime(record.get("expires_at"))
        if expires_at and expires_at > (_utc_now() + timedelta(minutes=2)):
            return record
        refresh_token = str(record.get("refresh_token") or "").strip()
        if not refresh_token:
            raise ValueError("Fitbit refresh token is missing")

        response = requests.post(
            FITBIT_TOKEN_URL,
            headers=self._token_headers(),
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            timeout=20,
        )
        payload = self._parse_fitbit_response(response)
        updated = {
            **record,
            "access_token": payload.get("access_token", record.get("access_token", "")),
            "refresh_token": payload.get("refresh_token", refresh_token),
            "token_type": payload.get("token_type", record.get("token_type", "Bearer")),
            "scope": payload.get("scope", record.get("scope", self.scope)),
            "expires_at": (_utc_now() + timedelta(seconds=max(0, int(payload.get("expires_in") or 0)))).isoformat(),
        }
        return self.store.upsert(str(record.get("user_id") or ""), updated)

    def _sync_record(self, user_id: str, record: dict[str, Any]) -> dict[str, Any]:
        record = self._refresh_if_needed(record)
        profile_payload = self._fetch_profile(record["access_token"])
        sync_payload = self._fetch_sync_payload(record["access_token"])
        return self.store.upsert(
            user_id,
            {
                **record,
                "fitbit_user_id": record.get("fitbit_user_id") or profile_payload.get("encodedId") or "",
                "profile_data": self._normalize_profile(profile_payload),
                "last_sync_data": sync_payload,
                "last_sync_at": _utc_now().isoformat(),
            },
        )

    def _should_auto_sync(self, record: dict[str, Any]) -> bool:
        last_sync_at = _parse_iso_datetime(record.get("last_sync_at"))
        last_sync_data = record.get("last_sync_data") if isinstance(record.get("last_sync_data"), dict) else {}
        if not last_sync_data:
            return True
        if last_sync_at is None:
            return True
        return (_utc_now() - last_sync_at) >= timedelta(minutes=AUTO_SYNC_INTERVAL_MINUTES)

    def _fetch_profile(self, access_token: str) -> dict[str, Any]:
        response = requests.get(FITBIT_PROFILE_URL, headers=self._bearer_headers(access_token), timeout=20)
        payload = self._parse_fitbit_response(response)
        user_payload = payload.get("user") if isinstance(payload.get("user"), dict) else None
        if not user_payload:
            raise ValueError("Fitbit profile data is missing")
        return user_payload

    def _fetch_sync_payload(self, access_token: str) -> dict[str, Any]:
        today_summary = self._fetch_today_summary(access_token)
        activity_history = self._fetch_activity_history(access_token)
        heart_history = self._fetch_heart_history(access_token)
        sleep_history = self._fetch_sleep_history(access_token)
        return {
            "synced_at": _utc_now().isoformat(),
            "today_summary": today_summary,
            "activity_history": activity_history,
            "heart_history": heart_history,
            "sleep_history": sleep_history,
        }

    def _fetch_today_summary(self, access_token: str) -> dict[str, Any]:
        today = date.today().isoformat()
        activity_response = requests.get(
            FITBIT_ACTIVITY_BY_DATE_URL.format(day=today),
            headers=self._bearer_headers(access_token),
            timeout=20,
        )
        heart_response = requests.get(
            FITBIT_HEART_BY_DATE_URL.format(day=today),
            headers=self._bearer_headers(access_token),
            timeout=20,
        )
        activity_payload = self._parse_fitbit_response(activity_response)
        heart_payload = self._parse_fitbit_response(heart_response)

        summary = activity_payload.get("summary") if isinstance(activity_payload.get("summary"), dict) else {}
        distances = summary.get("distances") if isinstance(summary.get("distances"), list) else []
        total_distance = 0.0
        for item in distances:
            if isinstance(item, dict) and item.get("activity") == "total":
                try:
                    total_distance = float(item.get("distance") or 0.0)
                except (TypeError, ValueError):
                    total_distance = 0.0
                break

        resting_heart_rate = None
        activities_heart = heart_payload.get("activities-heart") if isinstance(heart_payload.get("activities-heart"), list) else []
        if activities_heart:
            value = activities_heart[0].get("value") if isinstance(activities_heart[0], dict) else None
            if isinstance(value, dict):
                resting_heart_rate = value.get("restingHeartRate")

        return {
            "date": today,
            "steps": int(summary.get("steps") or 0),
            "calories_out": int(summary.get("caloriesOut") or 0),
            "distance_km": round(total_distance, 2),
            "fairly_active_minutes": int(summary.get("fairlyActiveMinutes") or 0),
            "very_active_minutes": int(summary.get("veryActiveMinutes") or 0),
            "lightly_active_minutes": int(summary.get("lightlyActiveMinutes") or 0),
            "sedentary_minutes": int(summary.get("sedentaryMinutes") or 0),
            "resting_heart_rate": int(resting_heart_rate) if resting_heart_rate else None,
        }

    def _fetch_activity_history(self, access_token: str) -> list[dict[str, Any]]:
        metric_specs = {
            "steps": ("activities/steps", int),
            "calories_out": ("activities/calories", int),
            "distance_km": ("activities/distance", float),
            "very_active_minutes": ("activities/minutesVeryActive", int),
            "fairly_active_minutes": ("activities/minutesFairlyActive", int),
            "lightly_active_minutes": ("activities/minutesLightlyActive", int),
            "sedentary_minutes": ("activities/minutesSedentary", int),
        }
        by_date: dict[str, dict[str, Any]] = {}

        for metric_name, (resource_path, parser) in metric_specs.items():
            response = requests.get(
                FITBIT_SERIES_URL.format(resource_path=resource_path, period=f"{DEFAULT_HISTORY_DAYS}d"),
                headers=self._bearer_headers(access_token),
                timeout=20,
            )
            payload = self._parse_fitbit_response(response)
            series = next((value for value in payload.values() if isinstance(value, list)), [])
            for item in series:
                if not isinstance(item, dict):
                    continue
                day = str(item.get("dateTime") or "").strip()
                if not day:
                    continue
                entry = by_date.setdefault(day, {"date": day})
                raw_value = item.get("value")
                try:
                    parsed_value = parser(raw_value or 0)
                except (TypeError, ValueError):
                    parsed_value = 0.0 if parser is float else 0
                if metric_name == "distance_km":
                    entry[metric_name] = round(float(parsed_value), 2)
                else:
                    entry[metric_name] = int(parsed_value)

        return [by_date[key] for key in sorted(by_date.keys())]

    def _fetch_heart_history(self, access_token: str) -> list[dict[str, Any]]:
        response = requests.get(
            FITBIT_SERIES_URL.format(resource_path="activities/heart", period=f"{DEFAULT_HISTORY_DAYS}d"),
            headers=self._bearer_headers(access_token),
            timeout=20,
        )
        payload = self._parse_fitbit_response(response)
        series = payload.get("activities-heart") if isinstance(payload.get("activities-heart"), list) else []
        history: list[dict[str, Any]] = []
        for item in series:
            if not isinstance(item, dict):
                continue
            value = item.get("value") if isinstance(item.get("value"), dict) else {}
            zones = value.get("heartRateZones") if isinstance(value.get("heartRateZones"), list) else []
            history.append(
                {
                    "date": item.get("dateTime"),
                    "resting_heart_rate": value.get("restingHeartRate"),
                    "heart_rate_zones": [zone for zone in zones if isinstance(zone, dict)],
                }
            )
        return history

    def _fetch_sleep_history(self, access_token: str) -> list[dict[str, Any]]:
        history: list[dict[str, Any]] = []
        for offset in range(DEFAULT_HISTORY_DAYS - 1, -1, -1):
            day = (date.today() - timedelta(days=offset)).isoformat()
            response = requests.get(
                FITBIT_SLEEP_BY_DATE_URL.format(day=day),
                headers=self._bearer_headers(access_token),
                timeout=20,
            )
            payload = self._parse_fitbit_response(response)
            history.append(self._normalize_sleep_day(day, payload))
        return history

    def _normalize_sleep_day(self, day: str, payload: dict[str, Any]) -> dict[str, Any]:
        sleep_entries = payload.get("sleep") if isinstance(payload.get("sleep"), list) else []
        summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
        main_sleep = next(
            (
                entry
                for entry in sleep_entries
                if isinstance(entry, dict) and entry.get("isMainSleep")
            ),
            sleep_entries[0] if sleep_entries and isinstance(sleep_entries[0], dict) else {},
        )
        levels = main_sleep.get("levels") if isinstance(main_sleep.get("levels"), dict) else {}
        level_summary = levels.get("summary") if isinstance(levels.get("summary"), dict) else {}

        def _stage_minutes(stage_name: str) -> int:
            stage_payload = level_summary.get(stage_name) if isinstance(level_summary.get(stage_name), dict) else {}
            try:
                return int(stage_payload.get("minutes") or 0)
            except (TypeError, ValueError):
                return 0

        try:
            minutes_asleep = int(summary.get("totalMinutesAsleep") or 0)
        except (TypeError, ValueError):
            minutes_asleep = 0
        try:
            time_in_bed = int(summary.get("totalTimeInBed") or 0)
        except (TypeError, ValueError):
            time_in_bed = 0

        return {
            "date": day,
            "minutes_asleep": minutes_asleep,
            "time_in_bed": time_in_bed,
            "efficiency": main_sleep.get("efficiency") or summary.get("efficiency"),
            "start_time": main_sleep.get("startTime"),
            "end_time": main_sleep.get("endTime"),
            "minutes_awake": _stage_minutes("wake"),
            "minutes_deep": _stage_minutes("deep"),
            "minutes_light": _stage_minutes("light"),
            "minutes_rem": _stage_minutes("rem"),
        }

    def _revoke_token(self, access_token: str) -> None:
        requests.post(
            FITBIT_REVOKE_URL,
            headers=self._token_headers(),
            data={"token": access_token},
            timeout=20,
        )

    def _token_headers(self) -> dict[str, str]:
        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode("utf-8")).decode("utf-8")
        return {
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        }

    def _bearer_headers(self, access_token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {access_token}"}

    def _parse_fitbit_response(self, response: requests.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except Exception as exc:
            raise ValueError(f"Fitbit returned a non-JSON response ({response.status_code})") from exc
        if response.ok:
            return payload if isinstance(payload, dict) else {}

        errors = payload.get("errors") if isinstance(payload, dict) else None
        if isinstance(errors, list) and errors:
            message = errors[0].get("message") or errors[0].get("errorType") or response.reason
        else:
            message = response.reason or "Fitbit request failed"
        raise ValueError(str(message))

    def _normalize_profile(self, profile_payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "fitbit_user_id": profile_payload.get("encodedId") or "",
            "display_name": profile_payload.get("displayName") or profile_payload.get("fullName") or "",
            "avatar_url": profile_payload.get("avatar150") or profile_payload.get("avatar") or "",
            "member_since": profile_payload.get("memberSince") or "",
            "age": profile_payload.get("age"),
            "gender": profile_payload.get("gender") or "",
            "height_cm": profile_payload.get("height"),
            "weight_kg": profile_payload.get("weight"),
            "timezone": profile_payload.get("timezone") or "",
        }

    def _status_payload(self, record: dict[str, Any]) -> dict[str, Any]:
        profile_data = record.get("profile_data") if isinstance(record.get("profile_data"), dict) else {}
        last_sync_data = record.get("last_sync_data") if isinstance(record.get("last_sync_data"), dict) else {}
        today_summary = last_sync_data.get("today_summary") if isinstance(last_sync_data.get("today_summary"), dict) else last_sync_data
        return {
            "configured": True,
            "connected": True,
            "fitbit_user_id": record.get("fitbit_user_id") or profile_data.get("fitbit_user_id") or "",
            "scope": [part for part in str(record.get("scope") or "").split() if part],
            "expires_at": record.get("expires_at"),
            "last_sync_at": record.get("last_sync_at"),
            "profile": profile_data,
            "today_summary": today_summary,
            "fitbit_data": last_sync_data,
        }

    def _coach_payload(self, record: Optional[dict[str, Any]]) -> dict[str, Any]:
        if not record:
            return {
                "configured": True,
                "connected": False,
                "scope": [],
                "last_sync_at": None,
                "profile": {},
                "today_summary": {},
                "activity_history": [],
                "heart_history": [],
                "sleep_history": [],
                "coach_summary": {},
            }

        profile_data = record.get("profile_data") if isinstance(record.get("profile_data"), dict) else {}
        sync_data = record.get("last_sync_data") if isinstance(record.get("last_sync_data"), dict) else {}
        activity_history = sync_data.get("activity_history") if isinstance(sync_data.get("activity_history"), list) else []
        heart_history = sync_data.get("heart_history") if isinstance(sync_data.get("heart_history"), list) else []
        sleep_history = sync_data.get("sleep_history") if isinstance(sync_data.get("sleep_history"), list) else []
        today_summary = sync_data.get("today_summary") if isinstance(sync_data.get("today_summary"), dict) else {}

        def _avg(values: list[float]) -> Optional[float]:
            return round(sum(values) / len(values), 2) if values else None

        steps_values = [float(item.get("steps") or 0) for item in activity_history if isinstance(item, dict)]
        calories_values = [float(item.get("calories_out") or 0) for item in activity_history if isinstance(item, dict)]
        sleep_values = [float(item.get("minutes_asleep") or 0) for item in sleep_history if isinstance(item, dict) and item.get("minutes_asleep") is not None]
        resting_hr_values = [
            float(item.get("resting_heart_rate"))
            for item in heart_history
            if isinstance(item, dict) and item.get("resting_heart_rate") is not None
        ]
        very_active_total = sum(int(item.get("very_active_minutes") or 0) for item in activity_history if isinstance(item, dict))
        fairly_active_total = sum(int(item.get("fairly_active_minutes") or 0) for item in activity_history if isinstance(item, dict))

        return {
            "configured": True,
            "connected": True,
            "scope": [part for part in str(record.get("scope") or "").split() if part],
            "last_sync_at": record.get("last_sync_at"),
            "profile": profile_data,
            "today_summary": today_summary,
            "activity_history": activity_history,
            "heart_history": heart_history,
            "sleep_history": sleep_history,
            "coach_summary": {
                "avg_steps_7d": _avg(steps_values),
                "avg_calories_out_7d": _avg(calories_values),
                "avg_sleep_hours_7d": round((_avg(sleep_values) or 0) / 60, 2) if sleep_values else None,
                "avg_resting_heart_rate_7d": _avg(resting_hr_values),
                "total_very_active_minutes_7d": very_active_total,
                "total_fairly_active_minutes_7d": fairly_active_total,
            },
        }

    def _append_query(self, url: str, **params: str) -> str:
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}{urlencode(params)}"


__all__ = ["FitbitIntegration"]