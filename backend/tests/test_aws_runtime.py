"""Behaviour the API needs on AWS (ECS Fargate + Aurora + CloudFront). No AWS calls are made."""

from __future__ import annotations

import importlib

import pytest


def test_database_url_is_built_from_parts_with_the_password_escaped(monkeypatch):
    from app import node_config

    monkeypatch.setenv("DB_HOST", "hireright-staging.cluster-abc.ap-south-1.rds.amazonaws.com")
    monkeypatch.setenv("DB_PASSWORD", "p@ss/w:rd")
    monkeypatch.setenv("DB_USER", "hireright")
    url = node_config._database_url_from_parts()
    assert url == (
        "postgresql://hireright:p%40ss%2Fw%3Ard@hireright-staging.cluster-abc.ap-south-1.rds.amazonaws.com:5432/"
        "hireright?sslmode=require"
    )
    monkeypatch.delenv("DB_HOST")
    assert node_config._database_url_from_parts() == ""


def test_aurora_connection_uses_dns_name_and_verifies_the_certificate(monkeypatch, tmp_path):
    from psycopg.conninfo import conninfo_to_dict

    from app.db import store

    bundle = tmp_path / "db-ca.pem"
    bundle.write_text("x")
    monkeypatch.setenv("PG_DIRECT_DNS", "true")
    monkeypatch.setenv("PG_SSL_ROOT_CERT", str(bundle))
    called = []
    monkeypatch.setattr(store, "resolve_pg_host", lambda h: called.append(h) or ("10.0.0.1", h))
    info = conninfo_to_dict(
        store._pool_conninfo("postgresql://hireright:secret@db.cluster-x.ap-south-1.rds.amazonaws.com:5432/hireright?sslmode=require")
    )
    assert info["host"] == "db.cluster-x.ap-south-1.rds.amazonaws.com"  # a name, never a pinned IP (fail-over)
    assert "hostaddr" not in info
    assert info["sslmode"] == "verify-full"
    assert info["sslrootcert"] == str(bundle)
    assert info["password"] == "secret"
    assert called == []  # no DNS-over-HTTPS workaround inside the VPC


def test_local_neon_connection_is_unchanged(monkeypatch):
    from psycopg.conninfo import conninfo_to_dict

    from app.db import store

    monkeypatch.delenv("PG_DIRECT_DNS", raising=False)
    monkeypatch.setattr(store, "resolve_pg_host", lambda h: ("203.0.113.7", h))
    info = conninfo_to_dict(store._pool_conninfo("postgresql://u:p@ep-x.neon.tech/neondb?sslmode=require"))
    assert info["hostaddr"] == "203.0.113.7" and info["host"] == "ep-x.neon.tech"


def test_s3_works_with_the_task_role_and_no_access_keys(monkeypatch):
    from app.services.storage import s3_storage

    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
    monkeypatch.setenv("S3_BUCKET", "hireright-staging-files-123")
    monkeypatch.setenv("AWS_REGION", "ap-south-1")
    assert s3_storage.s3_storage_configured() is True
    monkeypatch.delenv("S3_BUCKET")
    assert s3_storage.s3_storage_configured() is False


class _Req:
    def __init__(self, headers, host="10.20.0.5"):
        self.headers = headers
        self.client = type("C", (), {"host": host})()


@pytest.mark.parametrize(
    "headers,expected",
    [
        ({"cloudfront-viewer-address": "49.37.12.8:51234", "x-forwarded-for": "1.2.3.4, 49.37.12.8"}, "49.37.12.8"),
        ({"cloudfront-viewer-address": "2401:4900:1c3a::12:443"}, "2401:4900:1c3a::12"),
        ({"x-forwarded-for": "49.37.12.8, 10.0.0.1"}, "49.37.12.8"),
    ],
)
def test_client_ip_prefers_the_address_cloudfront_saw(monkeypatch, headers, expected):
    from app.server import runtime

    original = runtime.config.trust_proxy
    object.__setattr__(runtime.config, "trust_proxy", True)  # frozen dataclass
    try:
        assert runtime.client_ip(_Req(headers)) == expected
    finally:
        object.__setattr__(runtime.config, "trust_proxy", original)


def test_ses_is_not_a_mail_provider_and_smtp_or_resend_are_pluggable(monkeypatch):
    """V-16: no SES code path. MAIL_PROVIDER=smtp|resend; an unknown value (e.g. "ses") falls back, never to AWS."""
    import asyncio

    from app.services import mail_service

    assert not hasattr(mail_service, "_send_ses")
    for k in ("MAIL_PROVIDER", "EMAIL_PROVIDER", "RESEND_API_KEY", "SMTP_EMAIL", "SMTP_APP_PASSWORD", "EMAIL_FROM"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("EMAIL_PROVIDER", "ses")
    assert mail_service.mail_provider() == "smtp"
    assert mail_service.smtp_configured() is False

    sent = []
    monkeypatch.setattr(mail_service, "_send_smtp_sync", lambda to, subject, html, text: sent.append(("smtp", to, subject)))
    monkeypatch.setenv("SMTP_EMAIL", "bot@example.com")
    monkeypatch.setenv("SMTP_APP_PASSWORD", "x")
    assert mail_service.smtp_configured() is True
    asyncio.run(mail_service.send_mail(to="cand@example.com", subject="Hi\r\nBcc: evil@example.com", html="<p>hi</p>"))
    assert sent == [("smtp", "cand@example.com", "Hi Bcc: evil@example.com")]  # no header injection

    async def fake_resend(to, subject, html, text):
        sent.append(("resend", to, subject))

    monkeypatch.setattr(mail_service, "_send_resend", fake_resend)
    monkeypatch.setenv("MAIL_PROVIDER", "resend")
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setenv("EMAIL_FROM", "HireRight <no-reply@example.com>")
    assert mail_service.smtp_configured() is True
    asyncio.run(mail_service.send_mail(to="cand@example.com", subject="Your interview", html="<p>hi</p>"))
    assert sent[-1] == ("resend", "cand@example.com", "Your interview")


def test_infrastructure_templates_parse():
    """The free-tier CloudFormation templates are valid YAML with resources (cfn-lint is run separately)."""
    from pathlib import Path

    yaml = pytest.importorskip("yaml")

    class Loader(yaml.SafeLoader):
        pass

    def any_tag(loader, suffix, node):
        if isinstance(node, yaml.ScalarNode):
            return loader.construct_scalar(node)
        if isinstance(node, yaml.SequenceNode):
            return loader.construct_sequence(node)
        return loader.construct_mapping(node)

    Loader.add_multi_constructor("!", any_tag)
    root = Path(__file__).resolve().parents[2] / "infra"
    if not (root / "aws" / "template.yaml").exists():
        pytest.skip("infra/aws/template.yaml not present")
    for rel in ("aws/template.yaml",):
        doc = yaml.load((root / rel).read_text(encoding="utf-8"), Loader=Loader)
        assert doc["Resources"], rel
        text = (root / rel).read_text(encoding="utf-8")
        for paid in ("AWS::SES::", "AWS::EC2::NatGateway", "AWS::ElasticLoadBalancingV2::", "AWS::RDS::DBCluster",
                     "AWS::ElastiCache::", "AWS::SecretsManager::", "PowerUserAccess", "ManageMasterUserPassword",
                     "MultiAZ: true", "AWS::ECS::", "AWS::EKS::"):
            assert paid not in text, (rel, paid)
    importlib.import_module("app.main")
