from django.test import TestCase
from django.test import override_settings
from unittest.mock import patch
from tracker.services import TimeTrackingServiceError, _parse_entry_date, get_time_sum


class AuthFlowTests(TestCase):
    def test_index_requires_login(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.url.startswith("/login/"))

    def test_login_with_allowed_credentials_redirects_home(self):
        response = self.client.post(
            "/login/",
            {"username": "ken", "password": "081010"},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "/")

    def test_login_rejects_external_next_redirect(self):
        response = self.client.post(
            "/login/?next=https://example.com/phishing",
            {"username": "ken", "password": "081010"},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "/")

    def test_api_requires_login(self):
        response = self.client.get("/api/time-summary/")
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.url.startswith("/login/"))

    def test_logout_requires_post(self):
        self.client.post("/login/", {"username": "ken", "password": "081010"})
        response = self.client.get("/logout/")
        self.assertEqual(response.status_code, 405)


class TimeSummaryTests(TestCase):
    def setUp(self):
        self.client.post("/login/", {"username": "ken", "password": "081010"})

    @patch("tracker.views.get_time_sum")
    def test_time_summary_returns_all_days_in_range(self, mock_get_time_sum):
        mock_get_time_sum.side_effect = [
            (
                10800,
                {
                    "2026-03-01": 7200,
                    "2026-03-03": 3600,
                },
                {
                    "repo/app#12 Add auth": 7200,
                    "repo/app#9 Fix bug": 3600,
                },
            ),
            (7200, {"2026-02-28": 7200}, {"repo/app#8 Setup": 7200}),
        ]

        response = self.client.get(
            "/api/time-summary/",
            {"since": "2026-03-01T00:00:00Z", "before": "2026-03-03T23:59:59Z"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["daily_breakdown"]), 3)
        self.assertEqual(data["daily_breakdown"][1]["date"], "2026-03-02")
        self.assertEqual(data["daily_breakdown"][1]["total_seconds"], 0)
        self.assertEqual(data["average_per_day_seconds"], 3600)
        self.assertEqual(data["busiest_day"]["date"], "2026-03-01")
        self.assertEqual(data["insights"]["active_days"], 2)
        self.assertEqual(data["insights"]["current_streak_days"], 1)
        self.assertEqual(data["comparison"]["previous"]["total_seconds"], 7200)
        self.assertEqual(data["comparison"]["direction"], "up")
        self.assertEqual(len(data["top_days"]), 2)
        self.assertEqual(len(data["weekly_breakdown"]), 2)
        self.assertEqual(data["issue_breakdown"][0]["issue"], "repo/app#12 Add auth")
        self.assertEqual(data["issue_breakdown"][0]["total_seconds"], 7200)

    def test_time_summary_rejects_invalid_range(self):
        response = self.client.get(
            "/api/time-summary/",
            {"since": "2026-03-05T00:00:00Z", "before": "2026-03-03T23:59:59Z"},
        )
        self.assertEqual(response.status_code, 400)

    def test_time_summary_rejects_too_large_range(self):
        response = self.client.get(
            "/api/time-summary/",
            {"since": "2025-01-01T00:00:00Z", "before": "2026-03-03T23:59:59Z"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("must not exceed", response.json()["error"])

    @patch("tracker.views.get_time_sum")
    def test_time_summary_returns_502_for_service_failures(self, mock_get_time_sum):
        mock_get_time_sum.side_effect = TimeTrackingServiceError("boom")
        response = self.client.get(
            "/api/time-summary/",
            {"since": "2026-03-01T00:00:00Z", "before": "2026-03-03T23:59:59Z"},
        )
        self.assertEqual(response.status_code, 502)
        self.assertIn("Failed to load data", response.json()["error"])

    @patch("tracker.views.get_time_sum")
    def test_time_summary_returns_without_comparison_when_previous_period_fails(self, mock_get_time_sum):
        mock_get_time_sum.side_effect = [
            (3600, {"2026-03-01": 3600}, {"repo/app#1 Work": 3600}),
            TimeTrackingServiceError("prev period down"),
        ]
        response = self.client.get(
            "/api/time-summary/",
            {"since": "2026-03-01T00:00:00Z", "before": "2026-03-01T23:59:59Z"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["comparison"])

    @patch("tracker.views.get_time_sum")
    def test_time_summary_can_exclude_weekends(self, mock_get_time_sum):
        mock_get_time_sum.side_effect = [
            (
                10800,
                {
                    "2026-03-06": 3600,  # Fri
                    "2026-03-07": 3600,  # Sat
                    "2026-03-08": 3600,  # Sun
                },
                {"repo/app#2 Work": 10800},
            ),
            (0, {}, {}),
        ]
        response = self.client.get(
            "/api/time-summary/",
            {
                "since": "2026-03-06T00:00:00Z",
                "before": "2026-03-08T23:59:59Z",
                "include_weekends": "0",
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["days_count"], 1)
        self.assertEqual(data["total_seconds"], 3600)
        self.assertFalse(data["include_weekends"])


class ServiceTests(TestCase):
    def test_parse_entry_date_supports_multiple_formats(self):
        self.assertEqual(
            str(_parse_entry_date({"created_unix": 1710000000})),
            "2024-03-09",
        )
        self.assertEqual(
            str(_parse_entry_date({"created": "2026-03-12T07:10:00Z"})),
            "2026-03-12",
        )
        self.assertEqual(
            str(_parse_entry_date({"updated": "2026-03-13T10:30:00+00:00"})),
            "2026-03-13",
        )

    @override_settings(FORGEJO_BASE_URL="https://forgejo.example", FORGEJO_TOKEN="abc")
    @patch("tracker.services._HTTP_SESSION.get")
    def test_get_time_sum_fetches_all_pages(self, mock_get):
        mock_get.side_effect = [
            MockResponse(
                200,
                [
                    {
                        "time": 3600,
                        "created": "2026-03-01T08:00:00Z",
                        "issue": {"number": 7, "title": "API"},
                        "repo": {"full_name": "acme/project"},
                    }
                ],
            ),
            MockResponse(
                200,
                [
                    {
                        "time": 1800,
                        "created": "2026-03-02T08:00:00Z",
                        "issue": {"number": 7, "title": "API"},
                        "repo": {"full_name": "acme/project"},
                    }
                ],
            ),
            MockResponse(200, []),
        ]
        total, daily, issues = get_time_sum("2026-03-01T00:00:00Z", "2026-03-02T23:59:59Z")
        self.assertEqual(total, 5400)
        self.assertEqual(daily["2026-03-01"], 3600)
        self.assertEqual(daily["2026-03-02"], 1800)
        self.assertEqual(issues["acme/project#7 API"], 5400)
        self.assertEqual(mock_get.call_count, 3)

    @override_settings(FORGEJO_BASE_URL="https://forgejo.example", FORGEJO_TOKEN="abc")
    @patch("tracker.services._HTTP_SESSION.get")
    def test_get_time_sum_raises_on_http_error(self, mock_get):
        mock_get.return_value = MockResponse(500, {"error": "boom"}, raise_http=True)
        with self.assertRaises(TimeTrackingServiceError):
            get_time_sum("2026-03-03T00:00:00Z", "2026-03-04T23:59:59Z")


class MockResponse:
    def __init__(self, status_code, payload, raise_http=False):
        self.status_code = status_code
        self._payload = payload
        self._raise_http = raise_http

    def raise_for_status(self):
        if self._raise_http:
            import requests
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload
