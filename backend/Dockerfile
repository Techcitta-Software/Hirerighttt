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
CMD ["python", "run.py"]
