/**
 * The HTTP route: eve dev, the eval runner, and `eve dev <prod-url>`.
 *
 *   vercelOidc()  — a Vercel OIDC bearer minted for this project: how the eval
 *                   runner and the dev terminal reach production. Those callers
 *                   can read; they are not on the allowlist, so config edits and
 *                   (phase 4) board writes refuse them.
 *   localDev()    — the synthetic local principal, only while this process is
 *                   an `eve dev` server. Authenticates nothing on Vercel.
 *
 * Nothing else. Unauthenticated production traffic gets 401. The four-person
 * allowlist lives on the Google Chat channel (phase 5), where the adapter has
 * verified who is talking; see lib/auth/people.ts.
 */
import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [vercelOidc(), localDev()],
});
