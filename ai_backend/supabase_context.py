from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None  # type: ignore

try:
    from supabase import Client, create_client
except Exception:
    Client = Any  # type: ignore
    create_client = None  # type: ignore

from nlp_utils import repair_mojibake


logger = logging.getLogger(__name__)

NUTRITION_PREFIX = "\U0001F37D\uFE0F"
WORKOUT_REMINDER_TABLE = "workout_reminder_events"
WORKOUT_REMINDER_TYPE = "missed_workout"
DEFAULT_WORKOUT_REMINDER_CUTOFF_HOUR = 18
WORKOUT_ACTIVE_MINUTES_THRESHOLD = 45
WORKOUT_VERY_ACTIVE_MINUTES_THRESHOLD = 20
WORKOUT_HEART_ZONE_MINUTES_THRESHOLD = 25
DAY_NAME_TO_INDEX = {
    "sunday": 0,
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6,
    "الأحد": 0,
    "الاثنين": 1,
    "الثلاثاء": 2,
    "الأربعاء": 3,
    "الخميس": 4,
    "الجمعة": 5,
    "السبت": 6,
}


def _clean_text(value: Any) -> str:
    return repair_mojibake(str(value or "")).replace("\r", " ").replace("\n", " ").strip()


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _to_int(value: Any) -> int:
    parsed = _to_float(value)
    return int(parsed) if parsed is not None else 0


def _parse_datetime(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            return parsed.astimezone().replace(tzinfo=None)
        return parsed
    except ValueError:
        return None


def _to_iso_day(value: Any) -> Optional[str]:
    parsed = _parse_datetime(value)
    if parsed is not None:
        return parsed.date().isoformat()
    text = str(value or "").strip()
    if len(text) >= 10:
        return text[:10]
    return text or None


def _to_date(value: Any) -> Optional[date]:
    parsed = _parse_datetime(value)
    if parsed is not None:
        return parsed.date()
    text = str(value or "").strip()
    if len(text) >= 10:
        try:
            return datetime.fromisoformat(text[:10]).date()
        except ValueError:
            return None
    return None


def _is_nutrition_plan(title: Any) -> bool:
    return _clean_text(title).startswith(NUTRITION_PREFIX)


def _extract_plan_days(plan_data: Any) -> list[dict[str, Any]]:
    if isinstance(plan_data, list):
        return [item for item in plan_data if isinstance(item, dict)]
    if isinstance(plan_data, dict):
        days = plan_data.get("days")
        if isinstance(days, list):
            return [item for item in days if isinstance(item, dict)]
    return []


def _extract_plan_day_index(day_value: Any) -> int:
    token = _clean_text(day_value).lower().split(" - ")[0].split(" – ")[0].strip()
    return DAY_NAME_TO_INDEX.get(token, -1)


def _plan_day_has_exercises(day: dict[str, Any]) -> bool:
    return isinstance(day.get("exercises"), list) and bool(day.get("exercises"))


def _javascript_day_index(target_date: date) -> int:
    return (target_date.weekday() + 1) % 7


def _plan_applies_to_date(plan: dict[str, Any], target_date: date) -> bool:
    start_date = _to_date(plan.get("created_at"))
    if start_date is None:
        return True
    end_date = start_date + timedelta(days=6)
    return start_date <= target_date <= end_date


def _active_heart_zone_minutes(heart_zones: Any) -> int:
    if not isinstance(heart_zones, list):
        return 0

    active_zones = {"fat burn", "fatburn", "cardio", "peak"}
    total_minutes = 0
    for zone in heart_zones:
        if not isinstance(zone, dict):
            continue
        zone_name = _clean_text(zone.get("name")).lower().replace("-", " ")
        normalized_name = zone_name.replace("_", " ").replace("  ", " ").strip()
        compact_name = normalized_name.replace(" ", "")
        if normalized_name in active_zones or compact_name in active_zones:
            total_minutes += _to_int(zone.get("minutes"))
    return total_minutes


def _resolve_local_now(timezone_name: str) -> tuple[datetime, str]:
    cleaned = _clean_text(timezone_name) or "UTC"
    if ZoneInfo is not None:
        try:
            return datetime.now(ZoneInfo(cleaned)), cleaned
        except Exception:
            pass
    return datetime.now(timezone.utc), "UTC"


def _streak_days(day_values: list[str]) -> int:
    normalized_days = sorted({day for day in day_values if day}, reverse=True)
    if not normalized_days:
        return 0
    streak = 0
    expected = datetime.utcnow().date()
    first_day = normalized_days[0]
    try:
        first_date = datetime.fromisoformat(first_day).date()
    except ValueError:
        return 0

    if first_date < expected - timedelta(days=1):
        expected = first_date

    normalized_dates = []
    for day in normalized_days:
        try:
            normalized_dates.append(datetime.fromisoformat(day).date())
        except ValueError:
            continue

    for candidate in normalized_dates:
        if candidate == expected:
            streak += 1
            expected = expected - timedelta(days=1)
            continue
        if candidate > expected:
            continue
        break
    return streak


class SupabaseContextRepository:
    def __init__(self, url: str = "", key: str = "") -> None:
        self.url = str(url or "").strip()
        self.key = str(key or "").strip()
        self.client: Optional[Client] = None

        if not self.url or not self.key or create_client is None:
            return

        try:
            self.client = create_client(self.url, self.key)
        except Exception as exc:
            logger.warning("Failed creating Supabase client for backend context: %s", exc)
            self.client = None

    @property
    def enabled(self) -> bool:
        return self.client is not None

    def _fetch_rows(
        self,
        table: str,
        user_id: str,
        *,
        columns: str = "*",
        order_by: Optional[str] = None,
        descending: bool = False,
        limit: Optional[int] = None,
        extra_filters: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        if not self.client:
            return []

        try:
            query = self.client.table(table).select(columns).eq("user_id", user_id)
            for key, value in (extra_filters or {}).items():
                query = query.eq(key, value)
            if order_by:
                query = query.order(order_by, desc=descending)
            if limit:
                query = query.limit(limit)
            response = query.execute()
            data = getattr(response, "data", None) or []
            if isinstance(data, list):
                return [item for item in data if isinstance(item, dict)]
            if isinstance(data, dict):
                return [data]
        except Exception as exc:
            logger.warning("Supabase fetch failed for %s: %s", table, exc)
        return []

    def _load_profile(self, user_id: str) -> Optional[dict[str, Any]]:
        rows = self._fetch_rows("profiles", user_id, limit=1)
        if not rows:
            return None
        row = rows[0]
        profile = {
            "id": row.get("user_id") or user_id,
            "user_id": row.get("user_id") or user_id,
            "name": _clean_text(row.get("name")),
            "age": row.get("age"),
            "gender": _clean_text(row.get("gender")),
            "weight": row.get("weight"),
            "height": row.get("height"),
            "goal": _clean_text(row.get("goal")),
            "location": _clean_text(row.get("location")),
            "fitness_level": _clean_text(row.get("fitness_level") or row.get("fitnessLevel")),
            "training_days_per_week": row.get("training_days_per_week") or row.get("trainingDaysPerWeek"),
            "available_equipment": _clean_text(row.get("equipment") or row.get("available_equipment")),
            "equipment": _clean_text(row.get("equipment") or row.get("available_equipment")),
            "injuries": _clean_text(row.get("injuries")),
            "activity_level": _clean_text(row.get("activity_level") or row.get("activityLevel")),
            "dietary_preferences": row.get("dietary_preferences") or row.get("dietaryPreferences") or [],
            "chronic_diseases": row.get("chronic_conditions") or row.get("chronic_diseases") or [],
            "allergies": row.get("allergies") or [],
        }
        return {key: value for key, value in profile.items() if value not in (None, "", [])}

    def _build_plan_snapshot(self, plans: list[dict[str, Any]]) -> dict[str, Any]:
        workout_plans = [plan for plan in plans if not _is_nutrition_plan(plan.get("title")) and plan.get("is_active")]
        nutrition_plans = [plan for plan in plans if _is_nutrition_plan(plan.get("title")) and plan.get("is_active")]
        return {
            "active_workout_plans": len(workout_plans),
            "active_nutrition_plans": len(nutrition_plans),
            "workout_titles": [_clean_text(plan.get("title")) for plan in workout_plans if _clean_text(plan.get("title"))],
            "nutrition_titles": [_clean_text(plan.get("title")) for plan in nutrition_plans if _clean_text(plan.get("title"))],
            "updated_at": datetime.utcnow().isoformat(),
        }

    def _build_tracking_summary(
        self,
        profile: Optional[dict[str, Any]],
        plans: list[dict[str, Any]],
        completions: list[dict[str, Any]],
        daily_logs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        plans_by_id = {str(plan.get("id")): plan for plan in plans if plan.get("id")}
        total_tasks = 0
        total_workout_tasks = 0
        total_nutrition_tasks = 0
        for plan in plans:
            days = _extract_plan_days(plan.get("plan_data"))
            for day in days:
                exercise_count = len(day.get("exercises") or []) if isinstance(day.get("exercises"), list) else 0
                meal_count = len(day.get("meals") or []) if isinstance(day.get("meals"), list) else 0
                total_tasks += exercise_count + meal_count
                if _is_nutrition_plan(plan.get("title")):
                    total_nutrition_tasks += meal_count
                else:
                    total_workout_tasks += exercise_count

        completed_tasks = len(completions)
        adherence_score = min(1.0, completed_tasks / total_tasks) if total_tasks > 0 else 0.0
        workout_plans = [plan for plan in plans if not _is_nutrition_plan(plan.get("title"))]
        nutrition_plans = [plan for plan in plans if _is_nutrition_plan(plan.get("title"))]
        active_workout_plans = len([plan for plan in workout_plans if plan.get("is_active")]) or len(workout_plans)
        active_nutrition_plans = len([plan for plan in nutrition_plans if plan.get("is_active")]) or len(nutrition_plans)

        sorted_completions = sorted(
            completions,
            key=lambda item: _parse_datetime(item.get("completed_at") or item.get("log_date")) or datetime.min,
            reverse=True,
        )
        last_completed_at = sorted_completions[0].get("completed_at") if sorted_completions else None

        now = datetime.utcnow()
        seven_days_ago = now - timedelta(days=7)
        fourteen_days_ago = now - timedelta(days=14)
        completions_last_7 = [
            row
            for row in completions
            if (_parse_datetime(row.get("completed_at") or row.get("log_date")) or datetime.min) >= seven_days_ago
        ]
        completions_previous_7 = [
            row
            for row in completions
            if fourteen_days_ago <= (_parse_datetime(row.get("completed_at") or row.get("log_date")) or datetime.min) < seven_days_ago
        ]
        logs_last_7 = [row for row in daily_logs if (_parse_datetime(row.get("log_date")) or datetime.min) >= seven_days_ago]

        planned_workout_days: set[str] = set()
        planned_nutrition_days: set[str] = set()
        cadence_plans = [plan for plan in plans if plan.get("is_active")]
        for plan in cadence_plans or plans:
            for day_index, day in enumerate(_extract_plan_days(plan.get("plan_data"))):
                day_label = _clean_text(day.get("day") or day.get("dayAr") or day_index)
                if _is_nutrition_plan(plan.get("title")):
                    if isinstance(day.get("meals"), list) and day.get("meals"):
                        planned_nutrition_days.add(day_label)
                elif isinstance(day.get("exercises"), list) and day.get("exercises"):
                    planned_workout_days.add(day_label)

        completion_days = [_to_iso_day(row.get("log_date") or row.get("completed_at")) for row in completions_last_7]
        workout_log_days = [_to_iso_day(row.get("log_date")) for row in logs_last_7 if _clean_text(row.get("workout_notes"))]
        nutrition_log_days = [_to_iso_day(row.get("log_date")) for row in logs_last_7 if _clean_text(row.get("nutrition_notes"))]

        recent_completed_exercises: list[dict[str, Any]] = []
        for row in sorted_completions[:12]:
            plan = plans_by_id.get(str(row.get("plan_id")))
            days = _extract_plan_days(plan.get("plan_data") if plan else None)
            day_index = int(_to_float(row.get("day_index")) or 0)
            exercise_index = int(_to_float(row.get("exercise_index")) or 0)
            day = days[day_index] if 0 <= day_index < len(days) else {}
            exercises = day.get("exercises") if isinstance(day.get("exercises"), list) else []
            exercise = exercises[exercise_index] if 0 <= exercise_index < len(exercises) else {}
            recent_completed_exercises.append(
                {
                    "date": _to_iso_day(row.get("log_date") or row.get("completed_at")),
                    "plan_title": _clean_text(plan.get("title") if plan else ""),
                    "day": _clean_text(day.get("day") or day.get("dayAr")),
                    "exercise_name": _clean_text(exercise.get("name") or exercise.get("nameAr") or "Exercise completed"),
                }
            )

        recent_activity = []
        for row in sorted(
            logs_last_7,
            key=lambda item: _parse_datetime(item.get("log_date")) or datetime.min,
            reverse=True,
        )[:7]:
            iso_day = _to_iso_day(row.get("log_date"))
            recent_activity.append(
                {
                    "date": iso_day,
                    "completed_exercises": len(
                        [
                            item
                            for item in completions_last_7
                            if _to_iso_day(item.get("log_date") or item.get("completed_at")) == iso_day
                        ]
                    ),
                    "workout_notes": _clean_text(row.get("workout_notes")),
                    "nutrition_notes": _clean_text(row.get("nutrition_notes")),
                    "mood": _clean_text(row.get("mood")),
                }
            )

        recent_workout_notes = [_clean_text(row.get("workout_notes")) for row in logs_last_7 if _clean_text(row.get("workout_notes"))][:5]
        recent_nutrition_notes = [_clean_text(row.get("nutrition_notes")) for row in logs_last_7 if _clean_text(row.get("nutrition_notes"))][:5]
        recent_moods = [_clean_text(row.get("mood")) for row in logs_last_7 if _clean_text(row.get("mood"))][:5]

        active_plan_details = []
        for plan in [item for item in plans if item.get("is_active")][:4]:
            days = _extract_plan_days(plan.get("plan_data"))
            sample_exercises = []
            sample_meals = []
            for day in days:
                if isinstance(day.get("exercises"), list):
                    sample_exercises.extend(day.get("exercises")[:2])
                if isinstance(day.get("meals"), list):
                    sample_meals.extend(day.get("meals")[:2])
            active_plan_details.append(
                {
                    "title": _clean_text(plan.get("title")),
                    "type": "nutrition" if _is_nutrition_plan(plan.get("title")) else "workout",
                    "weekly_days_with_items": len(
                        [
                            day
                            for day in days
                            if (isinstance(day.get("exercises"), list) and day.get("exercises"))
                            or (isinstance(day.get("meals"), list) and day.get("meals"))
                        ]
                    ),
                    "sample_exercises": [_clean_text(item.get("name") or item.get("nameAr")) for item in sample_exercises if _clean_text(item.get("name") or item.get("nameAr"))][:6],
                    "sample_meals": [_clean_text(item.get("name") or item.get("nameAr")) for item in sample_meals if _clean_text(item.get("name") or item.get("nameAr"))][:6],
                }
            )

        workout_days_count = len({day for day in completion_days if day})
        logging_consistency_percent = round((len({day for day in [_to_iso_day(row.get("log_date")) for row in logs_last_7] if day}) / 7) * 100)
        workout_adherence_percent = round((workout_days_count / max(1, len(planned_workout_days))) * 100) if planned_workout_days else 0
        completion_delta = len(completions_last_7) - len(completions_previous_7)
        if completion_delta > 1:
            trend = "up"
        elif completion_delta < -1:
            trend = "down"
        else:
            trend = "flat"

        last_log_date = None
        if daily_logs:
            last_log_date = max((_parse_datetime(row.get("log_date")) or datetime.min for row in daily_logs)).date().isoformat()

        summary = {
            "completed_tasks": completed_tasks,
            "total_tasks": total_tasks,
            "adherence_score": adherence_score,
            "completed_workout_tasks": completed_tasks,
            "total_workout_tasks": total_workout_tasks,
            "total_nutrition_tasks": total_nutrition_tasks,
            "active_workout_plans": active_workout_plans,
            "active_nutrition_plans": active_nutrition_plans,
            "completed_last_7_days": len(completions_last_7),
            "last_completed_at": last_completed_at,
            "days_logged_last_7": len(logs_last_7),
            "last_log_date": last_log_date,
            "recent_completed_exercises": recent_completed_exercises,
            "recent_workout_notes": recent_workout_notes,
            "recent_nutrition_notes": recent_nutrition_notes,
            "recent_moods": recent_moods,
            "recent_activity": recent_activity,
            "active_plan_details": active_plan_details,
            "weekly_stats": {
                "workout_days": workout_days_count,
                "planned_days": len(planned_workout_days),
                "planned_nutrition_days": len(planned_nutrition_days),
                "workout_log_days": len({day for day in workout_log_days if day}),
                "nutrition_log_days": len({day for day in nutrition_log_days if day}),
                "completed_workouts": len(completions_last_7),
                "recent_exercise_names": [item.get("exercise_name") for item in recent_completed_exercises if item.get("exercise_name")][:8],
                "recent_completed_tasks": len(completions_last_7),
                "previous_completed_tasks": len(completions_previous_7),
                "completion_delta": completion_delta,
                "workout_adherence_percent": workout_adherence_percent,
                "logging_consistency_percent": logging_consistency_percent,
                "current_workout_streak_days": _streak_days([day for day in completion_days if day]),
                "current_logging_streak_days": _streak_days([_to_iso_day(row.get("log_date")) for row in daily_logs if _to_iso_day(row.get("log_date"))]),
            },
            "monthly_stats": {
                "consistency_percent": round(adherence_score * 100),
                "days_logged": len(daily_logs),
                "workout_log_days": len([row for row in daily_logs if _clean_text(row.get("workout_notes"))]),
                "nutrition_log_days": len([row for row in daily_logs if _clean_text(row.get("nutrition_notes"))]),
                "recent_7_completed_tasks": len(completions_last_7),
                "prior_7_completed_tasks": len(completions_previous_7),
            },
            "progress_metrics": {
                "trend": trend,
                "completion_delta": completion_delta,
                "recent_completed_tasks": len(completions_last_7),
                "prior_completed_tasks": len(completions_previous_7),
                "workout_adherence_percent": workout_adherence_percent,
                "logging_consistency_percent": logging_consistency_percent,
                "current_workout_streak_days": _streak_days([day for day in completion_days if day]),
                "current_logging_streak_days": _streak_days([_to_iso_day(row.get("log_date")) for row in daily_logs if _to_iso_day(row.get("log_date"))]),
                "has_recent_workout_notes": bool(recent_workout_notes),
                "has_recent_nutrition_notes": bool(recent_nutrition_notes),
                "has_recent_moods": bool(recent_moods),
            },
        }

        if profile:
            summary["goal"] = {
                "type": profile.get("goal"),
                "current_weight": profile.get("weight"),
                "target_weight": profile.get("target_weight"),
            }
        return summary

    def _load_recent_messages(self, user_id: str, conversation_id: Optional[str]) -> list[dict[str, str]]:
        extra_filters = {"conversation_id": conversation_id} if conversation_id else None
        rows = self._fetch_rows(
            "chat_messages",
            user_id,
            columns="role,content,created_at,conversation_id",
            order_by="created_at",
            descending=True,
            limit=12,
            extra_filters=extra_filters,
        )
        normalized = []
        for row in reversed(rows):
            role = _clean_text(row.get("role")).lower()
            content = _clean_text(row.get("content"))
            if role in {"user", "assistant"} and content:
                normalized.append({"role": role, "content": content})
        return normalized[-12:]

    def evaluate_workout_adherence(
        self,
        user_id: str,
        *,
        fitbit_summary: Optional[dict[str, Any]] = None,
        issue_reminder: bool = True,
        cutoff_hour_local: int = DEFAULT_WORKOUT_REMINDER_CUTOFF_HOUR,
    ) -> dict[str, Any]:
        if not user_id:
            return {"enabled": False}

        cutoff_hour_local = max(0, min(23, int(cutoff_hour_local)))
        fitbit_summary = fitbit_summary if isinstance(fitbit_summary, dict) else {}
        timezone_name = _clean_text(
            ((fitbit_summary.get("profile") or {}) if isinstance(fitbit_summary.get("profile"), dict) else {}).get("timezone")
        )
        local_now, resolved_timezone = _resolve_local_now(timezone_name)
        local_day = local_now.date()
        local_day_iso = local_day.isoformat()

        plans = self._fetch_rows(
            "workout_plans",
            user_id,
            columns="id,title,title_ar,plan_data,is_active,created_at,updated_at",
            order_by="updated_at",
            descending=True,
            limit=80,
        )
        completions = self._fetch_rows(
            "workout_completions",
            user_id,
            columns="id,plan_id,day_index,exercise_index,log_date,completed_at,completed",
            order_by="completed_at",
            descending=True,
            limit=600,
        )

        workout_plans = [plan for plan in plans if not _is_nutrition_plan(plan.get("title"))]
        active_workout_plans = [plan for plan in workout_plans if plan.get("is_active")]
        planned_day_matches: list[dict[str, Any]] = []
        planned_day_keys: set[tuple[str, int]] = set()
        planned_exercise_names: list[str] = []

        for plan in active_workout_plans:
            if not _plan_applies_to_date(plan, local_day):
                continue
            for day_index, day in enumerate(_extract_plan_days(plan.get("plan_data"))):
                if not _plan_day_has_exercises(day):
                    continue
                matches_local_day = _extract_plan_day_index(day.get("day")) == _javascript_day_index(local_day)
                if _extract_plan_day_index(day.get("day")) == -1:
                    matches_local_day = _extract_plan_day_index(day.get("dayAr")) == _javascript_day_index(local_day)
                if not matches_local_day:
                    continue
                exercises = [item for item in day.get("exercises") if isinstance(item, dict)]
                planned_day_matches.append(
                    {
                        "plan_id": str(plan.get("id") or ""),
                        "plan_title": _clean_text(plan.get("title_ar") or plan.get("title")),
                        "day_index": day_index,
                        "day_name": _clean_text(day.get("dayAr") or day.get("day")),
                        "exercise_count": len(exercises),
                    }
                )
                planned_day_keys.add((str(plan.get("id") or ""), day_index))
                planned_exercise_names.extend(
                    [
                        _clean_text(item.get("nameAr") or item.get("name"))
                        for item in exercises
                        if _clean_text(item.get("nameAr") or item.get("name"))
                    ]
                )

        today_workout_completions = [
            row
            for row in completions
            if row.get("completed") is not False
            and _to_iso_day(row.get("log_date") or row.get("completed_at")) == local_day_iso
            and str(row.get("plan_id") or "") in {str(plan.get("id") or "") for plan in workout_plans}
        ]
        today_planned_completions = [
            row
            for row in today_workout_completions
            if (str(row.get("plan_id") or ""), _to_int(row.get("day_index"))) in planned_day_keys
        ]

        today_summary = fitbit_summary.get("today_summary") if isinstance(fitbit_summary.get("today_summary"), dict) else {}
        heart_history = fitbit_summary.get("heart_history") if isinstance(fitbit_summary.get("heart_history"), list) else []
        today_heart_entry = next(
            (
                item
                for item in reversed(heart_history)
                if isinstance(item, dict) and _to_iso_day(item.get("date")) == local_day_iso
            ),
            {},
        )

        fairly_active_minutes = _to_int(today_summary.get("fairly_active_minutes"))
        very_active_minutes = _to_int(today_summary.get("very_active_minutes"))
        active_minutes_total = fairly_active_minutes + very_active_minutes
        steps = _to_int(today_summary.get("steps"))
        resting_heart_rate = _to_float(today_summary.get("resting_heart_rate"))
        heart_zone_active_minutes = _active_heart_zone_minutes(today_heart_entry.get("heart_rate_zones"))
        manual_workout_completions_today = len(today_workout_completions)

        evidence_reasons: list[str] = []
        evidence_score = 0

        def add_reason(message: str, score: int) -> None:
            nonlocal evidence_score
            if message not in evidence_reasons:
                evidence_reasons.append(message)
            evidence_score = max(evidence_score, score)

        if manual_workout_completions_today > 0:
            add_reason(
                f"Marked {manual_workout_completions_today} workout item{'s' if manual_workout_completions_today != 1 else ''} complete in your schedule today.",
                100,
            )
        if very_active_minutes >= WORKOUT_VERY_ACTIVE_MINUTES_THRESHOLD:
            add_reason(
                f"Logged {very_active_minutes} very active minutes today.",
                80,
            )
        if active_minutes_total >= WORKOUT_ACTIVE_MINUTES_THRESHOLD:
            add_reason(
                f"Logged {active_minutes_total} combined fairly active and very active minutes today.",
                70,
            )
        if heart_zone_active_minutes >= WORKOUT_HEART_ZONE_MINUTES_THRESHOLD:
            add_reason(
                f"Spent {heart_zone_active_minutes} minutes in active heart-rate zones today.",
                70,
            )
        if active_minutes_total >= 30 and heart_zone_active_minutes >= 20:
            add_reason(
                f"Combined {active_minutes_total} active minutes with {heart_zone_active_minutes} heart-zone minutes today.",
                75,
            )

        workout_detected_today = manual_workout_completions_today > 0 or evidence_score >= 60
        if manual_workout_completions_today > 0 or evidence_score >= 85:
            confidence = "high"
        elif workout_detected_today:
            confidence = "medium"
        else:
            confidence = "none"

        reminder_rows = self._fetch_rows(
            WORKOUT_REMINDER_TABLE,
            user_id,
            columns="id,reminder_type,reminder_date,reminder_status,reminder_message,sent_at,metadata",
            order_by="sent_at",
            descending=True,
            limit=1,
            extra_filters={
                "reminder_type": WORKOUT_REMINDER_TYPE,
                "reminder_date": local_day_iso,
            },
        )
        reminder_row = reminder_rows[0] if reminder_rows else None
        eligible_today = bool(planned_day_matches)
        after_cutoff = local_now.hour >= cutoff_hour_local
        already_sent_today = reminder_row is not None
        should_send_now = eligible_today and after_cutoff and not workout_detected_today and not already_sent_today
        reminder_message = ""

        if workout_detected_today:
            reminder_message = evidence_reasons[0] if evidence_reasons else "Workout activity detected today."
        elif eligible_today and after_cutoff:
            planned_preview = ", ".join(planned_exercise_names[:4])
            reminder_message = f"Today is a scheduled workout day and no workout has been detected by {cutoff_hour_local:02d}:00 in {resolved_timezone}."
            if planned_preview:
                reminder_message = f"{reminder_message} Planned exercises: {planned_preview}."
        elif eligible_today:
            reminder_message = "Today is a scheduled workout day, but the reminder cutoff has not been reached yet."

        sent_now = False
        persistence_error = None
        reminder_sent_at = reminder_row.get("sent_at") if isinstance(reminder_row, dict) else None

        if issue_reminder and should_send_now and self.client:
            payload = {
                "user_id": user_id,
                "reminder_type": WORKOUT_REMINDER_TYPE,
                "reminder_date": local_day_iso,
                "reminder_status": "sent",
                "reminder_message": reminder_message,
                "metadata": {
                    "timezone": resolved_timezone,
                    "cutoff_hour_local": cutoff_hour_local,
                    "evidence_score": evidence_score,
                    "manual_workout_completions_today": manual_workout_completions_today,
                    "active_minutes_total": active_minutes_total,
                    "very_active_minutes": very_active_minutes,
                    "heart_zone_active_minutes": heart_zone_active_minutes,
                    "planned_exercises": planned_exercise_names[:8],
                },
            }
            try:
                response = self.client.table(WORKOUT_REMINDER_TABLE).upsert(
                    payload,
                    on_conflict="user_id,reminder_type,reminder_date",
                ).execute()
                data = getattr(response, "data", None)
                stored_row = data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else payload
                sent_now = True
                already_sent_today = True
                reminder_sent_at = stored_row.get("sent_at") or stored_row.get("created_at") or datetime.utcnow().isoformat()
            except Exception as exc:
                persistence_error = str(exc)
                logger.warning("Failed storing workout reminder event: %s", exc)

        return {
            "enabled": True,
            "evaluated_at": local_now.isoformat(),
            "timezone": resolved_timezone,
            "schedule": {
                "has_active_workout_plan": bool(active_workout_plans),
                "has_workout_planned_today": eligible_today,
                "planned_workout_items_today": sum(match.get("exercise_count", 0) for match in planned_day_matches),
                "planned_workout_names_today": planned_exercise_names[:12],
                "manual_completions_today": len(today_planned_completions),
                "active_plan_titles": [
                    _clean_text(plan.get("title_ar") or plan.get("title"))
                    for plan in active_workout_plans
                    if _clean_text(plan.get("title_ar") or plan.get("title"))
                ],
            },
            "detection": {
                "workout_detected_today": workout_detected_today,
                "confidence": confidence,
                "evidence_score": evidence_score,
                "evidence_threshold": 60,
                "reasons": evidence_reasons,
                "metrics": {
                    "steps": steps,
                    "resting_heart_rate": resting_heart_rate,
                    "fairly_active_minutes": fairly_active_minutes,
                    "very_active_minutes": very_active_minutes,
                    "active_minutes_total": active_minutes_total,
                    "heart_zone_active_minutes": heart_zone_active_minutes,
                    "manual_workout_completions_today": manual_workout_completions_today,
                },
            },
            "reminder": {
                "type": WORKOUT_REMINDER_TYPE,
                "eligible_today": eligible_today,
                "after_cutoff": after_cutoff,
                "cutoff_hour_local": cutoff_hour_local,
                "reminder_date": local_day_iso,
                "already_sent_today": already_sent_today,
                "should_send_now": should_send_now,
                "sent_now": sent_now,
                "sent_at": reminder_sent_at,
                "show_banner": eligible_today and after_cutoff and not workout_detected_today,
                "message": reminder_message,
                "persistence_error": persistence_error,
            },
        }

    def load_user_context(self, user_id: str, conversation_id: Optional[str] = None) -> dict[str, Any]:
        if not self.client or not user_id:
            return {"enabled": False}

        profile = self._load_profile(user_id)
        plans = self._fetch_rows(
            "workout_plans",
            user_id,
            columns="id,title,title_ar,plan_data,is_active,created_at,updated_at",
            order_by="updated_at",
            descending=True,
            limit=40,
        )
        completions = self._fetch_rows(
            "workout_completions",
            user_id,
            columns="id,completed_at,log_date,plan_id,day_index,exercise_index,completed",
            order_by="completed_at",
            descending=True,
            limit=400,
        )
        daily_logs = self._fetch_rows(
            "daily_logs",
            user_id,
            columns="log_date,workout_notes,nutrition_notes,mood,created_at,updated_at",
            order_by="log_date",
            descending=True,
            limit=120,
        )
        recent_messages = self._load_recent_messages(user_id, conversation_id)
        plan_snapshot = self._build_plan_snapshot(plans)
        tracking_summary = self._build_tracking_summary(profile, plans, completions, daily_logs)

        return {
            "enabled": True,
            "profile": profile,
            "plan_snapshot": plan_snapshot,
            "tracking_summary": tracking_summary,
            "recent_messages": recent_messages,
            "counts": {
                "plans": len(plans),
                "completions": len(completions),
                "daily_logs": len(daily_logs),
                "recent_messages": len(recent_messages),
            },
        }


__all__ = ["SupabaseContextRepository"]