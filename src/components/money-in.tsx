"use client";

import { useState, useTransition } from "react";
import { recordMoneyInAction } from "@/app/actions";
import { money } from "@/lib/format";
import type { MoneyInCategory } from "@/lib/money-in";

interface Preset {
  id: number;
  name: string;
  amount: number;
  account_id: number | null;
}

/** Record a paycheck, a transfer from another bank, a refund... and add it to the account's balance. */
export function MoneyIn(props: {
  accounts: { id: number; name: string; type: string }[];
  incomes: Preset[];
  today: string;
}) {
  const firstDebit = props.accounts.find((a) => a.type === "debit") ?? props.accounts[0];
  const [what, setWhat] = useState<string>(props.incomes[0] ? `income:${props.incomes[0].id}` : "transfer");
  const preset = props.incomes.find((i) => `income:${i.id}` === what);
  const [amount, setAmount] = useState(preset ? String(preset.amount) : "");
  const [accountId, setAccountId] = useState(String(preset?.account_id ?? firstDebit?.id ?? ""));
  const [date, setDate] = useState(props.today);
  const [description, setDescription] = useState(preset?.name ?? "");
  const [addToBalance, setAddToBalance] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function choose(value: string) {
    setWhat(value);
    const p = props.incomes.find((i) => `income:${i.id}` === value);
    if (p) {
      setAmount(String(p.amount));
      if (p.account_id) setAccountId(String(p.account_id));
      setDescription(p.name);
    } else {
      setAmount("");
      setDescription(value === "transfer" ? "Transfer from another account" : "");
    }
  }

  function save(force = false) {
    const value = Number(amount.replace(/[$,\s]/g, ""));
    if (!(value > 0)) return setError("Enter the amount received");
    if (!accountId) return setError("Pick the account it went into");
    const category: MoneyInCategory = what.startsWith("income:") ? "income" : what === "transfer" ? "transfer" : "other";
    setError(null);
    startSaving(async () => {
      const res = await recordMoneyInAction({
        date,
        amount: value,
        account_id: Number(accountId),
        description,
        category,
        add_to_balance: addToBalance,
        force,
      });
      if (res.error) {
        setError(res.error);
        setDuplicate(res.error.includes("already recorded"));
        return;
      }
      setDone([res.message, ...(res.notes ?? [])].filter(Boolean).join(" "));
      setDuplicate(false);
    });
  }

  const account = props.accounts.find((a) => String(a.id) === accountId);

  return (
    <section id="money-in" className="min-w-0 rounded-2xl border border-dashed border-border bg-surface p-4">
      <h2 className="font-semibold">Record money in</h2>
      <p className="text-xs text-muted">Your paycheck, a transfer from another bank, a refund. It&apos;s added to the balance.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-xs font-medium text-muted">What is it?</span>
          <select value={what} onChange={(e) => choose(e.target.value)} className="field">
            {props.incomes.map((i) => (
              <option key={i.id} value={`income:${i.id}`}>
                {i.name} · {money(i.amount)}
              </option>
            ))}
            <option value="transfer">Transfer from another account</option>
            <option value="other">Other money in (refund, gift…)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted">Amount</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="field" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted">Date received</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted">Into</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="field">
            {props.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.type === "credit" ? " (credit card)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="field" />
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={addToBalance} onChange={(e) => setAddToBalance(e.target.checked)} />
        <span>
          {account?.type === "credit" ? "Subtract it from what I owe on " : "Add it to the balance of "}
          {account?.name ?? "that account"}
        </span>
      </label>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {done && <p className="mt-2 text-sm text-ok">{done}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {duplicate && (
          <button className="btn btn-ghost" onClick={() => save(true)} disabled={saving}>
            Record anyway
          </button>
        )}
        <button className="btn" onClick={() => save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
