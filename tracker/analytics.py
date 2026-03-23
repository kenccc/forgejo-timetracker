from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta


def seconds_to_parts(total_seconds: int, allow_negative: bool = False) -> dict[str, int]:
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


def compute_weekly_breakdown(daily_breakdown: list[dict[str, int | str]]) -> list[dict[str, int | str]]:
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
    busiest = max(daily_breakdown, key=lambda row: int(row["total_seconds"]), default=None)
    busiest_day = busiest if busiest and int(busiest["total_seconds"]) > 0 else None
    top_days = sorted(
        [row for row in daily_breakdown if int(row["total_seconds"]) > 0],
        key=lambda row: int(row["total_seconds"]),
        reverse=True,
    )[:3]
    active_days = sum(1 for row in daily_breakdown if int(row["total_seconds"]) > 0)
    inactive_days = days_count - active_days
    activity_rate_percent = round((active_days / days_count) * 100, 1) if days_count else 0
    longest_streak_days, current_streak_days = calculate_streaks(daily_breakdown)

    weekday_seconds = 0
    weekend_seconds = 0
    for row in daily_breakdown:
        if date.fromisoformat(str(row["date"])).weekday() < 5:
            weekday_seconds += int(row["total_seconds"])
        else:
            weekend_seconds += int(row["total_seconds"])

    weekday_share_percent = round((weekday_seconds / total_seconds) * 100, 1) if total_seconds else 0
    weekend_share_percent = round((weekend_seconds / total_seconds) * 100, 1) if total_seconds else 0

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
