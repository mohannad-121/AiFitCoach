import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent / "ai_backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from main import app  # noqa: E402


class RouteSmokeTests(unittest.TestCase):
    def test_core_routes_are_registered(self) -> None:
        route_paths = {getattr(route, "path", "") for route in app.routes}
        self.assertIn("/chat", route_paths)
        self.assertIn("/docs", route_paths)
        self.assertTrue(any(path.startswith("/plans/") for path in route_paths))


if __name__ == "__main__":
    unittest.main()
