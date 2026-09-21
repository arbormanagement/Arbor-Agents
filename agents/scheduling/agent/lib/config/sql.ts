/**
 * The SQL seam under the Postgres config store: one interface, two drivers.
 *
 *   neonExecutor   — Neon's HTTP driver. Production and preview on Vercel,
 *                    where DATABASE_URL is injected by the Neon integration.
 *   pgliteExecutor — PGlite, a real Postgres engine compiled to WebAssembly
 *                    and run in-process. Evals and local runs, no credentials.
 *
 * Both run the identical SQL, so a schema or query that passes the evals on
 * PGlite is the same schema and query that runs on Neon.
 */
import { neon } from "@neondatabase/serverless";

export interface SqlStatement {
  text: string;
  params?: unknown[];
}

export type SqlRow = Record<string, unknown>;

export interface SqlExecutor {
  /** One parameterized statement; returns its rows. */
  query(text: string, params?: unknown[]): Promise<SqlRow[]>;
  /** Several statements, in order, inside one transaction. All or nothing. */
  transaction(statements: SqlStatement[]): Promise<void>;
}

export function neonExecutor(connectionString: string): SqlExecutor {
  const sql = neon(connectionString);
  return {
    async query(text, params = []) {
      return (await sql.query(text, params)) as SqlRow[];
    },
    async transaction(statements) {
      await sql.transaction((tx) => statements.map((s) => tx.query(s.text, s.params ?? [])));
    },
  };
}

/**
 * PGlite is a devDependency and is imported through a variable specifier so
 * the production bundle never resolves it. `dataDir` undefined → in-memory.
 */
export async function pgliteExecutor(dataDir?: string): Promise<SqlExecutor> {
  const specifier = "@electric-sql/pglite";
  const { PGlite } = (await import(/* @vite-ignore */ specifier)) as typeof import("@electric-sql/pglite");
  const db = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  return {
    async query(text, params = []) {
      return (await db.query<SqlRow>(text, params)).rows;
    },
    async transaction(statements) {
      await db.transaction(async (tx) => {
        for (const s of statements) await tx.query(s.text, s.params ?? []);
      });
    },
  };
}
