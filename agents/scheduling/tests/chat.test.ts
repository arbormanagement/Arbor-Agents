import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authFor } from "../agent/lib/auth/people";
import { senderFromRaw, senderOf } from "../agent/lib/chat/sender";
import { InMemoryChatThreads, PostgresChatThreads, type ChatThreadStore } from "../agent/lib/chat/threads";
import { pgliteExecutor } from "../agent/lib/config/sql";

// The direct-webhook event shape @chat-adapter/gchat 4.41 attaches as message.raw
// (parseGoogleChatMessage reads event.chat.messagePayload.message).
const directEvent = (sender: Record<string, unknown>) => ({
  chat: {
    user: { name: "users/1", displayName: "Elizabeth", email: "elizabeth@arbor-mgmt.com", type: "HUMAN" },
    messagePayload: {
      space: { name: "spaces/AAA", type: "DM", spaceType: "DIRECT_MESSAGE" },
      message: { name: "spaces/AAA/messages/1", text: "build next week", createTime: "2026-09-22T10:00:00Z", sender },
    },
  },
});

describe("senderFromRaw", () => {
  it("reads the verified sender from a direct webhook event", () => {
    const s = senderFromRaw(directEvent({ name: "users/1", displayName: "Elizabeth", email: "Elizabeth@Arbor-Mgmt.com ", type: "HUMAN" }));
    assert.deepEqual(s, { email: "Elizabeth@Arbor-Mgmt.com", displayName: "Elizabeth", userId: "users/1" });
  });
  it("falls back to the acting user when the sender carries no email", () => {
    const s = senderFromRaw(directEvent({ name: "users/1", displayName: "Elizabeth", type: "HUMAN" }));
    assert.equal(s.email, "elizabeth@arbor-mgmt.com");
  });
  it("reads a Pub/Sub notification shape", () => {
    const s = senderFromRaw({ message: { name: "spaces/A/messages/2", sender: { name: "users/2", displayName: "Kim", email: "kwilliams@arbor-mgmt.com" } } });
    assert.deepEqual(s, { email: "kwilliams@arbor-mgmt.com", displayName: "Kim", userId: "users/2" });
  });
  it("is null-safe on anything else", () => {
    assert.deepEqual(senderFromRaw(undefined), { email: null, displayName: null, userId: null });
    assert.deepEqual(senderFromRaw("nope"), { email: null, displayName: null, userId: null });
    assert.deepEqual(senderFromRaw({ chat: {} }), { email: null, displayName: null, userId: null });
  });
});

describe("senderOf → authFor", () => {
  it("an allowlisted Workspace account becomes a session principal; the email comes from the event, never the text", () => {
    const message = { raw: directEvent({ name: "users/1", displayName: "Elizabeth", email: "elizabeth@arbor-mgmt.com" }), author: { userId: "users/1", fullName: "Elizabeth", isBot: false, isMe: false, userName: "Elizabeth" } };
    const sender = senderOf(message);
    const auth = authFor({ email: sender.email, displayName: sender.displayName });
    assert.equal(auth?.principalId, "elizabeth@arbor-mgmt.com");
    assert.equal(auth?.attributes.role, "scheduler");
    assert.equal(auth?.attributes.display_name, "Elizabeth");
  });
  it("another arbor-mgmt.com account is refused", () => {
    const sender = senderOf({ raw: directEvent({ name: "users/9", displayName: "Adam", email: "adam@arbor-mgmt.com" }), author: { userId: "users/9", fullName: "Adam" } });
    assert.equal(authFor({ email: sender.email }), null);
  });
  it("uses the author's email when the raw event has none, and nothing when neither has one", () => {
    assert.equal(senderOf({ raw: {}, author: { userId: "users/3", fullName: "Nic", email: "nic@arbor-mgmt.com" } }).email, "nic@arbor-mgmt.com");
    assert.equal(senderOf({ raw: {}, author: { userId: "users/3", fullName: "Nic" } }).email, null);
  });
});

const backends: Array<[string, () => Promise<ChatThreadStore>]> = [
  ["memory", async () => new InMemoryChatThreads()],
  ["pglite", async () => PostgresChatThreads.create(await pgliteExecutor())],
];

for (const [name, open] of backends) {
  describe(`chat threads on ${name}`, () => {
    it("records a person's DM once and updates it on later messages", async () => {
      const store = await open();
      const first = await store.record({ email: "Elizabeth@arbor-mgmt.com", adapter: "gchat", threadId: "spaces/AAA:dm", displayName: "Elizabeth" });
      assert.equal(first.email, "elizabeth@arbor-mgmt.com");
      assert.equal(first.thread_id, "spaces/AAA:dm");
      const again = await store.record({ email: "elizabeth@arbor-mgmt.com", adapter: "gchat", threadId: "spaces/AAA:dm" });
      assert.equal(again.display_name, "Elizabeth", "a missing display name keeps the old one");
      assert.equal(again.first_seen_at, first.first_seen_at);
      assert.equal((await store.all()).length, 1);
      const found = await store.forPerson("ELIZABETH@arbor-mgmt.com");
      assert.equal(found?.thread_id, "spaces/AAA:dm");
      assert.equal(await store.forPerson("nobody@arbor-mgmt.com"), null);
    });
    it("a new thread for the same person replaces the old one", async () => {
      const store = await open();
      await store.record({ email: "kwilliams@arbor-mgmt.com", adapter: "gchat", threadId: "spaces/OLD:dm" });
      await store.record({ email: "kwilliams@arbor-mgmt.com", adapter: "gchat", threadId: "spaces/NEW:dm" });
      assert.equal((await store.forPerson("kwilliams@arbor-mgmt.com"))?.thread_id, "spaces/NEW:dm");
    });
  });
}
