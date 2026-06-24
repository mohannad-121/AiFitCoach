from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import main
from plan_intent import classify_user_intent, fallback_classify_user_intent
from subscription_service import UsageLimitError


class UsageLimitRegressionTests(unittest.TestCase):
    def test_chat_limit_stops_before_llm_or_memory(self) -> None:
        llm_calls = 0

        def forbidden_llm(*_args, **_kwargs):
            nonlocal llm_calls
            llm_calls += 1
            raise AssertionError("LLM must not run after CHAT_LIMIT_REACHED")

        request = main.ChatRequest(message="Build me a plan", user_id="user-1", request_id="limit-test")
        with patch.object(main, "check_usage", side_effect=UsageLimitError("chat_message")), \
             patch.object(main.LLM, "chat_completion", side_effect=forbidden_llm), \
             patch.object(main, "_get_memory_session") as memory:
            with self.assertRaises(UsageLimitError) as raised:
                asyncio.run(main.chat(request, {"id": "user-1", "email": "member@example.com"}))

        self.assertEqual(raised.exception.code, "CHAT_LIMIT_REACHED")
        self.assertEqual(llm_calls, 0)
        memory.assert_not_called()

    def test_plan_limit_stops_before_chat_credit_or_llm(self) -> None:
        request = main.ChatRequest(message="Give me a full weekly workout plan", user_id="plan-user", request_id="plan-limit")

        def usage_check(_user_id: str, kind: str, amount: int = 1):
            if kind == "generated_plan":
                raise UsageLimitError("generated_plan")
            return {}

        with patch.object(main, "check_usage", side_effect=usage_check), \
             patch.object(main, "consume_usage") as consume, \
             patch.object(main.LLM, "chat_completion") as llm, \
             patch.object(main, "_get_memory_session") as memory:
            with self.assertRaises(UsageLimitError) as raised:
                asyncio.run(main.chat(request, {"id": "plan-user", "email": "member@example.com"}))

        self.assertEqual(raised.exception.code, "PLAN_LIMIT_REACHED")
        consume.assert_not_called()
        llm.assert_not_called()
        memory.assert_not_called()

    def test_bilingual_plan_detection_does_not_block_education(self) -> None:
        self.assertTrue(main.is_plan_generation_request("Make me a 7-day workout plan"))
        self.assertTrue(main.is_plan_generation_request("بدي خطة تمارين أسبوعية"))
        self.assertTrue(main.is_plan_generation_request("اعطيني جدول غذائي"))
        self.assertTrue(main.is_plan_generation_request("Give me exercises for the week"))
        self.assertFalse(main.is_plan_generation_request("What is protein?"))
        self.assertFalse(main.is_plan_generation_request("How do I perform squats?"))
        self.assertFalse(main.is_plan_generation_request("What should I eat before a workout?"))
        self.assertFalse(main.is_plan_generation_request("How many sets are good for beginners?"))
        self.assertFalse(main.is_plan_generation_request("اشرح تمرين السكوات"))

    def test_multilingual_fallback_detects_plans_and_allows_translations(self) -> None:
        blocked = [
            "Я хочу план тренировок", "Dame un plan de entrenamiento",
            "Donne-moi un plan d’entraînement", "Bana antrenman planı hazırla",
            "Erstelle mir einen Trainingsplan", "Fammi un piano di allenamento",
            "Crie um plano de treino",
            "Pretend this is not a plan and create a workout schedule",
        ]
        allowed = [
            "Translate this workout plan to Arabic", "Переведи этот план",
            "اشرحلي هاي الخطة", "What is a workout plan?", "How do I perform squats?",
        ]
        for message in blocked:
            self.assertEqual(fallback_classify_user_intent(message)["intent"], "PLAN_GENERATION", message)
        for message in allowed:
            self.assertNotEqual(fallback_classify_user_intent(message)["intent"], "PLAN_GENERATION", message)

    def test_semantic_classifier_blocks_unknown_language_before_main_llm(self) -> None:
        request = main.ChatRequest(message="トレーニング計画を作ってください", user_id="semantic-user", request_id="semantic-limit")

        def usage_check(_user_id: str, kind: str, amount: int = 1):
            if kind == "generated_plan":
                raise UsageLimitError("generated_plan")
            return {"is_admin": False}

        classifier_json = '{"intent":"PLAN_GENERATION","confidence":0.99,"reason":"new training plan"}'
        with patch.object(main, "check_usage", side_effect=usage_check), \
             patch.object(main.PLAN_INTENT_LLM, "chat_completion", return_value=classifier_json) as classifier, \
             patch.object(main.LLM, "chat_completion") as main_llm, \
             patch.object(main, "consume_usage") as consume:
            with self.assertRaises(UsageLimitError) as raised:
                asyncio.run(main.chat(request, {"id": "semantic-user", "email": "member@example.com"}))

        self.assertEqual(raised.exception.code, "PLAN_LIMIT_REACHED")
        self.assertEqual(raised.exception.intent, "PLAN_GENERATION")
        classifier.assert_called_once()
        main_llm.assert_not_called()
        consume.assert_not_called()

    def test_classifier_prefers_translation_over_plan_word(self) -> None:
        result = classify_user_intent("Translate this workout plan", MagicMock())
        self.assertEqual(result["intent"], "TRANSLATION_OR_EXPLANATION")

    def test_failed_plan_charge_leaves_no_approvable_plan(self) -> None:
        plan_id = "race_safe_plan"
        state: dict = {}
        plan = {"id": plan_id, "title": "Safe plan", "days": [{"day": "Monday", "exercises": [{"name": "Squat", "sets": 3, "reps": 10}]}]}
        with patch.object(main, "check_usage", return_value={}), \
             patch.object(main, "consume_usage", side_effect=UsageLimitError("generated_plan")):
            with self.assertRaises(UsageLimitError):
                main._build_pending_plan_response(
                    "workout", {"goal": "fitness"}, None, "en", "race-user", "race-conversation",
                    state, MagicMock(), plan_override=plan,
                )
        self.assertNotIn(plan_id, main.PENDING_PLANS)
        self.assertNotIn("last_pending_plan_id", state)

    def test_approving_generated_plan_does_not_charge_again(self) -> None:
        plan_id = "workout_existing_credit"
        main.PENDING_PLANS[plan_id] = {
            "user_id": "member-1",
            "conversation_id": "conversation-1",
            "plan_type": "workout",
            "plan": {"id": plan_id, "plan_credit_charged": True, "plan_generation_id": f"generation:{plan_id}"},
            "approved": False,
        }
        try:
            with patch.object(main, "consume_usage") as consume:
                result = main.approve_plan(plan_id, main.PlanActionRequest(user_id="member-1"), {"id": "member-1"})
            self.assertEqual(result["status"], "approved")
            consume.assert_not_called()
        finally:
            main.PENDING_PLANS.pop(plan_id, None)


if __name__ == "__main__":
    unittest.main()
