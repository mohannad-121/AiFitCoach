from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Optional

try:
    from supabase import Client, create_client
except Exception:
    Client = Any  # type: ignore
    create_client = None  # type: ignore

from nlp_utils import repair_mojibake


logger = logging.getLogger(__name__)

NUTRITION_PREFIX = "\U0001F37D\uFE0F"


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