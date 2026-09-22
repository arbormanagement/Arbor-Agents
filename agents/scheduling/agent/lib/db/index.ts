/**
 * One database selection for everything durable — config records and the
 * write audit. The env var keeps its phase-1 name, CONFIG_STORE, because it
 * is already set in people's heads and docs:
 *
 *   neon    Neon over HTTP; needs DATABASE_URL (injected by the integration)
 *   pglite  in-process Postgres (WASM) for evals, tests and local runs
 *   memory  process-local; nothing durable
 *
 * Unset: neon ONLY on the production deployment (VERCEL_ENV=production) with
 * DATABASE_URL present; memory everywhere else — a pull-request preview must
 * never touch the office's real rules or write a real audit row.
 */
import { neonExecutor, pgliteExecutor, type SqlExecutor } from "../config/sql";

export type DbBackend = "neon" | "pglite" | "memory";

export function selectedBackend(env: NodeJS.ProcessEnv = process.env): DbBackend {
  const explicit = env.CONFIG_STORE;
  if (explicit === "neon" || explicit === "pglite" || explicit === "memory") return explicit;
  if (explicit) throw new Error(`CONFIG_STORE=${explicit} is not one of neon | pglite | memory.`);
  if (!env.DATABASE_URL) return "memory";
  if (env.VERCEL_ENV === "production") return "neon";
  console.warn(`[db] DATABASE_URL is set but VERCEL_ENV=${env.VERCEL_ENV ?? "(unset)"} — refusing the production database; using memory. Set CONFIG_STORE=neon to override deliberately.`);
  return "memory";
}

let ready: Promise<SqlExecutor | null> | null = null;

/** The shared executor, or null when the backend is memory. */
export function getSql(): Promise<SqlExecutor | null> {
  if (ready) return ready;
  const backend = selectedBackend();
  ready = (async () => {
    switch (backend) {
      case "memory":
        return null;
      case "pglite":
        return pgliteExecutor(process.env.PGLITE_DATA_DIR);
      case "neon": {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("CONFIG_STORE=neon needs DATABASE_URL (injected by the Neon integration on Vercel).");
        return neonExecutor(url);
      }
    }
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
