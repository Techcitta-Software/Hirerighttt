"""Minimal psycopg-shaped connection for assessment routes on DynamoDB."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any

from app.db import dynamo_repos as dr


class _Cursor:
    def __init__(self, rows: list[dict] | dict | None) -> None:
        self._rows = rows if isinstance(rows, list) else ([rows] if rows else [])

    def fetchone(self) -> dict | None:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[dict]:
        return list(self._rows)


class DynamoConnection:
    row_factory: Any = None

    def __enter__(self) -> DynamoConnection:
        return self

    def __exit__(self, *args: Any) -> None:
        return None

    def commit(self) -> None:
        pass

    def execute(self, sql: str, params: tuple | list | None = None) -> _Cursor:
        params = tuple(params or ())
        s = " ".join(sql.split()).lower()
        # Reads
        if "from users where email" in s:
            return _Cursor(dr.get_user_by_email_dynamo(str(params[0])))
        if "from assessment_sessions where id" in s:
            return _Cursor(dr.assess_get("assessment_sessions", str(params[0])))
        if "from assessment_jobs where id" in s:
            return _Cursor(dr.assess_get("assessment_jobs", str(params[0])))
        if "from interview_plans where id" in s:
            return _Cursor(dr.assess_get("interview_plans", str(params[0])))
        if "from assessment_resumes" in s:
            return _Cursor(dr.assess_get("assessment_resumes", str(params[0])))
        if "from interview_questions where plan_id" in s:
            rows = dr.assess_list("interview_questions", plan_id=str(params[0]))
            rows.sort(key=lambda r: int(r.get("position") or 0))
            return _Cursor([{"data": r.get("data") or r} for r in rows])
        if "from interview_answers where session_id" in s:
            rows = dr.assess_list("interview_answers", session_id=str(params[0]))
            rows.sort(key=lambda r: r.get("created_at") or "")
            return _Cursor(rows)
        if "from answer_evaluations" in s and "session_id" in s:
            return _Cursor(dr.assess_list("answer_evaluations", session_id=str(params[0])))
        if "from organization_members" in s and "organization_id" in s:
            from app.db.dynamo_relational import load_db_dynamo

            db = load_db_dynamo()
            for m in db.get("organizationMembers") or []:
                if m.get("userId") == params[0] and m.get("organizationId") == params[1]:
                    return _Cursor({"role": m.get("role")})
            return _Cursor(None)
        if "from organizations" in s:
            from app.db.dynamo_relational import load_db_dynamo

            db = load_db_dynamo()
            for o in db.get("organizations") or []:
                if o.get("id") == params[1]:
                    return _Cursor(o)
            return _Cursor(None)
        # Writes (INSERT/UPDATE) — assessment service passes row dicts in params
        if s.startswith("insert") or s.startswith("update"):
            table = _table_from_sql(sql)
            if table and params:
                row = _insert_params_to_row(table, params)
                if row:
                    dr.assess_put(table, row, org_id=row.get("organization_id"), user_id=row.get("candidate_id"))
        return _Cursor([])


class DynamoAssessmentPool:
    def connection(self) -> DynamoConnection:
        return DynamoConnection()


def _table_from_sql(sql: str) -> str | None:
    m = re.search(r"into\s+(\w+)", sql, re.I)
    if m:
        return m.group(1)
    m = re.search(r"update\s+(\w+)", sql, re.I)
    return m.group(1) if m else None


def _insert_params_to_row(table: str, params: tuple) -> dict | None:
    if table == "assessment_jobs" and len(params) >= 3:
        return {"id": str(params[0]), "organization_id": str(params[1]), "title": params[2]}
    if table == "interview_questions" and len(params) >= 4:
        return {
            "plan_id": str(params[0]),
            "question_id": str(params[1]),
            "position": params[2],
            "data": params[3] if isinstance(params[3], dict) else json.loads(str(params[3])),
        }
    if table == "assessment_sessions" and len(params) >= 1:
        return params[0] if isinstance(params[0], dict) else {"id": str(params[0])}
    return None