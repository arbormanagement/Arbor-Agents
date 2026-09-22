import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PEOPLE, authFor, personFor, requirePerson } from "../agent/lib/auth/people";

describe("people (plan §6) — the allowlist is the whole boundary", () => {
  it("knows exactly who is allowed and their role", () => {
    assert.deepEqual(PEOPLE.map((p) => [p.name, p.role]), [["Justin", "owner"], ["Elizabeth", "scheduler"], ["Nic", "scheduler"], ["Kim", "scheduler"]]);
    assert.equal(personFor("ELIZABETH@arbor-mgmt.com ")?.name, "Elizabeth");
    assert.equal(personFor("kwilliams@arbor-mgmt.com")?.name, "Kim");
    assert.equal(personFor("kim@arbor-mgmt.com"), null); // not her address
    assert.equal(personFor("matt@arbor-mgmt.com"), null); // same domain, not on the list
    assert.equal(personFor(null), null);
  });

  it("mints a session auth for a verified sender, and nothing for anyone else", () => {
    const a = authFor({ email: "nic@arbor-mgmt.com", displayName: "Nic D" });
    assert.deepEqual(a, { authenticator: "gchat", principalId: "nic@arbor-mgmt.com", principalType: "user", attributes: { name: "Nic", role: "scheduler", display_name: "Nic D" } });
    assert.equal(authFor({ email: "matt@arbor-mgmt.com" }), null);
    assert.equal(authFor({ email: "justin@arbor-mgmt.com.evil.example" }), null);
    assert.equal(authFor({}), null);
  });

  it("requirePerson admits the allowlist and local dev, refuses the rest", () => {
    const prod = {} as NodeJS.ProcessEnv;
    assert.deepEqual(requirePerson(authFor({ email: "justin@arbor-mgmt.com" }), prod), { id: "justin@arbor-mgmt.com", role: "owner" });
    assert.throws(() => requirePerson({ authenticator: "oidc", principalId: "svc", principalType: "service", attributes: {} }, prod), /allowlist/);
    assert.throws(() => requirePerson({ authenticator: "app", principalId: "eve:app", principalType: "runtime", attributes: {} }, prod), /app principal/);
  });
});
