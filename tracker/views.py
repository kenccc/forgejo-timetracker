from django.shortcuts import render
from django.http import JsonResponse
from .services import get_time_sum


def time_summary(request):
    since = request.GET.get("since")
    before = request.GET.get("before")

    if not since or not before:
        return JsonResponse({"error": "Missing params"}, status=400)

    total_seconds, daily_seconds = get_time_sum(since, before)
    daily_breakdown = []
    for day, seconds in daily_seconds.items():
        daily_breakdown.append({
            "date": day,
            "total_seconds": seconds,
            "hours": seconds // 3600,
            "minutes": (seconds % 3600) // 60,
        })

    return JsonResponse({
        "total_seconds": total_seconds,
        "hours": total_seconds // 3600,
        "minutes": (total_seconds % 3600) // 60,
        "daily_breakdown": daily_breakdown,
    })


def index(request):
    return render(request, "tracker/index.html")
