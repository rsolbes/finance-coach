"use client";

import { useMemo, useState } from "react";
import { TransactionRow } from "./transaction-row";
import { label, money } from "@/lib/format";
import { CATEGORIES, type Transaction } from "@/lib/types";

export function TransactionList(props: {
  transactions: Transaction[];
  accounts: { id: number; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [accountId, setAccountId] = useState<string>("all");

  const accountMap = useMemo(() => new Map(props.accounts.map((a) => [a.id, a.name])), [props.accounts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.transactions.filter((t) => {
      if (category !== "all" && t.category !== category) return false;
      if (accountId !== "all") {
        if (accountId === "none" && t.account_id != null) return false;
        if (accountId !== "none" && t.account_id !== Number(accountId)) return false;
      }
      if (!q) return true;
      const desc = (t.description || "").toLowerCase();
      const notes = (t.notes || "").toLowerCase();
      const acc = (t.account_id ? accountMap.get(t.account_id) || "" : "").toLowerCase();
      const amt = String(Math.abs(t.amount));
      return desc.includes(q) || notes.includes(q) || acc.includes(q) || amt.includes(q);
    });
  }, [props.transactions, query, category, accountId, accountMap]);

  const isFiltered = query.trim() !== "" || category !== "all" || accountId !== "all";

  const totalFiltered = useMemo(() => {
    return filtered.reduce((sum, t) => sum + (t.amount < 0 ? -t.amount : 0), 0);
  }, [filtered]);

  if (props.transactions.length === 0) {
    return (
      <p className="text-sm text-muted">
        No transactions for this month yet. Upload a statement above or add one by hand.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar comercio, concepto, monto…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="field min-w-40 flex-1 text-sm py-1.5"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="field w-auto text-sm py-1.5"
          aria-label="Filtrar por categoría"
        >
          <option value="all">Todas las categorías</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="field w-auto text-sm py-1.5"
          aria-label="Filtrar por cuenta"
        >
          <option value="all">Todas las cuentas</option>
          {props.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value="none">Sin cuenta</option>
        </select>
        {isFiltered && (
          <button
            onClick={() => {
              setQuery("");
              setCategory("all");
              setAccountId("all");
            }}
            className="btn btn-ghost text-xs px-2 py-1.5 text-muted hover:text-foreground"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          Mostrando {filtered.length} de {props.transactions.length} movimientos
        </span>
        {isFiltered && filtered.length > 0 && (
          <span>Gasto filtrado: {money(totalFiltered)}</span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted">
          No hay movimientos que coincidan con la búsqueda.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((t) => (
            <TransactionRow key={t.id} t={t} account={t.account_id ? accountMap.get(t.account_id) : undefined} />
          ))}
        </ul>
      )}
    </div>
  );
}
