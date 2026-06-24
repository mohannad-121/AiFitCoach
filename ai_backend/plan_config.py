from __future__ import annotations

from typing import Final

PLAN_CONFIG: Final = {
    "free": {"price": 0, "uploads_limit": 2, "chat_messages_limit": 30, "generated_plans_limit": 1},
    "plus": {"price": 10, "uploads_limit": 15, "chat_messages_limit": 60, "generated_plans_limit": 3},
    "pro": {"price": 15, "uploads_limit": 30, "chat_messages_limit": 100, "generated_plans_limit": 10},
}

USAGE_ERRORS: Final = {
    "upload": "Upload limit reached. Upgrade your plan to upload more files.",
    "chat_message": "Chat message limit reached. Upgrade your plan to continue chatting.",
    "generated_plan": "Generated plan limit reached. Upgrade your plan to create more plans.",
}
