/**
 * Google Chat — the surface (plan §9). DMs only: each person's DM with the app
 * is one durable eve session, and the allowlist in lib/auth/people.ts is the
 * whole boundary. The adapter verifies every webhook (JWT audience = this GCP
 * project's number), so the sender email it hands us is Google's word, not
 * the message's.
 *
 * Settings decided up front (plan §13):
 *   turnPolicy "queue"      a second message mid-build waits; it does not restart the build
 *   onLockConflict "force"  a quick second DM is handled, not dropped
 *   streaming               post-then-edit (Google Chat has no typing indicator); 2 s edits
 *   state                   @chat-adapter/state-pg on the SAME Neon database in production
 *                           (tables chat_state_*), memory elsewhere — same gate as CONFIG_STORE
 *   verification            googleChatProjectNumber — the Chat app's "Authentication audience"
 *                           must be set to Project number in the console
 *
 * Env (production, Sensitive): GOOGLE_CHAT_CREDENTIALS (service-account JSON),
 * GOOGLE_CHAT_PROJECT_NUMBER (plain), optional GOOGLE_CHAT_BOT_USER_ID.
 * Without credentials (CI, evals, eve dev) the adapter is built on Application
 * Default Credentials so the module loads and the route exists; it cannot post.
 */
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createPostgresState } from "@chat-adapter/state-pg";
import type { Message, Thread } from "chat";
import { chatSdkChannel, messageToUserContent, type ChatSdkChannelBridge } from "eve/channels/chat-sdk";
import { authFor, PEOPLE, type AuthContext } from "../lib/auth/people";
import { getChatThreads, senderOf } from "../lib/chat";
import { selectedBackend } from "../lib/db";

/** The MCP's own GCP project, "Google APIs" — where the Chat app is configured (plan §9). */
const DEFAULT_PROJECT_NUMBER = "425178785038";
export const ADAPTER_NAME = "gchat";

function adapter() {
  const googleChatProjectNumber = process.env.GOOGLE_CHAT_PROJECT_NUMBER ?? DEFAULT_PROJECT_NUMBER;
  if (process.env.GOOGLE_CHAT_CREDENTIALS) return createGoogleChatAdapter({ googleChatProjectNumber });
  if (process.env.VERCEL_ENV === "production") console.error("[gchat] GOOGLE_CHAT_CREDENTIALS is not set on production — the app can verify webhooks but cannot post replies.");
  return createGoogleChatAdapter({ googleChatProjectNumber, useApplicationDefaultCredentials: true });
}

function state() {
  // Same rule as lib/db: the real database only on the production deployment.
  if (selectedBackend() === "neon" && process.env.DATABASE_URL) return createPostgresState({ url: process.env.DATABASE_URL, keyPrefix: "arbor-scheduling" });
  return createMemoryState();
}

type Adapters = { [ADAPTER_NAME]: ReturnType<typeof createGoogleChatAdapter> };

const bridge: ChatSdkChannelBridge<Adapters> = chatSdkChannel<Adapters>({
  userName: "Arbor Scheduling",
  adapters: { [ADAPTER_NAME]: adapter() },
  state: state(),
  turnPolicy: "queue",
  onLockConflict: "force",
  streaming: true,
  streamingEditIntervalMs: 2000,
  // A HITL button click resumes the parked session as the person who clicked — or nobody.
  resolveInputAuth: async (event): Promise<AuthContext | null> => {
    const info = await bridge.bot.getUser(event.user).catch((): null => null);
    return authFor({ email: info?.email ?? event.user.email, displayName: info?.fullName ?? event.user.fullName });
  },
});

export const { bot, channel, send } = bridge;

const REFUSAL = `I can only help the scheduling team (${PEOPLE.map((p) => p.name).join(", ")}). This account is not on the list.`;

/** Who is talking, per the verified webhook — null means refuse before any model work. */
export async function identify(message: Message): Promise<{ auth: AuthContext; displayName: string | null } | null> {
  const sender = senderOf(message);
  let email = sender.email;
  if (!email && sender.userId) email = (await bot.getUser(sender.userId).catch(() => null))?.email ?? null;
  const auth = authFor({ email, displayName: sender.displayName });
  return auth ? { auth, displayName: sender.displayName } : null;
}

async function handleDm(thread: Thread, message: Message): Promise<void> {
  if (message.author.isMe || message.author.isBot === true) return;
  const who = await identify(message);
  if (!who) {
    await thread.post(REFUSAL);
    return;
  }
  // Remember the DM so phase 7 can write into it proactively without domain-wide delegation.
  try {
    await (await getChatThreads()).record({ email: who.auth.principalId, adapter: ADAPTER_NAME, threadId: thread.id, displayName: who.displayName });
  } catch (err) {
    console.warn("[gchat] could not record the DM thread:", err instanceof Error ? err.message : err);
  }
  await send(messageToUserContent(message), {
    thread,
    auth: who.auth,
    title: `Scheduling — ${String(who.auth.attributes.name)}`,
  });
}

bot.onDirectMessage(handleDm);

// Spaces are not the surface: an @mention in a space gets a pointer, not a session.
bot.onNewMention(async (thread: Thread, message: Message) => {
  if (thread.isDM) return handleDm(thread, message);
  await thread.post("I work over direct message — open a DM with me and ask there.");
});

export default channel;
