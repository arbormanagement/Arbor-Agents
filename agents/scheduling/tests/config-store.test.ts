/**
 * Store-level tests, run with `npm test` (node:test via tsx). Every case runs
 * against both implementations, so the in-memory store used by `eve dev` and
 * the Postgres store used in production honour the same contract. PGlite is a
 * real Postgres engine, so the SQL, the partial unique index, the deferred
 * self-referencing key and the supersede transaction are exercised for real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAMILIES } from "../agent/lib/config/schema";
import { PostgresConfigStore } from "../agent/lib/config/postgres-store";
import { pgliteExecutor } from "../agent/lib/config/sql";
import { InMemoryConfigStore, seedIfEmpty, uuidFromKey, type ConfigStore } from "../agent/lib/config/store";

const backends: Array<[string, () => Promise<ConfigStore>]> = [
  ["memory", async () => new InMemoryConfigStore()],
  ["pglite", async () => PostgresConfigStore.create(await pgliteExecutor())],
];

const oneDay = (invoice: string) => ({ jobs: [{ invoice, customer: "Hendricks", note: "two stumps" }] });

for (const [name, open] of backends) {
  describe(`ConfigStore[${name}]`, () => {
    it("seeds every family once, and only once", async () => {
      const store = await open();
      assert.equal(await seedIfEmpty(store), FAMILIES.length);
      assert.equal(await seedIfEmpty(store), 0);
      const all = await store.currentAll();
      assert.equal(all.length, FAMILIES.length);
      assert.ok(all.every((r) => r.set_by.startsWith("seed:") && !r.superseded_by));
    });

    it("set supersedes the prior record and keeps it in history", async () => {
      const store = await open();
      await seedIfEmpty(store);
      const seed = await store.current("known_one_day");
      const next = await store.set({ family: "known_one_day", value: oneDay("4521"), set_by: "elizabeth", evidence: "she said so" });
      assert.notEqual(next.id, seed!.id);
      assert.equal((await store.current("known_one_day"))!.id, next.id);
      const history = await store.history("known_one_day");
      assert.deepEqual(history.map((r) => r.id), [next.id, seed!.id]);
      assert.equal(history[1]!.superseded_by, next.id);
      assert.equal(history[0]!.superseded_by, undefined);
      assert.equal(history[0]!.evidence, "she said so");
      assert.match(history[0]!.set_at, /^\d{4}-\d{2}-\d{2}T/); // ISO on every driver
    });

    it("a replayed write with the same id is a no-op", async () => {
      const store = await open();
      await seedIfEmpty(store);
      const id = uuidFromKey("config__set:mock-call-1");
      const a = await store.set({ id, family: "known_one_day", value: oneDay("4521"), set_by: "elizabeth" });
      const b = await store.set({ id, family: "known_one_day", value: oneDay("4521"), set_by: "elizabeth" });
      assert.equal(a.id, id);
      assert.equal(b.id, id);
      assert.equal((await store.history("known_one_day")).length, 2); // seed + one write, not two
      assert.equal((await store.current("known_one_day"))!.id, id); // and the replay did not supersede itself
    });

    it("rejects a value with an unknown key and leaves the current record alone", async () => {
      const store = await open();
      await seedIfEmpty(store);
      const before = await store.current("roster");
      await assert.rejects(store.set({ family: "roster", value: { people: [], ignore_cdl_requirement: true }, set_by: "x" }));
      assert.equal((await store.current("roster"))!.id, before!.id);
      assert.equal((await store.history("roster")).length, 1);
    });
  });
}

describe("uuidFromKey", () => {
  it("is stable and shaped like a UUID", () => {
    const a = uuidFromKey("k");
    assert.equal(a, uuidFromKey("k"));
    assert.notEqual(a, uuidFromKey("k2"));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("selectedBackend / requireEditor", async () => {
  const { selectedBackend } = await import("../agent/lib/config/index");
  const { requireEditor } = await import("../agent/lib/config/memory-provider");

  it("opens Neon only on the production deployment unless told otherwise", () => {
    assert.equal(selectedBackend({}), "memory");
    assert.equal(selectedBackend({ DATABASE_URL: "postgres://x" }), "memory"); // local env pull
    assert.equal(selectedBackend({ DATABASE_URL: "postgres://x", VERCEL_ENV: "preview" }), "memory");
    assert.equal(selectedBackend({ DATABASE_URL: "postgres://x", VERCEL_ENV: "production" }), "neon");
    assert.equal(selectedBackend({ DATABASE_URL: "postgres://x", VERCEL_ENV: "preview", CONFIG_STORE: "neon" }), "neon");
    assert.equal(selectedBackend({ CONFIG_STORE: "pglite" }), "pglite");
    assert.throws(() => selectedBackend({ CONFIG_STORE: "sqlite" }));
  });

  it("refuses a write with no person behind it", () => {
    assert.equal(requireEditor({ principalId: "elizabeth@arbor-mgmt.com", principalType: "user" }), "elizabeth@arbor-mgmt.com");
    assert.throws(() => requireEditor(null));
    assert.throws(() => requireEditor(undefined));
    assert.throws(() => requireEditor({ principalId: "", principalType: "user" }));
    assert.throws(() => requireEditor({ principalId: "eve:app", principalType: "runtime" }));
  });
});
