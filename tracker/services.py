from collections import defaultdict
from datetime import date, datetime, timezone
import logging

import requests
from django.conf import settings
from django.core.cache import cache


logger = logging.getLogger(__name__)


class TimeTrackingServiceError(Exception):
    pass


_HTTP_SESSION = requests.Session()


def _parse_entry_date(entry):
    for key in ("updatedAt", "updated", "createdAt", "created", "date"):
        value = entry.get(key)
        if not value or not isinstance(value, str):
            continue

        normalized = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized).date()
        except ValueError:
            continue

    created_unix = entry.get("created_unix")
    if isinstance(created_unix, str) and created_unix.isdigit():
        created_unix = int(created_unix)
    if isinstance(created_unix, int):
        return datetime.fromtimestamp(created_unix, tz=timezone.utc).date()

    return None


def _extract_stopwatch_seconds(card):
    stopwatch = card.get("stopwatch")
    if not isinstance(stopwatch, dict):
        return 0

    try:
        return max(0, int(stopwatch.get("total", 0)))
    except (TypeError, ValueError):
        return 0


def _extract_card_label(card, project_name, board_name):
    card_name = str(card.get("name") or "").strip() or "Untitled card"
    project_name = str(project_name or "").strip()
    board_name = str(board_name or "").strip()

    if project_name and board_name:
        return f"{project_name}#{board_name} · {card_name}"
    if project_name:
        return f"{project_name}#{card_name}"
    if board_name:
        return f"{board_name}#{card_name}"
    return card_name


def _get_headers():
    if not settings.PLANKA_BASE_URL or not settings.PLANKA_TOKEN:
        raise TimeTrackingServiceError("Planka API credentials are not configured.")

    return {
        "X-Api-Key": settings.PLANKA_TOKEN,
        "Accept": "application/json",
    }


def _request_json(path, *, params=None):
    url = f"{settings.PLANKA_BASE_URL.rstrip('/')}{path}"
    response = None

    try:
        response = _HTTP_SESSION.get(
            url,
            headers=_get_headers(),
            params=params,
            timeout=20,
        )
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as exc:
        status_code = (
            exc.response.status_code
            if exc.response is not None
            else response.status_code
            if response is not None
            else None
        )
        if status_code in (401, 403):
            message = "Planka authentication failed. Check whether PLANKA_TOKEN is valid."
        elif status_code == 404:
            message = "Planka API endpoint was not found. Check PLANKA_BASE_URL."
        else:
            message = f"Planka API request failed with status {status_code or 'unknown'}."

        logger.warning("Planka API error for %s: %s", url, message, exc_info=exc)
        raise TimeTrackingServiceError(message) from exc
    except requests.RequestException as exc:
        logger.warning("Planka network error for %s", url, exc_info=exc)
        raise TimeTrackingServiceError(
            "Could not reach Planka. Check PLANKA_BASE_URL and network access."
        ) from exc
    except ValueError as exc:
        logger.warning("Planka returned invalid JSON for %s", url, exc_info=exc)
        raise TimeTrackingServiceError("Planka returned an invalid JSON response.") from exc


def _fetch_visible_boards():
    cache_key = "planka:visible-boards"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    projects_payload = _request_json("/api/projects")
    items = projects_payload.get("items", []) if isinstance(projects_payload, dict) else []
    included = (
        projects_payload.get("included", {}) if isinstance(projects_payload, dict) else {}
    )

    if not isinstance(items, list) or not isinstance(included, dict):
        raise TimeTrackingServiceError("Unexpected response format from Planka projects.")

    boards = included.get("boards", [])
    if not isinstance(boards, list):
        raise TimeTrackingServiceError("Unexpected board data from Planka projects.")

    project_by_id = {
        project.get("id"): project
        for project in items
        if isinstance(project, dict) and project.get("id")
    }

    board_contexts = []
    for board in boards:
        if not isinstance(board, dict) or not board.get("id"):
            continue

        board_payload = _request_json(f"/api/boards/{board['id']}")
        included_board = (
            board_payload.get("included", {}) if isinstance(board_payload, dict) else {}
        )
        board_item = board_payload.get("item", {}) if isinstance(board_payload, dict) else {}

        if not isinstance(board_item, dict) or not isinstance(included_board, dict):
            raise TimeTrackingServiceError("Unexpected response format from Planka board.")

        cards = included_board.get("cards", [])
        users = included_board.get("users", [])
        card_memberships = included_board.get("cardMemberships", [])

        if not isinstance(cards, list) or not isinstance(users, list):
            raise TimeTrackingServiceError("Unexpected card data from Planka board.")

        project = project_by_id.get(board.get("projectId"))
        if project is None:
            projects = included_board.get("projects", [])
            if isinstance(projects, list) and projects:
                project = projects[0]

        board_contexts.append(
            {
                "board": board_item,
                "project": project or {},
                "cards": cards,
                "users": users,
                "card_memberships": (
                    card_memberships if isinstance(card_memberships, list) else []
                ),
            }
        )

    cache.set(cache_key, board_contexts, timeout=120)
    return board_contexts


def _user_identifier(user):
    return str(user.get("username") or user.get("name") or "").strip()


def _card_matches_username(card, memberships_by_card_id, users_by_id, username):
    username = str(username or "").strip().lower()
    if not username:
        return True

    creator = users_by_id.get(card.get("creatorUserId"))
    if creator and _user_identifier(creator).lower() == username:
        return True

    for user_id in memberships_by_card_id.get(card.get("id"), set()):
        user = users_by_id.get(user_id)
        if user and _user_identifier(user).lower() == username:
            return True

    return False


def get_time_sum(since, before, username=None):
    try:
        since_date = date.fromisoformat(str(since)[:10])
        before_date = date.fromisoformat(str(before)[:10])
    except ValueError as exc:
        raise TimeTrackingServiceError("Invalid date range supplied.") from exc

    cache_key = f"planka:time_sum:{since_date}:{before_date}:{username or 'all'}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    total_seconds = 0
    daily_seconds = defaultdict(int)
    issue_seconds = defaultdict(int)

    for board_context in _fetch_visible_boards():
        board = board_context["board"]
        project = board_context["project"]
        cards = board_context["cards"]
        users = board_context["users"]
        card_memberships = board_context["card_memberships"]

        users_by_id = {
            user.get("id"): user for user in users if isinstance(user, dict) and user.get("id")
        }
        memberships_by_card_id = defaultdict(set)
        for membership in card_memberships:
            if not isinstance(membership, dict):
                continue
            card_id = membership.get("cardId")
            user_id = membership.get("userId")
            if card_id and user_id:
                memberships_by_card_id[card_id].add(user_id)

        project_name = str(project.get("name") or "").strip()
        board_name = str(board.get("name") or "").strip()

        for card in cards:
            if not isinstance(card, dict):
                continue

            seconds = _extract_stopwatch_seconds(card)
            if seconds <= 0:
                continue

            entry_date = _parse_entry_date(card)
            if entry_date is None or not (since_date <= entry_date <= before_date):
                continue

            if username and not _card_matches_username(
                card, memberships_by_card_id, users_by_id, username
            ):
                continue

            total_seconds += seconds
            daily_seconds[entry_date.isoformat()] += seconds

            card_label = _extract_card_label(card, project_name, board_name)
            issue_seconds[card_label] += seconds

    result = (
        total_seconds,
        dict(sorted(daily_seconds.items())),
        dict(sorted(issue_seconds.items(), key=lambda item: item[1], reverse=True)),
    )
    cache.set(cache_key, result, timeout=120)
    return result


def get_planka_users():
    cache_key = "planka:users:list"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    users_by_username = {}
    for board_context in _fetch_visible_boards():
        for user in board_context["users"]:
            if not isinstance(user, dict):
                continue

            identifier = _user_identifier(user)
            if not identifier:
                continue

            avatar = user.get("avatar")
            avatar_url = ""
            if isinstance(avatar, dict):
                avatar_url = str(avatar.get("url") or "")
            elif isinstance(avatar, str):
                avatar_url = avatar
            elif isinstance(user.get("avatarUrl"), str):
                avatar_url = user.get("avatarUrl")

            users_by_username[identifier] = {
                "username": identifier,
                "full_name": str(user.get("name") or identifier),
                "avatar_url": avatar_url,
            }

    users = [
        users_by_username[username]
        for username in sorted(users_by_username, key=lambda value: value.lower())
    ]
    cache.set(cache_key, users, timeout=300)
    return users
