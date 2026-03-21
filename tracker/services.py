import requests
from collections import defaultdict
from datetime import datetime, timezone
from django.conf import settings


class TimeTrackingServiceError(Exception):
    pass


def _parse_entry_date(entry):
    # Forgejo/Gitea payloads may expose timestamp fields in different formats.
    if isinstance(entry.get("created_unix"), int):
        return datetime.fromtimestamp(entry["created_unix"], tz=timezone.utc).date()

    for key in ("created", "date", "updated"):
        value = entry.get(key)
        if not value or not isinstance(value, str):
            continue
        normalized = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized).date()
        except ValueError:
            continue

    return None


def get_time_sum(since, before):
    if not settings.FORGEJO_BASE_URL or not settings.FORGEJO_TOKEN:
        raise TimeTrackingServiceError("Forgejo API credentials are not configured.")

    url = f"{settings.FORGEJO_BASE_URL.rstrip('/')}/api/v1/user/times"

    headers = {
        "Authorization": f"token {settings.FORGEJO_TOKEN}"
    }

    params = {
        "since": since,
        "before": before
    }

    total_seconds = 0
    daily_seconds = defaultdict(int)
    page = 1
    max_pages = 1000

    while True:
        if page > max_pages:
            raise TimeTrackingServiceError("Forgejo API pagination exceeded safe limit.")

        params["page"] = page
        try:
            res = requests.get(url, headers=headers, params=params, timeout=15)
            res.raise_for_status()
            data = res.json()
        except (requests.RequestException, ValueError) as exc:
            raise TimeTrackingServiceError("Failed to fetch time entries from Forgejo.") from exc

        if not data:
            break
        if not isinstance(data, list):
            raise TimeTrackingServiceError("Unexpected response format from Forgejo API.")

        for entry in data:
            try:
                seconds = max(0, int(entry.get("time", 0)))
            except (TypeError, ValueError):
                seconds = 0
            total_seconds += seconds

            entry_date = _parse_entry_date(entry)
            if entry_date is not None:
                daily_seconds[entry_date.isoformat()] += seconds

        page += 1

    return total_seconds, dict(sorted(daily_seconds.items()))
