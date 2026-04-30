FROM python:3.12-slim

ARG CACHE_DATE=2026-04-30

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /code

RUN addgroup --system app && \
    adduser --system --ingroup app --home /home/app app

# hadolint ignore=DL3008
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pip==24.3.1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=app:app . .

RUN mkdir -p /code/staticfiles /data && \
    chown -R app:app /code/staticfiles /data && \
    chmod +x /code/entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8000/login/ || exit 1

USER app

EXPOSE 8000

ENTRYPOINT ["/code/entrypoint.sh"]
