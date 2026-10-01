"use client";

import { useActionState, useTransition } from "react";
import { deleteMemoryAction, saveProfileAction, type FormState } from "@/app/actions";
import type { CoachMemory } from "@/lib/types";

export function ProfileEditor({ profile, memories }: { profile: string; memories: CoachMemory[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProfileAction, {});
  const [removing, startRemove] = useTransition();

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-semibold">What the coach knows about you</h2>
      <p className="text-xs text-muted">
        Anything that helps: rent, who you live with, transport, goals, worries. Used in new conversations.
      </p>
      <form action={action} className="mt-3 flex flex-col gap-2">
        <textarea name="profile" defaultValue={profile} rows={6} className="field" />
        <div className="flex items-center gap-3">
          <button className="btn" disabled={pending}>
            Save
          </button>
          {state.ok && <span className="text-sm text-ok">{state.message}</span>}
        </div>
      </form>
      <h3 className="mt-5 text-sm font-semibold">Remembered from conversations</h3>
      {memories.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet. The coach saves important things you tell it.</p>
      ) : (
        <ul className={`mt-1 divide-y divide-border text-sm ${removing ? "opacity-60" : ""}`}>
          {memories.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 py-2">
              <span>{m.content}</span>
              <button
                className="text-muted hover:text-danger"
                aria-label="Forget"
                onClick={() => startRemove(() => deleteMemoryAction(m.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
