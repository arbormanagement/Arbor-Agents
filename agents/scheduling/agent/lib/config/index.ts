/**
 * Store selection.
 *
 *   CONFIG_STORE=neon    Neon over HTTP; needs DATABASE_URL (the Neon
 *                        integration injects it on Vercel).
 *   CONFIG_STORE=pglite  In-process Postgres (WASM); evals and local runs.
 *   CONFIG_STORE=memory  Process-local; phase 1 behaviour.
 *
 * Unset: neon ONLY on the Vercel production deployment (VERCEL_ENV=production)
 * with DATABASE_URL present; memory everywhere else. The Neon integration
 * injects DATABASE_URL into preview deployments too, and a pull-request
 * preview must never seed or edit the office's real rules. A deliberate run
 * against production from elsewhere says CONFIG_STORE=neon explicitly.
 * The seed is written the first time an empty store is opened.
 */
import { PostgresConfigStore } from "./postgres-store";
import { neonExecutor, pgliteExecutor } from "./sql";
import { InMemoryConfigStore, seedIfEmpty, type ConfigStore } from "./store";

export type ConfigBackend = "neon" | "pglite" | "memory";

export function selectedBackend(env: NodeJS.ProcessEnv = process.env): ConfigBackend {
  const explicit = env.CONFIG_STORE;
  if (explicit === "neon" || explicit === "pglite" || explicit === "memory") return explicit;
  if (explicit) throw new Error(`CONFIG_STORE=${explicit} is not one of neon | pglite | memory.`);
  if (!env.DATABASE_URL) return "memory";
  if (env.VERCEL_ENV === "production") return "neon";
  console.warn(`[config] DATABASE_URL is set but VERCEL_ENV=${env.VERCEL_ENV ?? "(unset)"} — refusing the production database; using memory. Set CONFIG_STORE=neon to override deliberately.`);
  return "memory";
}

async function open(backend: ConfigBackend): Promise<ConfigStore> {
  switch (backend) {
    case "memory":
      return new InMemoryConfigStore();
    case "pglite":
      return PostgresConfigStore.create(await pgliteExecutor(process.env.PGLITE_DATA_DIR));
    case "neon": {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error("CONFIG_STORE=neon needs DATABASE_URL (injected by the Neon integration on Vercel).");
      return PostgresConfigStore.create(neonExecutor(url));
    }
  }
}

let ready: Promise<ConfigStore> | null = null;

export function getConfigStore(): Promise<ConfigStore> {
  if (ready) return ready;
  const backend = selectedBackend();
  ready = (async () => {
    const store = await open(backend);
    const seeded = await seedIfEmpty(store);
    console.log(`[config] store=${backend} seeded=${seeded}`);
    return store;
  })();
  // A failed open (cold-start network blip, bad URL) must not poison the process.
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

/** A store proxy that resolves lazily, so the memory slot can be declared synchronously. */
export const lazyConfigStore: ConfigStore = {
  current: async (f) => (await getConfigStore()).current(f),
  currentAll: async () => (await getConfigStore()).currentAll(),
  history: async (f) => (await getConfigStore()).history(f),
  set: async (i) => (await getConfigStore()).set(i),
};
