import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropic, describeApiError, FALLBACK_BETA, MODEL } from "@/lib/claude";
import { buildSystemPrompt } from "@/lib/coach/prompt";
import { runTool, TOOL_LABELS, toolDefinitions } from "@/lib/coach/tools";
import { todayISO } from "@/lib/dates";
import { appendMessages, createConversation, getConversation } from "@/lib/repo";
import { requireAuth } from "@/lib/session";

// Claude calls with tools or large files can take a while (Vercel default is shorter).
export const maxDuration = 300;

type Param = Anthropic.Beta.BetaMessageParam;

const Body = z.object({
  conversationId: z.number().int().positive().nullable().optional(),
  message: z.string().trim().min(1).max(8000),
});

const MAX_TOOL_ROUNDS = 10;

/** Events streamed to the browser, one JSON object per line. */
export type ChatEvent =
  | { type: "conversation"; id: number }
  | { type: "text"; text: string }
  | { type: "status"; label: string }
  | { type: "error"; message: string }
  | { type: "done" };

export async function POST(request: Request) {
  try {
    await requireAuth();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { message } = parsed.data;
  const today = todayISO();

  let conversationId = parsed.data.conversationId ?? null;
  let conversation = conversationId ? await getConversation(conversationId) : null;
  if (!conversation) {
    conversationId = await createConversation(message.slice(0, 60), await buildSystemPrompt(today));
    conversation = await getConversation(conversationId);
  }
  if (!conversation || !conversationId) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const convId = conversationId;
  const system = conversation.system_prompt;

  const userTurn: Param = { role: "user", content: `[Today is ${today}]\n${message}` };
  await appendMessages(convId, [userTurn]);
  const messages: Param[] = [...(conversation.messages as Param[]), userTurn];

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      send({ type: "conversation", id: convId });
      try {
        await runCoach({ system, messages, signal: request.signal, send, convId });
      } catch (err) {
        if (!request.signal.aborted) send({ type: "error", message: describeApiError(err) });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function runCoach(opts: {
  system: string;
  messages: Param[];
  signal: AbortSignal;
  send: (e: ChatEvent) => void;
  convId: number;
}) {
  const { system, messages, signal, send, convId } = opts;
  let jsonRetries = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    send({ type: "status", label: "Thinking" });
    const stream = anthropic().beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        system,
        tools: toolDefinitions,
        messages,
      },
      { signal },
    );

    stream.on("text", (delta) => send({ type: "text", text: delta }));
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use")
        send({ type: "status", label: TOOL_LABELS[event.content_block.name] ?? "Working" });
    });

    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Eagerly streamed tool input that isn't valid JSON: re-issue the turn (bounded).
      if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
      continue;
    }

    if (msg.stop_reason === "refusal") {
      send({ type: "error", message: "The coach couldn't answer that one. Try rephrasing your question." });
      return;
    }

    const toolUses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const assistantTurn: Param = { role: "assistant", content: msg.content };

    if (toolUses.length === 0 || msg.stop_reason !== "tool_use") {
      if (msg.stop_reason === "max_tokens" && toolUses.length > 0) {
        send({ type: "error", message: "The answer got too long and was cut off. Ask for a shorter version." });
        return;
      }
      await appendMessages(convId, [assistantTurn]);
      messages.push(assistantTurn);
      if (msg.stop_reason === "pause_turn") continue;
      return;
    }

    // Run every tool call and answer them all in a single user turn.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (t) => {
        const r = await runTool(t.name, t.input);
        return { type: "tool_result" as const, tool_use_id: t.id, content: r.content, is_error: r.isError };
      }),
    );
    const resultsTurn: Param = { role: "user", content: results };
    // Store the tool call and its results together so history never has a dangling tool_use.
    await appendMessages(convId, [assistantTurn, resultsTurn]);
    messages.push(assistantTurn, resultsTurn);
    send({ type: "text", text: "\n\n" });
  }
  send({ type: "error", message: "The coach used too many steps on this one. Ask again more specifically." });
}
