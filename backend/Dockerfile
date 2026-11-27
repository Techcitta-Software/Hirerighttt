FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

# Runtime dependencies only (pytest and other dev tools live in requirements-dev.txt and never ship in the image).
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Database TLS on AWS: one trust bundle = public CAs (certifi: Neon) + the Amazon RDS CAs.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
RUN python -c "import certifi; open('/app/certs/db-ca.pem','w').write(open(certifi.where()).read() + open('/app/certs/rds-global-bundle.pem').read())"
ENV PG_SSL_ROOT_CERT=/app/certs/db-ca.pem

COPY app ./app
COPY db ./db
COPY data ./data
COPY run.py ./run.py
COPY db_init.py ./db_init.py

RUN chown -R app:app /app

USER app
EXPOSE 8787
# Worker processes per container (each request has its own unit of work, so workers share nothing in memory).
# Free-tier micro instance (1 GB RAM, 2 vCPU): 2 workers x DB_POOL_MAX 5 = 10 database connections.
# FORWARDED_ALLOW_IPS: only the nginx container on the compose network may set X-Forwarded-For (V-24). The API port
# is not published on the host, so nothing else can reach uvicorn; the compose file pins the network subnet.
ENV WEB_CONCURRENCY=2 \
    DB_POOL_MIN=1 \
    DB_POOL_MAX=5 \
    FORWARDED_ALLOW_IPS=172.28.0.0/24
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:%s/api/health/live' % os.environ.get('PORT','8787'), timeout=4)" || exit 1
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8787} --workers ${WEB_CONCURRENCY} --proxy-headers --forwarded-allow-ips=\"${FORWARDED_ALLOW_IPS}\" --timeout-keep-alive 75"]
