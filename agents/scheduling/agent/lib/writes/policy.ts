/**
 * The approval policy shared by every write tool: an allowlisted person (or
 * local dev) proceeds with no prompt; anyone else is denied with the reason.
 * Route auth already refuses strangers; this is belt and braces, and it is
 * what turns an OIDC service caller or the app principal into "reads only".
 */
import { requirePerson, type AuthContext } from "../auth/people";

export function personOnlyPolicy(ctx: { session: { auth: { current: AuthContext | null | undefined } } }): "not-applicable" | { type: "denied"; reason: string } {
  try {
    requirePerson(ctx.session.auth.current);
    return "not-applicable";
  } catch (err) {
    return { type: "denied", reason: err instanceof Error ? err.message : String(err) };
  }
}
