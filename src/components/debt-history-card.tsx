import Link from "next/link";
import { formatShortDate } from "@/lib/dates";
import { money } from "@/lib/format";
import type { DebtEvolution } from "@/lib/types";

export function DebtHistoryCard({ evolution }: { evolution: DebtEvolution }) {
  const current = evolution.current;
  const baseline = evolution.baseline;
  const change = evolution.change_from_baseline;

  if (!current) return null;

  const askCoachPrompt = encodeURIComponent(
    "¿Cómo va la evolución de mi deuda total desde que empezamos el proyecto? Dime cuánto ha bajado o subido en tarjetas y préstamos.",
  );

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-foreground">Evolución de tu deuda</h2>
            {change && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  change.direction === "down"
                    ? "border border-ok/30 bg-ok/15 text-ok"
                    : change.direction === "up"
                      ? "border border-warn/30 bg-warn/15 text-warn"
                      : "border border-border bg-surface-2 text-muted"
                }`}
              >
                {change.direction === "down" && "📉 "}
                {change.direction === "up" && "📈 "}
                {change.direction === "down"
                  ? `Ha bajado ${money(Math.abs(change.amount), { whole: true })} (${Math.abs(change.pct).toFixed(1)}%)`
                  : change.direction === "up"
                    ? `Subió ${money(change.amount, { whole: true })} (+${change.pct.toFixed(1)}%)`
                    : "Estable"}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Seguimiento de tarjetas y créditos desde {baseline ? formatShortDate(baseline.date) : "el inicio"}
            {evolution.days_tracked > 0 ? ` (${evolution.days_tracked} días)` : ""}
          </p>
        </div>

        <Link
          href={`/coach?q=${askCoachPrompt}`}
          className="btn btn-ghost text-xs text-accent hover:underline"
        >
          Preguntar al coach →
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Deuda total actual</p>
          <p className="num text-2xl font-bold tracking-tight text-foreground">{money(current.total_debt)}</p>
          {baseline && baseline.total_debt !== current.total_debt && (
            <p className="mt-0.5 text-[11px] text-muted">
              Inicio: <span className="num">{money(baseline.total_debt)}</span>
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Tarjetas de crédito</p>
          <p className="num text-xl font-semibold text-foreground">{money(current.cards_debt)}</p>
          {change && change.cards_amount !== 0 && (
            <p className={`mt-0.5 text-[11px] ${change.cards_amount < 0 ? "text-ok" : "text-warn"}`}>
              {change.cards_amount < 0 ? "−" : "+"}
              {money(Math.abs(change.cards_amount), { whole: true })} vs inicio
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Préstamos y créditos</p>
          <p className="num text-xl font-semibold text-foreground">{money(current.loans_debt)}</p>
          {change && change.loans_amount !== 0 && (
            <p className={`mt-0.5 text-[11px] ${change.loans_amount < 0 ? "text-ok" : "text-warn"}`}>
              {change.loans_amount < 0 ? "−" : "+"}
              {money(Math.abs(change.loans_amount), { whole: true })} vs inicio
            </p>
          )}
        </div>
      </div>

      {evolution.snapshots.length > 1 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted">Historial de puntos registrados</p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-surface-2/80 text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Tarjetas</th>
                  <th className="px-3 py-2 font-medium">Préstamos</th>
                  <th className="px-3 py-2 font-medium">Nota / Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {evolution.snapshots.map((s, idx) => {
                  const isCurrent = idx === evolution.snapshots.length - 1;
                  const isBase = idx === 0;
                  return (
                    <tr key={s.id} className={isCurrent ? "bg-accent-soft/20 font-medium" : ""}>
                      <td className="px-3 py-2 whitespace-nowrap text-foreground">
                        {formatShortDate(s.date)}
                        {isBase && <span className="ml-1 text-[10px] text-muted">(Inicio)</span>}
                        {isCurrent && <span className="ml-1 text-[10px] text-accent">(Actual)</span>}
                      </td>
                      <td className="num px-3 py-2 font-semibold text-foreground">{money(s.total_debt)}</td>
                      <td className="num px-3 py-2 text-muted">{money(s.cards_debt)}</td>
                      <td className="num px-3 py-2 text-muted">{money(s.loans_debt)}</td>
                      <td className="px-3 py-2 text-muted truncate max-w-[200px]" title={s.notes}>
                        {s.notes || (isBase ? "Punto de partida" : isCurrent ? "Balance actual" : "Actualización")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
