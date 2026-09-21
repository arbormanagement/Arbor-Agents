import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

/**
 * EVE_FIXTURE=1 swaps the model for a deterministic fixture so the config evals
 * run without a gateway credential. The fixture speaks a tiny command language
 * on the user message:
 *   fixture:echo            → reply with every user-role message in context (recalled memory included)
 *   fixture:set <json>      → call config__set with the JSON as input
 *   fixture:get <family>    → call config__get
 *   fixture:history <family> → call config__history
 *   fixture:tool <name> <json> → call any authored tool with the JSON as input
 * Anything else echoes the last user message. After any tool result it replies "Done: …".
 *
 * `userMessages` excludes framework scaffolding, so recalled memory is read off
 * `messages` by role instead.
 */
const fixture = mockModel(({ lastUserMessage, messages, toolResults }) => {
  // `toolResults` spans the whole prompt, including earlier turns. Only treat
  // this call as "after a tool ran" when the tool result is the latest message.
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === "tool" && toolResults.length > 0) {
    const last = toolResults[toolResults.length - 1]!;
    return `Done: ${JSON.stringify(last)}`.slice(0, 60000);
  }
  const msg = lastUserMessage ?? "";
  if (msg === "fixture:echo") {
    const userText = messages.filter((m) => m.role === "user").map((m) => m.text);
    return `Context:\n${userText.join("\n---\n")}`.slice(0, 20000);
  }
  if (msg.startsWith("fixture:set ")) {
    return { toolCalls: [{ name: "config__set", input: JSON.parse(msg.slice("fixture:set ".length)) as unknown }] };
  }
  if (msg.startsWith("fixture:tool ")) {
    const rest = msg.slice("fixture:tool ".length).trim();
    const space = rest.indexOf(" ");
    const name = space === -1 ? rest : rest.slice(0, space);
    const input = space === -1 ? {} : (JSON.parse(rest.slice(space + 1)) as unknown);
    return { toolCalls: [{ name, input }] };
  }
  if (msg.startsWith("fixture:history ")) {
    return { toolCalls: [{ name: "config__history", input: { family: msg.slice("fixture:history ".length).trim() } }] };
  }
  if (msg.startsWith("fixture:get ")) {
    return { toolCalls: [{ name: "config__get", input: { family: msg.slice("fixture:get ".length).trim() } }] };
  }
  return `Echo: ${msg}`;
});

const isFixture = process.env.EVE_FIXTURE === "1";

export default defineAgent({
  model: isFixture ? fixture : "anthropic/claude-opus-5",
  // No optional built-in tools. The model gets exactly what agent/tools/ and
  // the memory providers declare: no shell, no filesystem, no web, and no
  // built-in subagent delegation (a copy of this agent with no authenticated
  // caller). ask_question and load_skill are re-added explicitly in tools/.
  defaultTools: false,
  // The fixture is not in the AI Gateway catalog, so eve cannot look up its
  // context window and compaction would fail to compile. Declare one for the
  // fixture only; the real model's window is resolved from the gateway.
  ...(isFixture ? { modelContextWindowTokens: 200_000 } : {}),
});
