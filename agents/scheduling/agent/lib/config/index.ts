/**
 * Config store selection — see lib/db for the backend rule. The seed is
 * written the first time an empty store is opened.
 */
import { getSql, selectedBackend } from "../db";
import { PostgresConfigStore } from "./postgres-store";
import { InMemoryConfigStore, seedIfEmpty, type ConfigStore } from "./store";

export { selectedBackend };
export type { DbBackend as ConfigBackend } from "../db";

let ready: Promise<ConfigStore> | null = null;

export function getConfigStore(): Promise<ConfigStore> {
  if (ready) return ready;
  ready = (async () => {
    const sql = await getSql();
    const store = sql ? await PostgresConfigStore.create(sql) : new InMemoryConfigStore();
    const seeded = await seedIfEmpty(store);
    console.log(`[config] store=${selectedBackend()} seeded=${seeded}`);
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
