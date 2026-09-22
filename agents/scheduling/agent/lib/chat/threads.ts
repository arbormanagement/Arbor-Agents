/**
 * Where each person's DM lives — recorded the first time they write, so a
 * schedule (phase 7: the Thursday "build next week" prompt, the weekly session
 * rotation) can address the thread with `to(channel, { adapterName, threadId })`
 * WITHOUT domain-wide delegation. The bot never has to open a DM; it only
 * answers in one it was already given.
 */
import type { SqlExecutor, SqlRow } from "../config/sql";

export interface ChatThread {
  email: string;
  adapter: string;
  thread_id: string;
  display_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface ChatThreadStore {
  /** Upsert: a new thread for the person replaces the old one (a DM space is stable, but be safe). */
  record(input: { email: string; adapter: string; threadId: string; displayName?: string | null }): Promise<ChatThread>;
  forPerson(email: string, adapter?: string): Promise<ChatThread | null>;
  all(): Promise<ChatThread[]>;
}

const TABLE = "scheduling.chat_threads";
const DDL = [
  `CREATE SCHEMA IF NOT EXISTS scheduling`,
  `CREATE TABLE IF NOT EXISTS ${TABLE} (
     email         text NOT NULL,
     adapter       text NOT NULL,
     thread_id     text NOT NULL,
     display_name  text,
     first_seen_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at  timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (email, adapter)
   )`,
];

function rowToThread(r: SqlRow): ChatThread {
  const ts = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  return {
    email: String(r.email),
    adapter: String(r.adapter),
    thread_id: String(r.thread_id),
    display_name: r.display_name == null ? null : String(r.display_name),
    first_seen_at: ts(r.first_seen_at),
    last_seen_at: ts(r.last_seen_at),
  };
}

export class PostgresChatThreads implements ChatThreadStore {
  private constructor(private readonly sql: SqlExecutor) {}
  static async create(sql: SqlExecutor): Promise<PostgresChatThreads> {
    for (const stmt of DDL) await sql.query(stmt);
    return new PostgresChatThreads(sql);
  }
  async record(input: { email: string; adapter: string; threadId: string; displayName?: string | null }): Promise<ChatThread> {
    const rows = await this.sql.query(
      `INSERT INTO ${TABLE} (email, adapter, thread_id, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email, adapter) DO UPDATE
         SET thread_id = EXCLUDED.thread_id,
             display_name = COALESCE(EXCLUDED.display_name, ${TABLE}.display_name),
             last_seen_at = now()
       RETURNING *`,
      [input.email.toLowerCase(), input.adapter, input.threadId, input.displayName ?? null],
    );
    return rowToThread(rows[0]!);
  }
  async forPerson(email: string, adapter = "gchat"): Promise<ChatThread | null> {
    const rows = await this.sql.query(`SELECT * FROM ${TABLE} WHERE email = $1 AND adapter = $2`, [email.toLowerCase(), adapter]);
    return rows[0] ? rowToThread(rows[0]) : null;
  }
  async all(): Promise<ChatThread[]> {
    return (await this.sql.query(`SELECT * FROM ${TABLE} ORDER BY email, adapter`)).map(rowToThread);
  }
}

export class InMemoryChatThreads implements ChatThreadStore {
  private readonly rows = new Map<string, ChatThread>();
  async record(input: { email: string; adapter: string; threadId: string; displayName?: string | null }): Promise<ChatThread> {
    const email = input.email.toLowerCase();
    const key = `${email}\u0000${input.adapter}`;
    const now = new Date().toISOString();
    const prev = this.rows.get(key);
    const row: ChatThread = {
      email,
      adapter: input.adapter,
      thread_id: input.threadId,
      display_name: input.displayName ?? prev?.display_name ?? null,
      first_seen_at: prev?.first_seen_at ?? now,
      last_seen_at: now,
    };
    this.rows.set(key, row);
    return row;
  }
  async forPerson(email: string, adapter = "gchat"): Promise<ChatThread | null> {
    return this.rows.get(`${email.toLowerCase()}\u0000${adapter}`) ?? null;
  }
  async all(): Promise<ChatThread[]> {
    return [...this.rows.values()].sort((a, b) => a.email.localeCompare(b.email) || a.adapter.localeCompare(b.adapter));
  }
}
