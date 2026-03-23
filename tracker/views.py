from django.contrib.auth import get_user_model, login, logout
from django.contrib.auth.decorators import login_required
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_http_methods, require_POST
from datetime import date, timedelta

from .services import TimeTrackingServiceError, get_time_sum
from .analytics import (
    build_daily_breakdown,
    compute_summary_metrics,
    compute_weekly_breakdown,
    seconds_to_parts,
)

MAX_RANGE_DAYS = 366


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

    include_weekends = request.GET.get("include_weekends", "1").lower() not in ("0", "false", "no", "off")

    try:
        total_seconds, daily_seconds = get_time_sum(since, before)
    except TimeTrackingServiceError:
        return JsonResponse({"error": "Failed to load data from Forgejo"}, status=502)
    daily_breakdown = build_daily_breakdown(
        since_date,
        before_date,
        daily_seconds,
        include_weekends=include_weekends,
    )
    metrics = compute_summary_metrics(daily_breakdown)
    weekly_breakdown = compute_weekly_breakdown(daily_breakdown)

    comparison = None
    if metrics.days_count > 0:
        prev_since_date, prev_before_date = _get_previous_period_range(since_date, metrics.days_count)
        prev_since, prev_before = _format_api_range(prev_since_date, prev_before_date)
        try:
            previous_total_seconds, _ = get_time_sum(prev_since, prev_before)
            delta_seconds = metrics.total_seconds - previous_total_seconds
            delta_percent = round((delta_seconds / previous_total_seconds) * 100, 1) if previous_total_seconds > 0 else None
            comparison = {
                "period_days": metrics.days_count,
                "previous": seconds_to_parts(previous_total_seconds),
                "delta": seconds_to_parts(delta_seconds, allow_negative=True),
                "delta_percent": delta_percent,
                "direction": "up" if delta_seconds > 0 else "down" if delta_seconds < 0 else "flat",
                "previous_since": prev_since_date.isoformat(),
                "previous_before": prev_before_date.isoformat(),
            }
        except TimeTrackingServiceError:
            comparison = None

    return JsonResponse(
        {
            **seconds_to_parts(metrics.total_seconds),
            "days_count": metrics.days_count,
            "average_per_day_seconds": metrics.average_per_day_seconds,
            "average_per_day_hours": metrics.average_per_day_seconds // 3600,
            "average_per_day_minutes": (metrics.average_per_day_seconds % 3600) // 60,
            "busiest_day": metrics.busiest_day,
            "top_days": metrics.top_days,
            "include_weekends": include_weekends,
            "insights": {
                "active_days": metrics.active_days,
                "inactive_days": metrics.inactive_days,
                "activity_rate_percent": metrics.activity_rate_percent,
                "longest_streak_days": metrics.longest_streak_days,
                "current_streak_days": metrics.current_streak_days,
                "weekday": seconds_to_parts(metrics.weekday_seconds),
                "weekend": seconds_to_parts(metrics.weekend_seconds),
                "weekday_share_percent": metrics.weekday_share_percent,
                "weekend_share_percent": metrics.weekend_share_percent,
            },
            "comparison": comparison,
            "daily_breakdown": daily_breakdown,
            "weekly_breakdown": weekly_breakdown,
        }
    )


@login_required
def index(request):
    return render(request, "tracker/index.html")
