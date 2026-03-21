import requests
from django.conf import settings

def get_time_sum(since, before):
    url = f"{settings.FORGEJO_BASE_URL}/api/v1/user/times"

    headers = {
        "Authorization": f"token {settings.FORGEJO_TOKEN}"
    }

    params = {
        "since": since,
        "before": before
    }

    total_seconds = 0
    page = 1

    while True:
        params["page"] = page
        res = requests.get(url, headers=headers, params=params)
        data = res.json()

        if not data:
            break

        total_seconds += sum(entry["time"] for entry in data)
        page += 1

    return total_seconds