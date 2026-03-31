import json
import os
import socket
import unittest
from urllib import error, request


LIVE_CHAT_API_URL = os.environ.get("LIVE_CHAT_API_URL", "http://127.0.0.1:8002/chat")


def _is_live_backend_available(url: str) -> bool:
    if not url.startswith("http://127.0.0.1:") and not url.startswith("http://localhost:"):
        return True
    try:
        host_port = url.split("//", 1)[1].split("/", 1)[0]
        host, port_str = host_port.split(":", 1)
        with socket.create_connection((host, int(port_str)), timeout=2):
            return True
    except OSError:
        return False


@unittest.skipUnless(_is_live_backend_available(LIVE_CHAT_API_URL), "Live backend is not running")
class LiveChatApiSmokeTest(unittest.TestCase):
    def test_live_chat_returns_approvable_workout_shape_for_rehab_prompt(self):
        payload = {
            "message": "أعطني خطة تعافي للكاحل بعد الالتواء مع التكرارات والراحة كنقاط واضحة.",
            "language": "ar",
            "user_id": "live-chat-api-user",
            "conversation_id": "live-chat-api-conversation",
            "user_profile": {
                "goal": "fitness",
                "trainingDaysPerWeek": 3,
                "location": "home",
            },
        }
        req = request.Request(
            LIVE_CHAT_API_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=180) as response:
                body = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            self.fail(f"Live /chat request failed with HTTP {exc.code}: {details}")

        self.assertEqual(body.get("action"), "ask_plan")
        data = body.get("data") or {}
        self.assertEqual(data.get("plan_type"), "workout")
        plan = data.get("plan") or {}
        self.assertGreaterEqual(len(plan.get("exercises") or []), 3)


if __name__ == "__main__":
    unittest.main()