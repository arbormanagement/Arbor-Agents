/**
 * Who sent a Google Chat message — from the adapter's VERIFIED webhook payload,
 * never from message text (plan §6).
 *
 * `@chat-adapter/gchat` 4.41 puts `sender.email` in its user cache but not on
 * `message.author` (checked in dist/index.js, parseGoogleChatMessage), so the
 * email is read from the raw event the adapter attaches to the Message:
 *   direct webhook  event.chat.messagePayload.message.sender.email
 *                   (also event.chat.user.email — the acting user)
 *   Pub/Sub         notification.message.sender.email
 * Google fills `sender.email` for Workspace accounts in the app's own org; the
 * caller falls back to `bot.getUser(author)` (the adapter's 7-day cache) and
 * refuses when neither knows.
 */
export interface ChatSender {
  email: string | null;
  displayName: string | null;
  userId: string | null;
}

type Loose = Record<string, unknown> | null | undefined;
const obj = (v: unknown): Loose => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function senderFromRaw(raw: unknown): ChatSender {
  const event = obj(raw);
  const chat = obj(event?.chat);
  const payloadMessage = obj(obj(chat?.messagePayload)?.message);
  const legacyMessage = obj(event?.message); // pre-2024 event shape, still emitted by some add-on paths
  const notificationMessage = obj(event?.message) ?? obj(obj(event?.notification)?.message);
  const sender = obj(payloadMessage?.sender) ?? obj(legacyMessage?.sender) ?? obj(notificationMessage?.sender);
  const actingUser = obj(chat?.user) ?? obj(event?.user);
  return {
    email: str(sender?.email) ?? str(actingUser?.email),
    displayName: str(sender?.displayName) ?? str(actingUser?.displayName),
    userId: str(sender?.name) ?? str(actingUser?.name),
  };
}

/** The message's author enriched with whatever the raw event verified. */
export function senderOf(message: { raw?: unknown; author: { email?: string; fullName?: string; userId?: string } }): ChatSender {
  const fromRaw = senderFromRaw(message.raw);
  return {
    email: fromRaw.email ?? str(message.author.email),
    displayName: fromRaw.displayName ?? str(message.author.fullName),
    userId: fromRaw.userId ?? str(message.author.userId),
  };
}
