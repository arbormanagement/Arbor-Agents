/**
 * Store selection. Phase 1: in-memory, seeded on first use.
 * Set CONFIG_STORE=neon once the Neon implementation lands (blocked on the account).
 */
import { InMemoryConfigStore, seedIfEmpty, type ConfigStore } from "./store";

let instance: ConfigStore | null = null;
let ready: Promise<ConfigStore> | null = null;

export function getConfigStore(): Promise<ConfigStore> {
  if (ready) return ready;
  ready = (async () => {
    const backend = process.env.CONFIG_STORE ?? "memory";
    if (backend !== "memory") {
      throw new Error(`CONFIG_STORE=${backend} is not implemented yet; only "memory" exists in phase 1.`);
    }
    instance = new InMemoryConfigStore();
    await seedIfEmpty(instance);
    return instance;
  })();
  return ready;
}

/** A store proxy that resolves lazily, so the memory slot can be declared synchronously. */
export const lazyConfigStore: ConfigStore = {
  current: async (f) => (await getConfigStore()).current(f),
  currentAll: async () => (await getConfigStore()).currentAll(),
  history: async (f) => (await getConfigStore()).history(f),
  set: async (i) => (await getConfigStore()).set(i),
};
