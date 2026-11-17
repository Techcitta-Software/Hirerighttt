"""Production start-up guards."""

from __future__ import annotations

import dataclasses

import pytest

from app import node_config


def _prod(monkeypatch, **overrides) -> None:
    base = dataclasses.replace(
        node_config.config,
        environment="production",
        database_url="postgresql://u:p@localhost:5432/db",
        session_secret="x" * 40,
        cors_origins=["https://app.example.com"],
        allow_demo_accounts=False,
    )
    monkeypatch.setattr(node_config, "config", dataclasses.replace(base, **overrides))
    monkeypatch.setattr(node_config, "is_prod_like", True)
    monkeypatch.setattr("app.services.gemini_client.gemini_configured", lambda: True)


def test_demo_accounts_are_refused_in_production(monkeypatch):
    _prod(monkeypatch, allow_demo_accounts=True)
    with pytest.raises(SystemExit):
        node_config.assert_production_config()


def test_a_clean_production_config_passes(monkeypatch):
    _prod(monkeypatch)
    node_config.assert_production_config()  # does not raise
