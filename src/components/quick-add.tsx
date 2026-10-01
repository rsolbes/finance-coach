"use client";

import { useActionState, useState } from "react";
import { addTransactionAction, type FormState } from "@/app/actions";
import { label } from "@/lib/format";
import { CATEGORIES } from "@/lib/types";

export function QuickAdd({ accounts, today }: { accounts: { id: number; name: string }[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(addTransactionAction, {});

  if (!open)
    return (
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        + Add
      </button>
    );

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40 sm:items-center sm:justify-center" onClick={() => setOpen(false)}>
      <form
        action={action}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full flex-col gap-3 rounded-t-2xl bg-surface p-4 sm:max-w-md sm:rounded-2xl"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <h3 className="font-semibold">Add a transaction</h3>
        <div className="grid grid-cols-2 gap-2">
          <select name="direction" className="field" defaultValue="out">
            <option value="out">Money out</option>
            <option value="in">Money in</option>
          </select>
          <input name="amount" inputMode="decimal" placeholder="Amount" className="field" required />
        </div>
        <input name="description" placeholder="What was it? (e.g. Tacos, Uber)" className="field" required />
        <div className="grid grid-cols-2 gap-2">
          <select name="category" className="field" defaultValue="other">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
          <input name="date" type="date" defaultValue={today} className="field" required />
        </div>
        <select name="account_id" className="field" defaultValue="">
          <option value="">Cash / no account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {state.ok && <p className="text-sm text-ok">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Close
          </button>
          <button className="btn" disabled={pending}>
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
