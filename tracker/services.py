import requests
from collections import defaultdict
from datetime import datetime, timezone
from django.conf import settings
from django.core.cache import cache


class TimeTrackingServiceError(Exception):
    pass


_HTTP_SESSION = requests.Session()


def _parse_entry_date(entry):
    # Forgejo/Gitea payloads may expose timestamp fields in different formats.
    created_unix = entry.get("created_unix")
    if isinstance(created_unix, str) and created_unix.isdigit():
        created_unix = int(created_unix)
    if isinstance(created_unix, int):
        return datetime.fromtimestamp(created_unix, tz=timezone.utc).date()

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


def _extract_issue_label(entry):
    issue = entry.get("issue")
    if not isinstance(issue, dict):
        return None

    number = issue.get("number") or issue.get("index")
    title = str(issue.get("title") or "").strip()

    repo_name = ""
    repo = entry.get("repo")
    if isinstance(repo, dict):
        repo_name = str(repo.get("full_name") or repo.get("name") or "").strip()
    elif isinstance(issue.get("repository"), dict):
        repo_name = str(
            issue["repository"].get("full_name")
            or issue["repository"].get("name")
            or ""
        ).strip()

    issue_ref = f"#{number}" if number is not None else "Issue"
    if repo_name:
        issue_ref = f"{repo_name}{issue_ref}"

    if title:
        return f"{issue_ref} {title}"
    return issue_ref


def get_time_sum(since, before, username=None):
    if not settings.FORGEJO_BASE_URL or not settings.FORGEJO_TOKEN:
        raise TimeTrackingServiceError("Forgejo API credentials are not configured.")

    url = f"{settings.FORGEJO_BASE_URL.rstrip('/')}/api/v1/user/times"
    headers = {"Authorization": f"token {settings.FORGEJO_TOKEN}"}
    if username:
        headers["Sudo"] = username

    params = {"since": since, "before": before}

    cache_key = f"forgejo:time_sum:{since}:{before}:{username or 'self'}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    total_seconds = 0
    daily_seconds = defaultdict(int)
    issue_seconds = defaultdict(int)
    page = 1
    max_pages = 1000

    while True:
        if page > max_pages:
            raise TimeTrackingServiceError(
                "Forgejo API pagination exceeded safe limit."
            )

        params["page"] = page
        try:
            res = _HTTP_SESSION.get(url, headers=headers, params=params, timeout=15)
            res.raise_for_status()
            data = res.json()
        except (requests.RequestException, ValueError) as exc:
            raise TimeTrackingServiceError(
                "Failed to fetch time entries from Forgejo."
            ) from exc

        if not data:
            break
        if not isinstance(data, list):
            raise TimeTrackingServiceError(
                "Unexpected response format from Forgejo API."
            )

        for entry in data:
            try:
                seconds = max(0, int(entry.get("time", 0)))
            except (TypeError, ValueError):
                seconds = 0
            total_seconds += seconds

            entry_date = _parse_entry_date(entry)
            if entry_date is not None:
                daily_seconds[entry_date.isoformat()] += seconds

            issue_label = _extract_issue_label(entry)
            if issue_label:
                issue_seconds[issue_label] += seconds

        page += 1

    result = (
        total_seconds,
        dict(sorted(daily_seconds.items())),
        dict(sorted(issue_seconds.items(), key=lambda item: item[1], reverse=True)),
    )
    cache.set(cache_key, result, timeout=120)
    return result


def get_forgejo_users():
    if not settings.FORGEJO_BASE_URL or not settings.FORGEJO_TOKEN:
        raise TimeTrackingServiceError("Forgejo API credentials are not configured.")

    url = f"{settings.FORGEJO_BASE_URL.rstrip('/')}/api/v1/users/search"

    headers = {"Authorization": f"token {settings.FORGEJO_TOKEN}"}

    cache_key = "forgejo:users:list"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    users = []
    page = 1
    max_pages = 50

    while True:
        if page > max_pages:
            break

        params = {"page": page, "limit": 50}
        try:
            res = _HTTP_SESSION.get(url, headers=headers, params=params, timeout=15)
            res.raise_for_status()
            data = res.json()
        except (requests.RequestException, ValueError) as exc:
            raise TimeTrackingServiceError(
                "Failed to fetch users from Forgejo."
            ) from exc

        user_list = data.get("data", []) if isinstance(data, dict) else data
        if not user_list:
            break
        if not isinstance(user_list, list):
            raise TimeTrackingServiceError(
                "Unexpected response format from Forgejo API."
            )

        for user in user_list:
            if isinstance(user, dict) and user.get("username"):
                users.append(
                    {
                        "username": user["username"],
                        "full_name": user.get("full_name") or user["username"],
                        "avatar_url": user.get("avatar_url", ""),
                    }
                )

        page += 1

    cache.set(cache_key, users, timeout=300)
    return users
