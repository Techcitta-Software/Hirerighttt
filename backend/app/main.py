"""HireRight API — FastAPI entry (Neon + express compat for remaining routes)."""

from app.server.create_app import create_app

app = create_app()
