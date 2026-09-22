/**
 * The write audit — and the dedupe record for every HCP write (plan §5.3).
 *
 * A tool step can re-run after an interruption, so a write is recorded
 * BEFORE it is sent, keyed on session + turn + tool call. On a replay the
 * row already exists: a completed row answers with its stored result and
 * nothing is re-sent; a pending row means the first attempt was cut off
 * between "recorded" and "confirmed", and the caller decides what that means
 * (a schedule write is safe to send again; a customer text is not).
 */
import { randomUUID } from "node:crypto";
import type { SqlExecutor, SqlRow } from "../config/sql";
import { uuidFromKey } from "../config/store";

export type WriteKind = "write_schedule" | "notify_customer";
export type WriteStatus = "pending" | "done" | "failed";

export interface WriteRecord {
  id: string;
  kind: WriteKind;
  job_id: string;
  actor: string;
  session_id: string;
  turn_id: string;
  call_id: string;
  request: unknown;
  status: WriteStatus;
  result: unknown | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface BeginInput {
  id: string;
  kind: WriteKind;
  job_id: string;
  actor: string;
  session_id: string;
  turn_id: string;
  call_id: string;
  request: unknown;
}

export interface WriteAuditStore {
  /** Record the intent. `fresh` is false when the id already existed (a replay). */
  begin(input: BeginInput): Promise<{ fresh: boolean; record: WriteRecord }>;
  complete(id: string, result: unknown): Promise<WriteRecord>;
  fail(id: string, error: string): Promise<WriteRecord>;
  /** Newest first. */
  forJob(jobId: string, limit?: number): Promise<WriteRecord[]>;
}

const TABLE = "scheduling.write_audit";
const DDL = [
  `CREATE SCHEMA IF NOT EXISTS scheduling`,
  `CREATE TABLE IF NOT EXISTS ${TABLE} (
     id           uuid PRIMARY KEY,
     kind         text NOT NULL,
     job_id       text NOT NULL,
     actor        text NOT NULL,
     session_id   text NOT NULL,
     turn_id      text NOT NULL,
     call_id      text NOT NULL,
     request      jsonb NOT NULL,
     status       text NOT NULL DEFAULT 'pending',
     result       jsonb,
     error        text,
     created_at   timestamptz NOT NULL DEFAULT now(),
     completed_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS write_audit_job ON ${TABLE} (job_id, created_at DESC)`,
];
const COLUMNS = `id::text AS id, kind, job_id, actor, session_id, turn_id, call_id, request, status, result, error, to_json(created_at)#>>'{}' AS created_at, to_json(completed_at)#>>'{}' AS completed_at`;

function row(r: SqlRow): WriteRecord {
  const j = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  return {
    id: String(r.id), kind: r.kind as WriteKind, job_id: String(r.job_id), actor: String(r.actor), session_id: String(r.session_id), turn_id: String(r.turn_id), call_id: String(r.call_id),
    request: j(r.request), status: r.status as WriteStatus, result: r.result == null ? null : j(r.result), error: (r.error as string | null) ?? null,
    created_at: String(r.created_at), completed_at: (r.completed_at as string | null) ?? null,
  };
}

export class PostgresWriteAudit implements WriteAuditStore {
  private constructor(private readonly sql: SqlExecutor) {}
  static async create(sql: SqlExecutor): Promise<PostgresWriteAudit> {
    await sql.transaction(DDL.map((text) => ({ text })));
    return new PostgresWriteAudit(sql);
  }
  private async get(id: string): Promise<WriteRecord> {
    const rows = await this.sql.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE id = $1::uuid`, [id]);
    if (!rows[0]) throw new Error(`write_audit ${id} not found`);
    return row(rows[0]);
  }
  async begin(i: BeginInput) {
    const inserted = await this.sql.query(
      `INSERT INTO ${TABLE} (id, kind, job_id, actor, session_id, turn_id, call_id, request)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id::text AS id`,
      [i.id, i.kind, i.job_id, i.actor, i.session_id, i.turn_id, i.call_id, JSON.stringify(i.request ?? null)],
    );
    return { fresh: inserted.length === 1, record: await this.get(i.id) };
  }
  async complete(id: string, result: unknown) {
    await this.sql.query(`UPDATE ${TABLE} SET status = 'done', result = $2::jsonb, completed_at = now() WHERE id = $1::uuid`, [id, JSON.stringify(result ?? null)]);
    return this.get(id);
  }
  async fail(id: string, error: string) {
    await this.sql.query(`UPDATE ${TABLE} SET status = 'failed', error = $2, completed_at = now() WHERE id = $1::uuid`, [id, error]);
    return this.get(id);
  }
  async forJob(jobId: string, limit = 20) {
    const rows = await this.sql.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE job_id = $1 ORDER BY created_at DESC LIMIT $2`, [jobId, limit]);
    return rows.map(row);
  }
}

export class InMemoryWriteAudit implements WriteAuditStore {
  private readonly rows = new Map<string, WriteRecord>();
  async begin(i: BeginInput) {
    const existing = this.rows.get(i.id);
    if (existing) return { fresh: false, record: existing };
    const record: WriteRecord = { ...i, request: i.request ?? null, status: "pending", result: null, error: null, created_at: new Date().toISOString(), completed_at: null };
    this.rows.set(i.id, record);
    return { fresh: true, record };
  }
  async complete(id: string, result: unknown) {
    const r = this.rows.get(id);
    if (!r) throw new Error(`write_audit ${id} not found`);
    Object.assign(r, { status: "done", result: result ?? null, completed_at: new Date().toISOString() });
    return r;
  }
  async fail(id: string, error: string) {
    const r = this.rows.get(id);
    if (!r) throw new Error(`write_audit ${id} not found`);
    Object.assign(r, { status: "failed", error, completed_at: new Date().toISOString() });
    return r;
  }
  async forJob(jobId: string, limit = 20) {
    return [...this.rows.values()].filter((r) => r.job_id === jobId).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }
}

export function newWriteId(key: string): string {
  return key ? uuidFromKey(key) : randomUUID();
}
