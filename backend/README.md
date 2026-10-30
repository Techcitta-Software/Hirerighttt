# Backend (Python / FastAPI)

Port **8787** — started via repo-root `npm run dev:all` or `npm run dev:backend`.

```
backend/
  app/              FastAPI application
  db/sql/           Postgres schema
  data/             Static JSON assets
  run.py            Entry point
  db_init.py        Schema apply / verify
  requirements.txt
  Dockerfile
```

```bash
pip install -r requirements.txt
python run.py
```
