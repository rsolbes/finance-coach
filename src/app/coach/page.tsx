import { connection } from "next/server";
import { ChatView, type ChatBubble } from "@/components/chat-view";
import { getConversation, listConversations } from "@/lib/repo";

/** Turns stored API messages into chat bubbles: tool calls are hidden, one bubble per coach reply. */
function toBubbles(messages: { role: string; content: unknown }[]): ChatBubble[] {
  const out: ChatBubble[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (typeof m.content !== "string") continue; // tool results
      out.push({ role: "user", text: m.content.replace(/^\[Today is [^\]]+\]\n/, "") });
      continue;
    }
    const blocks = Array.isArray(m.content) ? (m.content as { type: string; text?: string }[]) : [];
    const text = blocks
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n\n");
    if (!text) continue;
    const last = out.at(-1);
    if (last?.role === "coach") last.text += `\n\n${text}`;
    else out.push({ role: "coach", text });
  }
  return out;
}

export default async function CoachPage({ searchParams }: PageProps<"/coach">) {
  await connection();
  const params = await searchParams;
  const id = Number(params.c) || null;
  const q = typeof params.q === "string" ? params.q : "";
  const [conversations, current] = await Promise.all([listConversations(), id ? getConversation(id) : null]);

  return (
    <ChatView
      conversations={conversations}
      conversationId={current?.id ?? null}
      initialBubbles={current ? toBubbles(current.messages) : []}
      initialDraft={q}
    />
  );
}
