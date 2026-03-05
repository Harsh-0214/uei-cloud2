from __future__ import annotations

from datetime import datetime
from typing import Optional, Any
import os
import re

import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="UEI Cloud API", version="1.0")

DB_HOST = os.environ.get("DB_HOST", "postgres")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "uei")
DB_USER = os.environ.get("DB_USER", "uei")
DB_PASS = os.environ.get("DB_PASS", "uei_password")

def db_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS
    )

class TelemetryPacket(BaseModel):
    ts_utc: str
    node_id: str
    bms_id: str

    soc: float = Field(ge=0.0, le=100.0)
    pack_voltage: float
    pack_current: float
    temp_high: float
    temp_low: float
    ccl: float
    dcl: float
    fault_active: bool
    faults_cleared_min: float
    highest_cell_v: float
    lowest_cell_v: float

@app.post("/telemetry")
def ingest(pkt: TelemetryPacket):
    try:
        ts = datetime.fromisoformat(pkt.ts_utc.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=422, detail="ts_utc must be ISO8601")

    q = """
    INSERT INTO telemetry (
      ts_utc, node_id, bms_id, soc, pack_voltage, pack_current, temp_high, temp_low,
      ccl, dcl, fault_active, faults_cleared_min, highest_cell_v, lowest_cell_v
    ) VALUES (
      %s,%s,%s,%s,%s,%s,%s,%s,
      %s,%s,%s,%s,%s,%s
    );
    """
    vals = (
        ts, pkt.node_id, pkt.bms_id, pkt.soc, pkt.pack_voltage, pkt.pack_current,
        pkt.temp_high, pkt.temp_low, pkt.ccl, pkt.dcl, pkt.fault_active,
        pkt.faults_cleared_min, pkt.highest_cell_v, pkt.lowest_cell_v
    )

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q, vals)

    return {"status": "ok", "node_id": pkt.node_id}

@app.get("/latest")
def latest(node_id: Optional[str] = None) -> Any:
    if node_id:
        q = "SELECT * FROM telemetry WHERE node_id=%s ORDER BY ts_utc DESC LIMIT 1;"
        params = (node_id,)
    else:
        q = """
        SELECT DISTINCT ON (node_id) *
        FROM telemetry
        ORDER BY node_id, ts_utc DESC;
        """
        params = None

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(q, params)
            rows = cur.fetchall()

    if node_id and not rows:
        raise HTTPException(status_code=404, detail="unknown node_id")
    return rows[0] if node_id else rows


@app.get("/schema")
def schema() -> Any:
    """Return the database schema as plain text (for the AI chatbot)."""
    q = """
    SELECT t.table_name, c.column_name, c.data_type, c.is_nullable
    FROM information_schema.tables t
    JOIN information_schema.columns c
        ON t.table_name   = c.table_name
       AND t.table_schema = c.table_schema
    WHERE t.table_schema = 'public'
      AND t.table_type   = 'BASE TABLE'
    ORDER BY t.table_name, c.ordinal_position
    """
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q)
            rows = cur.fetchall()

    tables: dict[str, list[str]] = {}
    for table, col, dtype, nullable in rows:
        note = "  -- nullable" if nullable == "YES" else ""
        tables.setdefault(table, []).append(f"  {col}  {dtype}{note}")

    lines = ["PostgreSQL database schema (read-only):"]
    for table, cols in tables.items():
        lines.append(f"\nTable: {table}")
        lines.extend(cols)
    return "\n".join(lines)


class QueryRequest(BaseModel):
    sql: str


_BLOCKED = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|COPY)\b",
    re.IGNORECASE,
)


@app.post("/query")
def query(req: QueryRequest) -> Any:
    """Execute a read-only SELECT query (used by the AI chatbot)."""
    stripped = req.sql.strip()

    if not re.match(r"^\s*SELECT\b", stripped, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Only SELECT queries are permitted.")
    if _BLOCKED.search(stripped):
        raise HTTPException(status_code=400, detail="Query contains a forbidden keyword.")
    if ";" in stripped.rstrip(";"):
        raise HTTPException(status_code=400, detail="Multi-statement queries are not allowed.")

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(stripped)
            rows = cur.fetchmany(200)

    return [dict(r) for r in rows]
