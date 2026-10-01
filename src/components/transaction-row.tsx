"use client";

import { useTransition } from "react";
import { deleteTransactionAction, updateCategoryAction } from "@/app/actions";
import { formatShortDate } from "@/lib/dates";
import { label, money } from "@/lib/format";
import { CATEGORIES, type Transaction } from "@/lib/types";

export function TransactionRow({ t, account }: { t: Transaction; account?: string }) {
  const [pending, start] = useTransition();
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm ${pending ? "opacity-50" : ""}`}>
      <span className="w-20 shrink-0 text-muted">{formatShortDate(t.date)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{t.description}</span>
        <span className="text-xs text-muted">
          {account ?? "No account"}
          {t.notes && ` · ${t.notes}`}
        </span>
      </span>
      <select
        value={t.category}
        onChange={(e) => start(() => updateCategoryAction(t.id, e.target.value))}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs"
        aria-label="Category"
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {label(c)}
          </option>
        ))}
      </select>
      <span className={`num w-24 text-right ${t.amount > 0 ? "text-ok" : ""}`}>{money(t.amount)}</span>
      <button
        onClick={() => confirm("Delete this transaction?") && start(() => deleteTransactionAction(t.id))}
        className="text-muted hover:text-danger"
        aria-label="Delete transaction"
      >
        ×
      </button>
    </li>
  );
}
