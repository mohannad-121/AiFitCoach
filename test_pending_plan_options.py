import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "ai_backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("TRAINING_PIPELINE_ENABLED", "0")
os.environ.setdefault("CHAT_RESPONSE_MODE", "llm")
os.environ.setdefault("LLM_PROVIDER", "ollama")
os.environ.setdefault("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
os.environ.setdefault("OLLAMA_MODEL", "gpt-oss:120b-cloud")

import main as backend_main


def _build_workout_option(title: str, title_ar: str, focus: str, training_days: list[str], rest_days: list[str]) -> dict:
    days = []
    for day_name in training_days:
        days.append(
            {
                "day": day_name,
                "dayAr": day_name,
                "focus": focus,
                "exercises": [
                    {
                        "name": "Squat",
                        "sets": "4",
                        "reps": "8-10",
                    }
                ],
            }
        )
    return {
        "id": f"plan_{title.lower().replace(' ', '_')}",
        "title": title,
        "title_ar": title_ar,
        "days": days,
        "rest_days": rest_days,
        "training_days_per_week": len(training_days),
    }


class PendingPlanOptionsRegressionTest(unittest.TestCase):
    def test_pending_plan_options_supports_arabic_comparison_without_losing_state(self):
        user_id = "pending-plan-test-user"
        conversation_id = "pending-plan-conversation"

        backend_main.USER_STATE.clear()
        backend_main.MEMORY_SESSIONS.clear()

        options = [
            _build_workout_option(
                "Balanced Full Body",
                "فول بدي متوازن",
                "Full Body",
                ["Monday", "Wednesday", "Friday"],
                ["Tuesday", "Thursday", "Saturday", "Sunday"],
            ),
            _build_workout_option(
                "Upper Lower Split",
                "أبر لوَر سبليت",
                "Upper Lower",
                ["Monday", "Tuesday", "Thursday", "Friday"],
                ["Wednesday", "Saturday", "Sunday"],
            ),
        ]

        state = backend_main._get_user_state(user_id)
        state["pending_plan_options"] = backend_main._build_pending_plan_options_state(
            "workout",
            options,
            conversation_id,
        )

        request = backend_main.ChatRequest(
            message="شو الفرق بينهم وأي خيار أنسب؟",
            language="ar",
            user_id=user_id,
            conversation_id=conversation_id,
            user_profile={"goal": "general_fitness", "trainingDaysPerWeek": 4},
        )

        with mock.patch.object(backend_main, "_load_database_context", return_value={"enabled": False}), mock.patch.object(
            backend_main,
            "_refresh_persistent_rag_context",
            return_value=None,
        ), mock.patch.object(backend_main.FITBIT, "get_coach_tracking_summary", return_value=None):
            response = asyncio.run(backend_main.chat(request))

        self.assertEqual(response.action, "choose_plan")
        self.assertIsNotNone(state["pending_plan_options"])
        self.assertIsNotNone(response.data)
        self.assertEqual(response.data["options_count"], 2)
        self.assertIn("هاي مقارنة سريعة بين الخيارات الظاهرة", response.reply)
        self.assertIn("ترشيحي السريع هو الخيار", response.reply)
        self.assertTrue(any("أيام تمرين" in option["summary"] for option in response.data["options"]))

    def test_status_overview_phrase_does_not_generate_plan(self):
        user_id = "status-overview-user"
        conversation_id = "status-overview-conversation"

        backend_main.USER_STATE.clear()
        backend_main.MEMORY_SESSIONS.clear()

        state = backend_main._get_user_state(user_id)
        state["plan_snapshot"] = {
            "active_workout_plans": 1,
            "active_nutrition_plans": 1,
        }
        state["last_progress_summary"] = {
            "completed_tasks": 5,
            "total_tasks": 7,
            "adherence_score": 0.71,
        }

        request = backend_main.ChatRequest(
            message="شو الوضع",
            language="ar",
            user_id=user_id,
            conversation_id=conversation_id,
            user_profile={
                "goal": "fat_loss",
                "fitnessLevel": "intermediate",
                "trainingDaysPerWeek": 4,
            },
        )

        with mock.patch.object(backend_main, "_load_database_context", return_value={"enabled": False}), mock.patch.object(
            backend_main,
            "_refresh_persistent_rag_context",
            return_value=None,
        ), mock.patch.object(backend_main.FITBIT, "get_coach_tracking_summary", return_value=None), mock.patch.object(
            backend_main,
            "_general_llm_reply",
            side_effect=AssertionError("status overview should not hit llm"),
        ):
            response = asyncio.run(backend_main.chat(request))

        self.assertIsNone(response.action)
        self.assertIn("وضعك الحالي باختصار", response.reply)
        self.assertIn("الهدف", response.reply)
        self.assertIn("التقدم", response.reply)
        self.assertIn("الخطط النشطة", response.reply)

    def test_llm_text_workout_plan_becomes_approvable_pending_plan(self):
        user_id = "llm-text-plan-user"
        conversation_id = "llm-text-plan-conversation"

        backend_main.USER_STATE.clear()
        backend_main.MEMORY_SESSIONS.clear()

        llm_reply = """خطة تعافي للكاحل بعد الالتواء
1. Ankle circles - 3 x 12
2. Calf stretch - 3 x 30 seconds
3. Single-leg balance - 3 x 20 seconds
4. Heel raises - 3 x 15
كرر الخطة 3 مرات بالأسبوع مع زيادة بسيطة حسب التحمل."""

        request = backend_main.ChatRequest(
            message="أعطني خطوات تعافي للكاحل بعد الالتواء",
            language="ar",
            user_id=user_id,
            conversation_id=conversation_id,
            user_profile={"goal": "general_fitness", "trainingDaysPerWeek": 3},
        )

        with mock.patch.object(backend_main, "_load_database_context", return_value={"enabled": False}), mock.patch.object(
            backend_main,
            "_refresh_persistent_rag_context",
            return_value=None,
        ), mock.patch.object(backend_main.FITBIT, "get_coach_tracking_summary", return_value=None), mock.patch.object(
            backend_main,
            "_general_llm_reply",
            return_value=llm_reply,
        ), mock.patch.object(
            backend_main,
            "_resolve_plan_type_from_message",
            return_value=(None, None),
        ):
            response = asyncio.run(backend_main.chat(request))

        self.assertEqual(response.action, "ask_plan")
        self.assertIn("خطة تعافي للكاحل", response.reply)
        self.assertIsNotNone(response.data)
        self.assertEqual(response.data["plan_type"], "workout")
        self.assertGreaterEqual(len(response.data["plan"].get("exercises", [])), 3)

    def test_llm_rehab_text_plan_preserves_rest_frequency_and_progression(self):
        user_id = "rehab-plan-user"
        conversation_id = "rehab-plan-conversation"

        backend_main.USER_STATE.clear()
        backend_main.MEMORY_SESSIONS.clear()

        llm_reply = """خطة تعافي للكاحل بعد الالتواء
1. Ankle circles - 3 x 12 - rest 20 seconds - pain-free range
2. Calf stretch - 3 x 30 seconds - rest 30 seconds
3. Single-leg balance - 3 x 20 seconds - hold wall support if needed
4. Heel raises - 3 x 15 - rest 30 seconds
كرر الخطة 4 مرات بالأسبوع.
زيادة بسيطة أسبوعيًا حسب التحمل ووقف التمرين إذا زاد الألم."""

        request = backend_main.ChatRequest(
            message="أعطني خطة تعافي للكاحل مع الراحة والتدرج",
            language="ar",
            user_id=user_id,
            conversation_id=conversation_id,
            user_profile={"goal": "general_fitness", "trainingDaysPerWeek": 3},
        )

        with mock.patch.object(backend_main, "_load_database_context", return_value={"enabled": False}), mock.patch.object(
            backend_main,
            "_refresh_persistent_rag_context",
            return_value=None,
        ), mock.patch.object(backend_main.FITBIT, "get_coach_tracking_summary", return_value=None), mock.patch.object(
            backend_main,
            "_general_llm_reply",
            return_value=llm_reply,
        ), mock.patch.object(
            backend_main,
            "_resolve_plan_type_from_message",
            return_value=(None, None),
        ):
            response = asyncio.run(backend_main.chat(request))

        self.assertEqual(response.action, "ask_plan")
        self.assertIsNotNone(response.data)
        plan = response.data["plan"]
        self.assertEqual(plan.get("training_days_per_week"), 4)
        self.assertIn("زيادة بسيطة", plan.get("progression", ""))
        self.assertGreaterEqual(plan.get("exercises", [])[0].get("rest_seconds", 0), 20)
        self.assertIn("pain-free range", plan.get("exercises", [])[0].get("notes", ""))

    def test_explicit_rehab_request_returns_direct_pending_workout_plan(self):
        user_id = "explicit-rehab-user"
        conversation_id = "explicit-rehab-conversation"

        backend_main.USER_STATE.clear()
        backend_main.MEMORY_SESSIONS.clear()

        request = backend_main.ChatRequest(
            message="أعطني خطة تعافي للكاحل بعد الالتواء مع التكرارات والراحة كنقاط واضحة.",
            language="ar",
            user_id=user_id,
            conversation_id=conversation_id,
            user_profile={"goal": "general_fitness", "trainingDaysPerWeek": 3},
        )

        with mock.patch.object(backend_main, "_load_database_context", return_value={"enabled": False}), mock.patch.object(
            backend_main,
            "_refresh_persistent_rag_context",
            return_value=None,
        ), mock.patch.object(backend_main.FITBIT, "get_coach_tracking_summary", return_value=None), mock.patch.object(
            backend_main,
            "_general_llm_reply",
            side_effect=AssertionError("explicit rehab plan request should bypass generic llm chat"),
        ):
            response = asyncio.run(backend_main.chat(request))

        self.assertEqual(response.action, "ask_plan")
        self.assertIsNotNone(response.data)
        self.assertEqual(response.data["plan_type"], "workout")
        self.assertIn("الكاحل", response.data["plan"].get("title_ar", ""))
        self.assertGreaterEqual(len(response.data["plan"].get("exercises", [])), 4)

    def test_llm_exercise_suggestions_do_not_become_pending_plan(self):
        user_id = "exercise-suggestions-user"
        conversation_id = "exercise-suggestions-conversation"

        backend_main.USER_STATE.clear()
        backend_main.MEMORY_SESSIONS.clear()

        llm_reply = """في عدة تمارين بسيطة ممكن تفيد لتقوية الكاحل:
    - Toe raises - 3 x 15-20
    - Ankle circles - 2 x 10-15
    - Band ankle work - 3 x 10-12
    - Single-leg hops - 2 x 8-10

    نفّذها 3-4 مرات بالأسبوع وراقب شعور الكاحل قبل وبعد النشاط.
    الخطوة الجاية: جرّب أول تمرين وسجّل ملاحظاتك.
    إذا بدك أقدر أبني لك خطة كاملة لاحقًا."""

        request = backend_main.ChatRequest(
            message="شو في تمارين لتقوية الكاحل؟",
            language="ar",
            user_id=user_id,
            conversation_id=conversation_id,
            user_profile={"goal": "general_fitness", "trainingDaysPerWeek": 3},
        )

        with mock.patch.object(backend_main, "_load_database_context", return_value={"enabled": False}), mock.patch.object(
            backend_main,
            "_refresh_persistent_rag_context",
            return_value=None,
        ), mock.patch.object(backend_main.FITBIT, "get_coach_tracking_summary", return_value=None), mock.patch.object(
            backend_main,
            "_general_llm_reply",
            return_value=llm_reply,
        ), mock.patch.object(
            backend_main,
            "_resolve_plan_type_from_message",
            return_value=(None, None),
        ):
            response = asyncio.run(backend_main.chat(request))

        self.assertNotEqual(response.action, "ask_plan")
        self.assertIn("الكاحل", response.reply)

    def test_explicit_weight_update_requires_confirmation_before_write(self):
        user_id = "profile-update-user"
        conversation_id = "profile-update-conversation"

        backend_main.USER_STATE.clear()
        backend_main.MEMORY_SESSIONS.clear()

        request = backend_main.ChatRequest(
            message="غير وزني إلى 110",
            language="ar",
            user_id=user_id,
            conversation_id=conversation_id,
            user_profile={"weight": 95},
        )

        with mock.patch.object(backend_main, "_load_database_context", return_value={"enabled": False}), mock.patch.object(
            backend_main,
            "_refresh_persistent_rag_context",
            return_value=None,
        ), mock.patch.object(backend_main.FITBIT, "get_coach_tracking_summary", return_value=None), mock.patch.object(
            backend_main,
            "_general_llm_reply",
            side_effect=AssertionError("profile update should not hit llm"),
        ):
            response = asyncio.run(backend_main.chat(request))

        state = backend_main._get_user_state(user_id)
        self.assertEqual(response.action, "confirm_profile_update")
        self.assertIsNotNone(response.data)
        self.assertEqual(response.data["profile_updates"]["weight"], 110)
        self.assertEqual(response.data["supabase_updates"]["weight"], 110)
        self.assertEqual(state.get("pending_profile_update_confirmation", {}).get("field"), "weight")
        self.assertIn("أكّد", response.reply)

    def test_profile_update_confirmation_can_update_goal_and_location_fields(self):
        user_id = "profile-confirmation-user"
        conversation_id = "profile-confirmation-conversation"

        backend_main.USER_STATE.clear()
        backend_main.MEMORY_SESSIONS.clear()

        initial_request = backend_main.ChatRequest(
            message="غيّر هدفي إلى تنشيف",
            language="ar",
            user_id=user_id,
            conversation_id=conversation_id,
            user_profile={"goal": "fitness"},
        )
        confirm_request = backend_main.ChatRequest(
            message="موافق",
            language="ar",
            user_id=user_id,
            conversation_id=conversation_id,
            user_profile={"goal": "fitness"},
        )
        location_request = backend_main.ChatRequest(
            message="غير مكان التمرين إلى الجيم",
            language="ar",
            user_id=user_id,
            conversation_id=conversation_id,
            user_profile={"location": "home"},
        )

        with mock.patch.object(backend_main, "_load_database_context", return_value={"enabled": False}), mock.patch.object(
            backend_main,
            "_refresh_persistent_rag_context",
            return_value=None,
        ), mock.patch.object(backend_main.FITBIT, "get_coach_tracking_summary", return_value=None), mock.patch.object(
            backend_main,
            "_general_llm_reply",
            side_effect=AssertionError("profile confirmation flow should not hit llm"),
        ):
            initial_response = asyncio.run(backend_main.chat(initial_request))
            confirmed_response = asyncio.run(backend_main.chat(confirm_request))
            location_response = asyncio.run(backend_main.chat(location_request))

        state = backend_main._get_user_state(user_id)
        self.assertEqual(initial_response.action, "confirm_profile_update")
        self.assertEqual(initial_response.data["profile_updates"]["goal"], "cutting")
        self.assertEqual(confirmed_response.action, "profile_updated")
        self.assertEqual(confirmed_response.data["profile_updates"]["goal"], "cutting")
        self.assertEqual(state.get("goal"), "fat_loss")
        self.assertEqual(location_response.action, "confirm_profile_update")
        self.assertEqual(location_response.data["profile_updates"]["location"], "gym")


if __name__ == "__main__":
    unittest.main()