from django.contrib.auth import get_user_model, login, logout
from django.contrib.auth.decorators import login_required
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_http_methods, require_POST
from datetime import date, timedelta

from .services import TimeTrackingServiceError, get_time_sum

MAX_RANGE_DAYS = 366


def _seconds_to_parts(total_seconds, allow_negative=False):
    sign = -1 if total_seconds < 0 else 1
    absolute_seconds = abs(total_seconds) if allow_negative else total_seconds
    return {
        "total_seconds": total_seconds,
        "hours": absolute_seconds // 3600,
        "minutes": (absolute_seconds % 3600) // 60,
        "sign": sign if allow_negative else 1,
    }


def _build_daily_breakdown(since_date, before_date, daily_seconds):
    daily_breakdown = []
    current_day = since_date
    while current_day <= before_date:
        day = current_day.isoformat()
        seconds = daily_seconds.get(day, 0)
        daily_breakdown.append(
            {
                "date": day,
                "total_seconds": seconds,
                "hours": seconds // 3600,
                "minutes": (seconds % 3600) // 60,
            }
        )
        current_day += timedelta(days=1)
    return daily_breakdown


def _calculate_streaks(daily_breakdown):
    longest = 0
    current = 0
    for row in daily_breakdown:
        if row["total_seconds"] > 0:
            current += 1
            longest = max(longest, current)
        else:
            current = 0

    current_streak = 0
    for row in reversed(daily_breakdown):
        if row["total_seconds"] > 0:
            current_streak += 1
        else:
            break

    return longest, current_streak


def _get_previous_period_range(since_date, days_count):
    prev_before_date = since_date - timedelta(days=1)
    prev_since_date = prev_before_date - timedelta(days=days_count - 1)
    return prev_since_date, prev_before_date


def _format_api_range(since_date, before_date):
    return (
        f"{since_date.isoformat()}T00:00:00Z",
        f"{before_date.isoformat()}T23:59:59Z",
    )


def _get_login_credentials():
    return settings.LOGIN_ALLOWED_USERNAME, settings.LOGIN_ALLOWED_PASSWORD


def _safe_next_url(request, next_url):
    if next_url and url_has_allowed_host_and_scheme(
        next_url,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return next_url
    return "/"


@require_http_methods(["GET", "POST"])
def login_view(request):
    if request.user.is_authenticated:
        return redirect("/")

    next_url = _safe_next_url(request, request.GET.get("next") or request.POST.get("next"))
    error = None
    allowed_username, allowed_password = _get_login_credentials()

    if request.method == "POST":
        username = request.POST.get("username", "")
        password = request.POST.get("password", "")

        if username == allowed_username and password == allowed_password:
            user_model = get_user_model()
            user, created = user_model.objects.get_or_create(
                username=allowed_username,
                defaults={"is_active": True},
            )
            if created or not user.has_usable_password() or not user.check_password(allowed_password):
                user.set_password(allowed_password)
                user.save(update_fields=["password"])

            login(request, user)
            return redirect(next_url)
        error = "Invalid username or password."

    return render(request, "tracker/login.html", {"error": error, "next": next_url})


@require_POST
def logout_view(request):
    logout(request)
    return redirect("/login/")


@login_required
def time_summary(request):
    since = request.GET.get("since")
    before = request.GET.get("before")

    if not since or not before:
        return JsonResponse({"error": "Missing params"}, status=400)

    try:
        since_date = date.fromisoformat(since[:10])
        before_date = date.fromisoformat(before[:10])
    except ValueError:
        return JsonResponse({"error": "Invalid date format"}, status=400)

    if since_date > before_date:
        return JsonResponse({"error": "Start date must be before end date"}, status=400)
    if (before_date - since_date).days + 1 > MAX_RANGE_DAYS:
        return JsonResponse({"error": f"Date range must not exceed {MAX_RANGE_DAYS} days"}, status=400)

    try:
        total_seconds, daily_seconds = get_time_sum(since, before)
    except TimeTrackingServiceError:
        return JsonResponse({"error": "Failed to load data from Forgejo"}, status=502)
    daily_breakdown = _build_daily_breakdown(since_date, before_date, daily_seconds)

    days_count = len(daily_breakdown)
    average_per_day_seconds = int(total_seconds / days_count) if days_count else 0
    busiest = max(daily_breakdown, key=lambda row: row["total_seconds"], default=None)
    busiest_day = busiest if busiest and busiest["total_seconds"] > 0 else None
    top_days = sorted(
        [row for row in daily_breakdown if row["total_seconds"] > 0],
        key=lambda row: row["total_seconds"],
        reverse=True,
    )[:3]
    active_days = sum(1 for row in daily_breakdown if row["total_seconds"] > 0)
    inactive_days = days_count - active_days
    activity_rate_percent = round((active_days / days_count) * 100, 1) if days_count else 0
    longest_streak_days, current_streak_days = _calculate_streaks(daily_breakdown)
    weekday_seconds = 0
    weekend_seconds = 0
    for row in daily_breakdown:
        if date.fromisoformat(row["date"]).weekday() < 5:
            weekday_seconds += row["total_seconds"]
        else:
            weekend_seconds += row["total_seconds"]
    weekday_share_percent = round((weekday_seconds / total_seconds) * 100, 1) if total_seconds else 0
    weekend_share_percent = round((weekend_seconds / total_seconds) * 100, 1) if total_seconds else 0

    comparison = None
    if days_count > 0:
        prev_since_date, prev_before_date = _get_previous_period_range(since_date, days_count)
        prev_since, prev_before = _format_api_range(prev_since_date, prev_before_date)
        try:
            previous_total_seconds, _ = get_time_sum(prev_since, prev_before)
            delta_seconds = total_seconds - previous_total_seconds
            delta_percent = round((delta_seconds / previous_total_seconds) * 100, 1) if previous_total_seconds > 0 else None
            comparison = {
                "period_days": days_count,
                "previous": _seconds_to_parts(previous_total_seconds),
                "delta": _seconds_to_parts(delta_seconds, allow_negative=True),
                "delta_percent": delta_percent,
                "direction": "up" if delta_seconds > 0 else "down" if delta_seconds < 0 else "flat",
                "previous_since": prev_since_date.isoformat(),
                "previous_before": prev_before_date.isoformat(),
            }
        except TimeTrackingServiceError:
            comparison = None

    return JsonResponse(
        {
            **_seconds_to_parts(total_seconds),
            "days_count": days_count,
            "average_per_day_seconds": average_per_day_seconds,
            "average_per_day_hours": average_per_day_seconds // 3600,
            "average_per_day_minutes": (average_per_day_seconds % 3600) // 60,
            "busiest_day": busiest_day,
            "top_days": top_days,
            "insights": {
                "active_days": active_days,
                "inactive_days": inactive_days,
                "activity_rate_percent": activity_rate_percent,
                "longest_streak_days": longest_streak_days,
                "current_streak_days": current_streak_days,
                "weekday": _seconds_to_parts(weekday_seconds),
                "weekend": _seconds_to_parts(weekend_seconds),
                "weekday_share_percent": weekday_share_percent,
                "weekend_share_percent": weekend_share_percent,
            },
            "comparison": comparison,
            "daily_breakdown": daily_breakdown,
        }
    )


@login_required
def index(request):
    return render(request, "tracker/index.html")
