/**
 * The allowlist — the whole boundary (plan §6). Nobody holds a token: a
 * person's Google Workspace account is the credential, the chat adapter
 * verifies it, and this file says who that account is to the agent.
 *
 * Anyone not here — including another arbor-mgmt.com account — gets no
 * session. There is no default role. Adding a person is a pull request.
 */
/** The route-auth principal shape eve attaches to a session (structural; eve does not export it from a public path). */
export interface AuthContext {
  readonly authenticator: string;
  readonly principalId: string;
  readonly principalType: string;
  readonly attributes: Readonly<Record<string, string | readonly string[]>>;
}

export type Role = "owner" | "scheduler";

export interface Person {
  name: string;
  email: string;
  role: Role;
}

export const PEOPLE: readonly Person[] = [
  { name: "Justin", email: "justin@arbor-mgmt.com", role: "owner" },
  { name: "Elizabeth", email: "elizabeth@arbor-mgmt.com", role: "scheduler" },
  { name: "Nic", email: "nic@arbor-mgmt.com", role: "scheduler" },
  { name: "Kim", email: "kwilliams@arbor-mgmt.com", role: "scheduler" }, // Workspace address, not the gmail HCP lists
];

export const AUTHENTICATOR = "gchat";

export function personFor(email: string | null | undefined): Person | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return PEOPLE.find((p) => p.email === e) ?? null;
}

/**
 * The session auth for a verified chat sender, or null → refuse before any
 * model work. `email` must come from the adapter's verified sender, never
 * from message text.
 */
export function authFor(sender: { email?: string | null; displayName?: string | null }): AuthContext | null {
  const p = personFor(sender.email);
  if (!p) return null;
  return {
    authenticator: AUTHENTICATOR,
    principalId: p.email,
    principalType: "user",
    attributes: { name: p.name, role: p.role, ...(sender.displayName ? { display_name: sender.displayName } : {}) },
  };
}

/** True only for the synthetic principal `eve dev` mints, and only while this process IS an eve dev server. */
export function isLocalDev(auth: { principalId: string } | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!auth && auth.principalId === "local-dev" && env.EVE_DEV === "1";
}

/**
 * The person allowed to change rules or write the board on this turn, or a
 * thrown error. Allowlisted people and the local dev principal qualify;
 * the app principal, OIDC service callers and anyone else do not.
 */
export function requirePerson(auth: AuthContext | null | undefined, env: NodeJS.ProcessEnv = process.env): { id: string; role: Role } {
  if (!auth?.principalId) throw new Error("this needs an authenticated caller; none is present on this turn.");
  if (isLocalDev(auth, env)) return { id: auth.principalId, role: "owner" };
  if (auth.principalType === "runtime" || auth.principalId === "eve:app") throw new Error("this needs a person; the turn is running as the app principal.");
  const p = personFor(auth.principalId);
  if (!p) throw new Error(`${auth.principalId} is not on the allowlist; reads only.`);
  return { id: p.email, role: p.role };
}
