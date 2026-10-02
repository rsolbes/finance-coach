"use client";

import { useState, useTransition } from "react";
import { recordPaymentAction } from "@/app/actions";
import { formatShortDate } from "@/lib/dates";
import { money } from "@/lib/format";
import type { PaymentTarget } from "@/lib/payments";
import type { Receipt } from "@/lib/receipt";
import { shrinkImage } from "@/lib/shrink-image";

interface Draft {
  date: string;
  amount: string;
  description: string;
  target: string;
  fromAccount: string;
  deductFromAccount: boolean;
  reduceCardBalance: boolean;
  coversStatement: boolean;
}

export function RecordPayment(props: {
  targets: PaymentTarget[];
  fromAccounts: { id: number; name: string; type: string }[];
  today: string;
}) {
  const blank: Draft = {
    date: props.today,
    amount: "",
    description: "",
    target: "",
    fromAccount: props.fromAccounts[0] ? String(props.fromAccounts[0].id) : "",
    deductFromAccount: true,
    reduceCardBalance: true,
    coversStatement: true,
  };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [result, setResult] = useState<{ message: string; notes: string[] } | null>(null);
  const [saving, startSaving] = useTransition();

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const target = props.targets.find((t) => t.key === draft?.target);

  async function read() {
    if (!file) return;
    setReading(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", await shrinkImage(file));
      const res = await fetch("/api/receipt", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      const r = json as Receipt;
      if (!r.is_payment_receipt) setError("This doesn't look like a payment receipt. Check the details below.");
      setDraft({
        ...blank,
        date: r.date ?? props.today,
        amount: r.amount ? String(r.amount) : "",
        description: [r.paid_to && `Payment to ${r.paid_to}`, r.reference && `ref ${r.reference}`]
          .filter(Boolean)
          .join(" · "),
        target: r.suggested_target ?? "",
        fromAccount: r.suggested_from_account?.replace("account:", "") ?? blank.fromAccount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  }

  function save(force = false) {
    if (!draft) return;
    const amount = Number(draft.amount.replace(/[$,\s]/g, ""));
    if (!(amount > 0)) return setError("Enter the amount paid");
    setError(null);
    startSaving(async () => {
      const res = await recordPaymentAction({
        date: draft.date,
        amount,
        description: draft.description,
        target: draft.target || null,
        from_account_id: draft.fromAccount ? Number(draft.fromAccount) : null,
        deduct_from_account: Boolean(draft.fromAccount) && draft.deductFromAccount,
        reduce_card_balance: draft.reduceCardBalance,
        covers_statement: draft.coversStatement,
        force,
      });
      if (res.error) {
        setError(res.error);
        setDuplicate(res.error.includes("already recorded"));
        return;
      }
      setResult({ message: res.message ?? "Saved", notes: res.notes ?? [] });
      setDraft(null);
      setFile(null);
      setDuplicate(false);
    });
  }

  if (!draft)
    return (
      <section id="payments" className="min-w-0 rounded-2xl border border-dashed border-border bg-surface p-4">
        <h2 className="font-semibold">Record a payment</h2>
        <p className="text-xs text-muted">
          Upload the receipt (comprobante) of a card or loan payment as a PDF or screenshot. Balances, installments and
          due dates update when you save.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="field"
          />
        </div>
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button className="btn" onClick={read} disabled={!file || reading}>
            {reading ? "Reading…" : "Read receipt"}
          </button>
          <button className="btn btn-ghost" onClick={() => (setDraft(blank), setResult(null), setError(null))}>
            Enter by hand
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        {result && (
          <div className="mt-3 rounded-lg bg-accent-soft p-3 text-sm">
            <p className="font-semibold text-accent">{result.message}</p>
            <ul className="mt-1 list-disc pl-5">
              {result.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );

  return (
    <section id="payments" className="min-w-0 rounded-2xl border border-accent/40 bg-surface p-4">
      <h2 className="font-semibold">Check the payment</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted">What did you pay?</span>
          <select value={draft.target} onChange={(e) => set({ target: e.target.value })} className="field">
            <option value="">Something else (just log it)</option>
            {props.targets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
                {t.due_date ? ` · due ${formatShortDate(t.due_date)}` : ""}
                {t.due_amount ? ` · ~${money(t.due_amount, { whole: true })}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted">Amount</span>
          <input
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value })}
            inputMode="decimal"
            className="field"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted">Date paid</span>
          <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} className="field" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted">Paid from</span>
          <select value={draft.fromAccount} onChange={(e) => set({ fromAccount: e.target.value })} className="field">
            <option value="">Cash / other</option>
            {props.fromAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.type === "credit" ? " (credit card)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-xs font-medium text-muted">Description</span>
          <input value={draft.description} onChange={(e) => set({ description: e.target.value })} className="field" />
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-2 text-sm">
        {target?.kind === "card" && (
          <>
            <Check checked={draft.coversStatement} onChange={(v) => set({ coversStatement: v })}>
              This pays the statement
              {target.due_date ? ` due ${formatShortDate(target.due_date)}` : ""} (its installments count as paid and the
              next due date moves forward)
            </Check>
            <Check checked={draft.reduceCardBalance} onChange={(v) => set({ reduceCardBalance: v })}>
              Subtract it from what I owe on {target.label}
            </Check>
          </>
        )}
        {target?.kind === "plan" && (
          <p className="text-muted">The next payment of this plan will be marked as paid.</p>
        )}
        {target?.kind === "bill" && (
          <p className="text-muted">This bill will be marked as paid for its due date, so it stops showing as pending.</p>
        )}
        {draft.fromAccount && (
          <Check checked={draft.deductFromAccount} onChange={(v) => set({ deductFromAccount: v })}>
            {props.fromAccounts.find((a) => String(a.id) === draft.fromAccount)?.type === "credit"
              ? "Add it to what I owe on "
              : "Subtract it from the balance of "}
            {props.fromAccounts.find((a) => String(a.id) === draft.fromAccount)?.name ?? "that account"}
          </Check>
        )}
        <p className="text-xs text-muted">Uncheck a box if you already updated that balance by hand.</p>
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button className="btn btn-ghost" onClick={() => (setDraft(null), setError(null), setDuplicate(false))}>
          Cancel
        </button>
        {duplicate && (
          <button className="btn btn-ghost" onClick={() => save(true)} disabled={saving}>
            Record anyway
          </button>
        )}
        <button className="btn" onClick={() => save()} disabled={saving}>
          {saving ? "Saving…" : "Save payment"}
        </button>
      </div>
    </section>
  );
}

function Check(props: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        className="mt-1"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.children}</span>
    </label>
  );
}
