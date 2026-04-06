from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from collections import defaultdict


def seconds_to_parts(
    total_seconds: int, allow_negative: bool = False
) -> dict[str, int]:
    sign = -1 if total_seconds < 0 else 1
    absolute_seconds = abs(total_seconds) if allow_negative else total_seconds
    return {
        "total_seconds": total_seconds,
        "hours": absolute_seconds // 3600,
        "minutes": (absolute_seconds % 3600) // 60,
        "sign": sign if allow_negative else 1,
    }


def build_daily_breakdown(
    since_date: date,
    before_date: date,
    daily_seconds: dict[str, int],
    include_weekends: bool = True,
) -> list[dict[str, int | str]]:
    daily_breakdown: list[dict[str, int | str]] = []
    current_day = since_date
    while current_day <= before_date:
        if include_weekends or current_day.weekday() < 5:
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


def calculate_streaks(daily_breakdown: list[dict[str, int | str]]) -> tuple[int, int]:
    longest = 0
    current = 0
    for row in daily_breakdown:
        if int(row["total_seconds"]) > 0:
            current += 1
            longest = max(longest, current)
        else:
            current = 0

    current_streak = 0
    for row in reversed(daily_breakdown):
        if int(row["total_seconds"]) > 0:
            current_streak += 1
        else:
            break

    return longest, current_streak


def compute_weekly_breakdown(
    daily_breakdown: list[dict[str, int | str]],
) -> list[dict[str, int | str]]:
    weekly: dict[str, int] = {}
    for row in daily_breakdown:
        day = date.fromisoformat(str(row["date"]))
        monday = (day - timedelta(days=day.weekday())).isoformat()
        weekly[monday] = weekly.get(monday, 0) + int(row["total_seconds"])

    return [
        {
            "week_start": week_start,
            "total_seconds": seconds,
            "hours": seconds // 3600,
            "minutes": (seconds % 3600) // 60,
        }
        for week_start, seconds in sorted(weekly.items())
    ]


@dataclass
class SummaryMetrics:
    total_seconds: int
    days_count: int
    average_per_day_seconds: int
    busiest_day: dict[str, int | str] | None
    top_days: list[dict[str, int | str]]
    active_days: int
    inactive_days: int
    activity_rate_percent: float
    longest_streak_days: int
    current_streak_days: int
    weekday_seconds: int
    weekend_seconds: int
    weekday_share_percent: float
    weekend_share_percent: float


def compute_summary_metrics(
    daily_breakdown: list[dict[str, int | str]],
) -> SummaryMetrics:
    total_seconds = sum(int(row["total_seconds"]) for row in daily_breakdown)
    days_count = len(daily_breakdown)
    average_per_day_seconds = int(total_seconds / days_count) if days_count else 0
    busiest = max(
        daily_breakdown, key=lambda row: int(row["total_seconds"]), default=None
    )
    busiest_day = busiest if busiest and int(busiest["total_seconds"]) > 0 else None
    top_days = sorted(
        [row for row in daily_breakdown if int(row["total_seconds"]) > 0],
        key=lambda row: int(row["total_seconds"]),
        reverse=True,
    )[:3]
    active_days = sum(1 for row in daily_breakdown if int(row["total_seconds"]) > 0)
    inactive_days = days_count - active_days
    activity_rate_percent = (
        round((active_days / days_count) * 100, 1) if days_count else 0
    )
    longest_streak_days, current_streak_days = calculate_streaks(daily_breakdown)

    weekday_seconds = 0
    weekend_seconds = 0
    for row in daily_breakdown:
        if date.fromisoformat(str(row["date"])).weekday() < 5:
            weekday_seconds += int(row["total_seconds"])
        else:
            weekend_seconds += int(row["total_seconds"])

    weekday_share_percent = (
        round((weekday_seconds / total_seconds) * 100, 1) if total_seconds else 0
    )
    weekend_share_percent = (
        round((weekend_seconds / total_seconds) * 100, 1) if total_seconds else 0
    )

    return SummaryMetrics(
        total_seconds=total_seconds,
        days_count=days_count,
        average_per_day_seconds=average_per_day_seconds,
        busiest_day=busiest_day,
        top_days=top_days,
        active_days=active_days,
        inactive_days=inactive_days,
        activity_rate_percent=activity_rate_percent,
        longest_streak_days=longest_streak_days,
        current_streak_days=current_streak_days,
        weekday_seconds=weekday_seconds,
        weekend_seconds=weekend_seconds,
        weekday_share_percent=weekday_share_percent,
        weekend_share_percent=weekend_share_percent,
    )


def compute_heatmap_data(
    daily_breakdown: list[dict[str, int | str]],
) -> list[dict[str, int | str]]:
    return [
        {
            "date": row["date"],
            "total_seconds": int(row["total_seconds"]),
            "weekday": date.fromisoformat(str(row["date"])).weekday(),
        }
        for row in daily_breakdown
    ]


def compute_trend_data(
    daily_breakdown: list[dict[str, int | str]],
    window: int = 7,
) -> list[dict[str, int | str | float]]:
    if not daily_breakdown:
        return []
    daily_hours = []
    for row in daily_breakdown:
        d = date.fromisoformat(str(row["date"]))
        h = int(row["total_seconds"]) / 3600
        daily_hours.append({"date": str(d), "hours": h})
    result = []
    for i, entry in enumerate(daily_hours):
        start = max(0, i - window + 1)
        window_entries = daily_hours[start : i + 1]
        avg = sum(e["hours"] for e in window_entries) / len(window_entries)
        result.append(
            {
                "date": entry["date"],
                "hours": entry["hours"],
                "moving_avg": round(avg, 2),
            }
        )
    return result


def compute_project_breakdown(
    issue_seconds: dict[str, int],
) -> list[dict[str, int | str]]:
    project_seconds: dict[str, int] = defaultdict(int)
    for issue_label, seconds in issue_seconds.items():
        repo_part = issue_label.split("#")[0].strip()
        if repo_part:
            project_seconds[repo_part] += seconds
    return sorted(
        [
            {
                "project": proj,
                "total_seconds": secs,
                "hours": secs // 3600,
                "minutes": (secs % 3600) // 60,
            }
            for proj, secs in project_seconds.items()
        ],
        key=lambda x: x["total_seconds"],
        reverse=True,
    )


def compute_hourly_distribution(
    daily_breakdown: list[dict[str, int | str]],
) -> list[dict[str, int | float]]:
    weekday_totals = [0] * 7
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    for row in daily_breakdown:
        d = date.fromisoformat(str(row["date"]))
        weekday_totals[d.weekday()] += int(row["total_seconds"])
    total = sum(weekday_totals) or 1
    return [
        {
            "day": day_names[i],
            "total_seconds": weekday_totals[i],
            "hours": round(weekday_totals[i] / 3600, 1),
            "share_percent": round((weekday_totals[i] / total) * 100, 1),
        }
        for i in range(7)
    ]


def compute_monthly_totals(
    daily_breakdown: list[dict[str, int | str]],
) -> list[dict[str, int | str]]:
    monthly: dict[str, int] = {}
    for row in daily_breakdown:
        d = date.fromisoformat(str(row["date"]))
        month_key = d.strftime("%Y-%m")
        monthly[month_key] = monthly.get(month_key, 0) + int(row["total_seconds"])
    return sorted(
        [
            {
                "month": month_key,
                "total_seconds": secs,
                "hours": secs // 3600,
                "minutes": (secs % 3600) // 60,
            }
            for month_key, secs in monthly.items()
        ],
        key=lambda x: x["month"],
    )


@dataclass
class AdvancedMetrics:
    heatmap: list[dict[str, int | str]] = field(default_factory=list)
    trend: list[dict[str, int | str | float]] = field(default_factory=list)
    project_breakdown: list[dict[str, int | str]] = field(default_factory=list)
    hourly_distribution: list[dict[str, int | float]] = field(default_factory=list)
    monthly_totals: list[dict[str, int | str]] = field(default_factory=list)


def compute_advanced_metrics(
    daily_breakdown: list[dict[str, int | str]],
    issue_seconds: dict[str, int],
) -> AdvancedMetrics:
    return AdvancedMetrics(
        heatmap=compute_heatmap_data(daily_breakdown),
        trend=compute_trend_data(daily_breakdown),
        project_breakdown=compute_project_breakdown(issue_seconds),
        hourly_distribution=compute_hourly_distribution(daily_breakdown),
        monthly_totals=compute_monthly_totals(daily_breakdown),
    )
