# Backend (Python / FastAPI)

Port **8787** — started via repo-root `npm run dev:all` or `npm run dev:backend`.

```
backend/
  app/              FastAPI application
  db/sql/           Postgres schema
  data/             Static JSON assets
  run.py            Uvicorn launcher (optional; prefer python -m uvicorn)
  db_init.py        Schema apply / verify
  requirements.txt
  Dockerfile
```

```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload
```

Production (no reload): omit `--reload`. Render/Docker use `$PORT` when set.
