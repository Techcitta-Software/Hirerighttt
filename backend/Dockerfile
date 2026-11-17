FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY db ./db
COPY data ./data
COPY paddle_resume_parser.py ./paddle_resume_parser.py
COPY run.py ./run.py
COPY db_init.py ./db_init.py

RUN chown -R app:app /app

USER app
EXPOSE 8787
# Several worker processes per container (each request has its own unit of work, so workers share nothing in
# memory). Rule of thumb: WEB_CONCURRENCY = 2 x vCPUs. Database connections = WEB_CONCURRENCY x DB_POOL_MAX per
# container: keep (containers x that) under the database / RDS Proxy connection limit.
ENV WEB_CONCURRENCY=2 \
    DB_POOL_MAX=10
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8787} --workers ${WEB_CONCURRENCY} --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 75"]
