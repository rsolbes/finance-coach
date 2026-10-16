"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { deleteConversationAction } from "@/app/actions";
import type { ChatEvent } from "@/app/api/chat/route";
import type { ConversationSummary } from "@/lib/repo";

import { shrinkImage } from "@/lib/shrink-image";
import type { Receipt } from "@/lib/receipt";

export interface ChatBubble {
  role: "user" | "coach";
  text: string;
  error?: boolean;
}

const STARTERS = [
  "¿Cómo está mi salud financiera hoy? Sé honesto.",
  "¿Cómo debo distribuir mi pago de este viernes para no pagar intereses ni recargos?",
  "¿Cuál deuda o tarjeta me conviene liquidar o amortizar primero?",
  "¿Cómo protejo mi colchón de seguridad esta quincena/semana?",
];

export function ChatView(props: {
  conversations: ConversationSummary[];
  conversationId: number | null;
  initialBubbles: ChatBubble[];
  initialDraft: string;
}) {
  const router = useRouter();
  const [bubbles, setBubbles] = useState<ChatBubble[]>(props.initialBubbles);
  const [draft, setDraft] = useState(props.initialDraft);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(props.conversationId);
  const [syncedId, setSyncedId] = useState<number | null>(props.conversationId);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Navigating to another conversation resets the view; the id we just created ourselves does not.
  if (props.conversationId !== syncedId) {
    setSyncedId(props.conversationId);
    if (props.conversationId !== activeId) {
      setActiveId(props.conversationId);
      setBubbles(props.initialBubbles);
      setDraft(props.initialDraft);
    }
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [bubbles, status]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  useEffect(() => () => abort.current?.abort(), []);

  async function send(text: string, fileToSend?: File | null) {
    const file = fileToSend !== undefined ? fileToSend : attachedFile;
    const raw = text.trim();
    if (!raw && !file) return;
    if (busy) return;

    setDraft("");
    setAttachedFile(null);
    setBusy(true);

    let message = raw;
    if (file) {
      setStatus("Leyendo comprobante");
      try {
        const body = new FormData();
        body.set("file", await shrinkImage(file));
        const res = await fetch("/api/receipt", { method: "POST", body });
        if (res.ok) {
          const r = (await res.json()) as Receipt;
          const details = [
            r.date && `Fecha: ${r.date}`,
            r.amount && `Monto: $${r.amount} MXN`,
            r.paid_to && `Destinatario: ${r.paid_to}`,
            r.paid_from && `Cuenta origen: ${r.paid_from}`,
            r.reference && `Folio: ${r.reference}`,
            r.suggested_target && `Sugerencia: pagar ${r.suggested_target}`,
          ]
            .filter(Boolean)
            .join(" · ");
          message = `[Comprobante adjunto: ${details}]\n\n${raw || "Adjunto este comprobante de pago. Por favor revísalo y regístralo si es correcto."}`;
        } else {
          message = `[Archivo adjunto: ${file.name}]\n\n${raw || "Adjunto este archivo."}`;
        }
      } catch {
        message = `[Archivo adjunto: ${file.name}]\n\n${raw || "Adjunto este archivo."}`;
      }
    }

    setStatus("Thinking");
    setBubbles((b) => [...b, { role: "user", text: message }, { role: "coach", text: "" }]);
    const appendToCoach = (fn: (prev: ChatBubble) => ChatBubble) =>
      setBubbles((b) => [...b.slice(0, -1), fn(b[b.length - 1])]);

    abort.current = new AbortController();
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, message }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
        throw new Error(err.error ?? `Error ${res.status}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "conversation" && activeId !== event.id) {
            setActiveId(event.id);
            window.history.replaceState(null, "", `/coach?c=${event.id}`);
          } else if (event.type === "text") {
            setStatus(null);
            appendToCoach((c) => ({ ...c, text: c.text + event.text }));
          } else if (event.type === "status") {
            setStatus(event.label);
          } else if (event.type === "error") {
            appendToCoach((c) => ({ ...c, text: `${c.text}\n\n${event.message}`.trim(), error: true }));
          }
        }
      }
    } catch (err) {
      if (!abort.current?.signal.aborted)
        appendToCoach((c) => ({ ...c, text: err instanceof Error ? err.message : String(err), error: true }));
    } finally {
      setBusy(false);
      setStatus(null);
      router.refresh(); // the coach may have changed data (goals, balances) and the conversation list
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this conversation?")) return;
    await deleteConversationAction(id);
    if (id === activeId) router.push("/coach");
    else router.refresh();
  }

  const list = (
    <div className="flex flex-col gap-1">
      <Link href="/coach" className="btn mb-2" onClick={() => setShowList(false)}>
        New conversation
      </Link>
      {props.conversations.map((c) => (
        <div
          key={c.id}
          className={`group flex items-center gap-1 rounded-lg text-sm ${
            c.id === activeId ? "bg-accent-soft" : "hover:bg-surface-2"
          }`}
        >
          <Link href={`/coach?c=${c.id}`} className="min-w-0 flex-1 truncate px-2 py-1.5" onClick={() => setShowList(false)}>
            {c.title}
          </Link>
          <button
            onClick={() => remove(c.id)}
            className="px-2 text-muted opacity-60 hover:text-danger hover:opacity-100"
            aria-label="Delete conversation"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex gap-5">
      <aside className="hidden w-56 shrink-0 md:block">{list}</aside>

      <div className="flex min-h-[calc(100dvh-9rem)] min-w-0 flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between md:hidden">
          <h1 className="font-semibold">Coach</h1>
          <button className="btn btn-ghost" onClick={() => setShowList((s) => !s)}>
            {showList ? "Close" : "Conversations"}
          </button>
        </div>
        {showList && <div className="mb-4 rounded-2xl border border-border bg-surface p-3 md:hidden">{list}</div>}

        <div className="flex flex-1 flex-col gap-3">
          {bubbles.length === 0 && (
            <div className="mt-6 flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold">Hi! I&apos;m your finance coach.</h2>
                <p className="text-sm text-muted">
                  I can see your accounts, cards, installments and bills. Ask me anything, or start here:
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-xl border border-border bg-surface p-3 text-left text-sm hover:border-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {bubbles.map((b, i) =>
            b.role === "user" ? (
              <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-surface">
                <p className="whitespace-pre-wrap">{b.text}</p>
              </div>
            ) : b.text || !busy || i !== bubbles.length - 1 ? (
              <div
                key={i}
                className={`prose-chat max-w-[95%] rounded-2xl rounded-bl-md border px-3.5 py-1 ${
                  b.error ? "border-danger/40 bg-danger-soft" : "border-border bg-surface"
                }`}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {b.text || "…"}
                </ReactMarkdown>
              </div>
            ) : null,
          )}
          {status && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              {status}…
            </p>
          )}
          <div ref={bottom} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
              if (items[i].type.startsWith("image/") || items[i].type === "application/pdf") {
                const pasted = items[i].getAsFile();
                if (pasted) {
                  setAttachedFile(pasted);
                  e.preventDefault();
                  break;
                }
              }
            }
          }}
          className="sticky bottom-20 mt-4 flex flex-col gap-2 rounded-2xl border border-border bg-surface p-2 sm:bottom-4"
        >
          {attachedFile && (
            <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-xs">
              <span className="flex items-center gap-1.5 truncate">
                <span>📎</span>
                <span className="font-medium text-foreground truncate">{attachedFile.name || "captura.png"}</span>
                <span className="text-muted">({(attachedFile.size / 1024).toFixed(0)} KB)</span>
              </span>
              <button
                type="button"
                onClick={() => setAttachedFile(null)}
                className="px-1 text-muted hover:text-danger"
                aria-label="Quitar archivo"
              >
                ✕
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) setAttachedFile(e.target.files[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-ghost h-11 px-2.5 text-muted hover:text-foreground"
              title="Adjuntar comprobante o imagen"
              aria-label="Adjuntar comprobante o imagen"
            >
              📎
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={1}
              placeholder="Pregúntale a tu coach… (o pega un comprobante con Ctrl+V)"
              className="field max-h-48 min-h-11 flex-1 resize-none border-0 py-2.5 leading-relaxed overflow-y-auto"
            />
            {busy ? (
              <button type="button" className="btn btn-ghost h-11" onClick={() => abort.current?.abort()}>
                Stop
              </button>
            ) : (
              <button className="btn h-11" disabled={!draft.trim() && !attachedFile}>
                Send
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
