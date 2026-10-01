"use client";

import { useState, useTransition } from "react";
import { saveImportAction } from "@/app/actions";
import { formatShortDate } from "@/lib/dates";
import { label, money } from "@/lib/format";
import { shrinkImage } from "@/lib/shrink-image";
import type { Statement } from "@/lib/statement";
import { CATEGORIES } from "@/lib/types";

type Row = Statement["transactions"][number] & { keep: boolean };

export function ImportStatement({ accounts }: { accounts: { id: number; name: string; type: string }[] }) {
  const [accountId, setAccountId] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [summary, setSummary] = useState<Statement["summary"] | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [updateBalance, setUpdateBalance] = useState(true);
  const [saving, startSaving] = useTransition();

  function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? []);
    // Picking again adds to the selection (handy for screenshots chosen in several rounds).
    setFiles((cur) => [...cur, ...picked.filter((p) => !cur.some((c) => c.name === p.name && c.size === p.size))]);
    setDone(null);
  }

  async function read() {
    if (files.length === 0) return;
    setReading(true);
    setError(null);
    setDone(null);
    try {
      const body = new FormData();
      for (const file of await Promise.all(files.map(shrinkImage))) body.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      const st = json as Statement;
      setSummary(st.summary);
      setRows(st.transactions.map((t) => ({ ...t, keep: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  }

  function reset() {
    setSummary(null);
    setRows([]);
    setFiles([]);
  }

  function save() {
    const kept = rows
      .filter((r) => r.keep)
      .map((r) => ({ date: r.date, description: r.description, amount: r.amount, category: r.category, note: r.note }));
    const newBalance = updateBalance && accountId && summary?.ending_balance != null ? summary.ending_balance : null;
    startSaving(async () => {
      const res = await saveImportAction({ accountId: accountId ? Number(accountId) : null, rows: kept, newBalance });
      if (res.error) setError(res.error);
      else {
        setDone(res.message ?? "Saved");
        reset();
      }
    });
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (summary) {
    const kept = rows.filter((r) => r.keep);
    const out = kept.filter((r) => r.amount < 0).reduce((a, r) => a - r.amount, 0);
    return (
      <section className="min-w-0 rounded-2xl border border-accent/40 bg-surface p-4 lg:col-span-2">
        <h2 className="font-semibold">Review before saving</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {summary.account_description && <Info k="Account" v={summary.account_description} />}
          {summary.period_start && summary.period_end && (
            <Info k="Period" v={`${formatShortDate(summary.period_start)} – ${formatShortDate(summary.period_end)}`} />
          )}
          {summary.payment_due_date && <Info k="Fecha límite de pago" v={formatShortDate(summary.payment_due_date)} />}
          {summary.payment_to_avoid_interest != null && (
            <Info k="Pago para no generar intereses" v={money(summary.payment_to_avoid_interest)} />
          )}
          {summary.minimum_payment != null && <Info k="Pago mínimo" v={money(summary.minimum_payment)} />}
          {summary.ending_balance != null && <Info k="Balance at end of period" v={money(summary.ending_balance)} />}
        </dl>

        {!accountId && (
          <p className="mt-3 rounded-lg bg-warn-soft p-2 text-sm">Pick which account this statement belongs to:</p>
        )}
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="field mt-2 sm:w-72">
          <option value="">Choose account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {summary.ending_balance != null && accountId && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={updateBalance} onChange={(e) => setUpdateBalance(e.target.checked)} />
            Also set this account&apos;s balance to {money(summary.ending_balance)} (only if this is your latest
            statement)
          </label>
        )}

        <ul className="mt-3 max-h-[28rem] divide-y divide-border overflow-y-auto">
          {rows.map((r, i) => (
            <li key={i} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm ${r.keep ? "" : "opacity-40"}`}>
              <input type="checkbox" checked={r.keep} onChange={(e) => update(i, { keep: e.target.checked })} />
              <span className="w-24 shrink-0 text-muted">{formatShortDate(r.date)}</span>
              <span className="min-w-0 flex-1 truncate" title={r.description}>
                {r.description}
                {r.note && <span className="text-muted"> · {r.note}</span>}
              </span>
              <select
                value={r.category}
                onChange={(e) => update(i, { category: e.target.value as Row["category"] })}
                className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {label(c)}
                  </option>
                ))}
              </select>
              <span className={`num w-24 text-right ${r.amount > 0 ? "text-ok" : ""}`}>{money(r.amount)}</span>
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted">
            {kept.length} of {rows.length} selected · {money(out)} out
          </span>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={reset}>
              Cancel
            </button>
            <button className="btn" onClick={save} disabled={saving || !accountId || kept.length === 0}>
              {saving ? "Saving…" : `Save ${kept.length}`}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="min-w-0 rounded-2xl border border-dashed border-border bg-surface p-4">
      <h2 className="font-semibold">Import a bank statement</h2>
      <p className="text-xs text-muted">
        PDF estados de cuenta, screenshots of your movements, or a CSV export. You can add several files at once
        (e.g. all the screenshots of one account); repeated movements across screenshots are only counted once. You
        review everything before it&apos;s saved.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="field">
          <option value="">Account (optional now)</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input
          type="file"
          multiple
          accept="application/pdf,image/*,.csv,.txt"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
          className="field"
        />
        <button className="btn self-end" onClick={read} disabled={files.length === 0 || reading}>
          {reading
            ? "Reading… (up to a few minutes)"
            : files.length > 1
              ? `Read ${files.length} files`
              : "Read statement"}
        </button>
      </div>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {files.map((f, i) => (
            <span key={f.name + f.size} className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
              <span className="max-w-40 truncate">{f.name}</span>
              <button
                aria-label={`Remove ${f.name}`}
                className="text-muted hover:text-danger"
                disabled={reading}
                onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))}
          {!reading && (
            <button className="text-muted underline" onClick={() => setFiles([])}>
              Clear
            </button>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-muted">All files in one batch should be from the same account.</p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {done && <p className="mt-2 text-sm text-ok">{done}</p>}
    </section>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}
