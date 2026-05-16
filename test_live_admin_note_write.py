import json
import os
import socket
import unittest
import uuid
from urllib import error, parse, request


LIVE_ADMIN_API_BASE_URL = os.environ.get("LIVE_ADMIN_API_BASE_URL", "http://127.0.0.1:8010")
RUN_LIVE_ADMIN_WRITE_TEST = os.environ.get("RUN_LIVE_ADMIN_WRITE_TEST", "0") == "1"
ADMIN_PASSWORD = os.environ.get("LIVE_ADMIN_PASSWORD", "coach0000")
ADMIN_ACTOR = os.environ.get("LIVE_ADMIN_ACTOR", "Copilot Live Test")
ADMIN_ROLE = os.environ.get("LIVE_ADMIN_ROLE", "coach")
LIVE_ADMIN_USER_ID = os.environ.get("LIVE_ADMIN_USER_ID", "").strip()


def _is_live_backend_available(base_url: str) -> bool:
    if not base_url.startswith("http://127.0.0.1:") and not base_url.startswith("http://localhost:"):
        return True
    try:
        host_port = base_url.split("//", 1)[1].split("/", 1)[0]
        host, port_str = host_port.split(":", 1)
        with socket.create_connection((host, int(port_str)), timeout=2):
            return True
    except OSError:
        return False


def _request_json(url: str, *, method: str = "GET", payload: dict | None = None, headers: dict | None = None) -> dict:
    body = None
    effective_headers = {"Accept": "application/json"}
    if headers:
        effective_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        effective_headers.setdefault("Content-Type", "application/json; charset=utf-8")

    req = request.Request(url, data=body, headers=effective_headers, method=method)
    try:
        with request.urlopen(req, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise AssertionError(f"{method} {url} failed with HTTP {exc.code}: {details}") from exc


@unittest.skipUnless(_is_live_backend_available(LIVE_ADMIN_API_BASE_URL), "Live backend is not running")
@unittest.skipUnless(RUN_LIVE_ADMIN_WRITE_TEST, "Set RUN_LIVE_ADMIN_WRITE_TEST=1 to run the live write smoke test")
class LiveAdminNoteWriteSmokeTest(unittest.TestCase):
    def test_live_admin_panel_can_create_a_note_and_read_it_back(self):
        admin_headers = {
            "X-Admin-Password": ADMIN_PASSWORD,
            "X-Admin-Actor": ADMIN_ACTOR,
            "X-Admin-Role": ADMIN_ROLE,
        }

        user_id = LIVE_ADMIN_USER_ID
        if not user_id:
            users_payload = _request_json(
                f"{LIVE_ADMIN_API_BASE_URL}/admin/users?limit=1",
                headers=admin_headers,
            )
            users = users_payload.get("users") or []
            if not users:
                self.skipTest("No admin-visible user found; set LIVE_ADMIN_USER_ID to run the live write test")
            user_id = str(users[0].get("user_id") or "").strip()

        self.assertTrue(user_id, "Expected a valid target user_id for the live write test")

        marker = f"live-admin-smoke-{uuid.uuid4().hex[:10]}"
        note_text = f"{marker} - live admin write verification"
        created = _request_json(
            f"{LIVE_ADMIN_API_BASE_URL}/admin/users/{parse.quote(user_id)}/notes",
            method="POST",
            headers=admin_headers,
            payload={
                "note_text": note_text,
                "note_category": "general",
                "related_date": None,
            },
        )

        self.assertEqual(created.get("status"), "saved")
        saved_note = created.get("note") or {}
        self.assertEqual(saved_note.get("note_text"), note_text)
        self.assertEqual(str(created.get("user_id") or ""), user_id)

        notifications = _request_json(
            f"{LIVE_ADMIN_API_BASE_URL}/coach-notifications?user_id={parse.quote(user_id)}&limit=20"
        )
        rows = notifications.get("notifications") or []
        self.assertTrue(
            any((row.get("note_text") or "") == note_text for row in rows),
            "Created note was not found in coach notifications",
        )


if __name__ == "__main__":
    unittest.main()
