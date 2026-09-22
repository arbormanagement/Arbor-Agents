import { getSql } from "../db";
import { InMemoryChatThreads, PostgresChatThreads, type ChatThreadStore } from "./threads";

let ready: Promise<ChatThreadStore> | null = null;

export function getChatThreads(): Promise<ChatThreadStore> {
  if (ready) return ready;
  ready = (async () => {
    const sql = await getSql();
    return sql ? PostgresChatThreads.create(sql) : new InMemoryChatThreads();
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

export { senderFromRaw, senderOf, type ChatSender } from "./sender";
export type { ChatThread, ChatThreadStore } from "./threads";
