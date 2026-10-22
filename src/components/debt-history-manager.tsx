"use client";

import { useActionState, useState } from "react";
import { formatShortDate, todayISO } from "@/lib/dates";
import { money } from "@/lib/format";
import type { DebtSnapshot } from "@/lib/types";
import { deleteDebtSnapshotAction, recordDebtSnapshotAction } from "@/app/actions";

export function DebtHistoryManager({ snapshots }: { snapshots: DebtSnapshot[] }) {
  const [openAdd, setOpenAdd] = useState(false);
  const [state, formAction, isPending] = useActionState(recordDebtSnapshotAction, {});
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este registro del historial de deuda?")) return;
    setDeletingId(id);
    try {
      await deleteDebtSnapshotAction(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Historial de deuda</h2>
          <p className="text-xs text-muted">
            Registro cronológico de tu deuda total (tarjetas + préstamos). Se actualiza automáticamente al pagar o editar saldos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpenAdd(!openAdd)}
          className="btn btn-ghost text-xs text-accent"
        >
          {openAdd ? "Cerrar" : "+ Registrar punto manual"}
        </button>
      </div>

      {openAdd && (
        <form
          action={formAction}
          className="mt-4 rounded-xl border border-border bg-surface-2/60 p-3 space-y-3"
          onSubmit={() => setTimeout(() => setOpenAdd(false), 800)}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-muted">Fecha (YYYY-MM-DD)</label>
              <input
                type="date"
                name="date"
                defaultValue={todayISO()}
                className="field mt-1 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted">Deuda total (opcional)</label>
              <input
                type="number"
                step="0.01"
                name="total_debt"
                placeholder="Vacío = calcular automático"
                className="field mt-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted">Nota o concepto</label>
              <input
                type="text"
                name="notes"
                placeholder="Ej. Corte de mes / Liquidación"
                className="field mt-1 text-sm"
              />
            </div>
          </div>
          {state.error && <p className="text-xs font-medium text-danger">{state.error}</p>}
          {state.message && <p className="text-xs font-medium text-ok">{state.message}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="btn bg-accent text-surface hover:opacity-90 text-xs"
            >
              {isPending ? "Guardando..." : "Guardar punto"}
            </button>
          </div>
        </form>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-surface-2/80 text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Fecha</th>
              <th className="px-3 py-2 font-medium">Deuda total</th>
              <th className="px-3 py-2 font-medium">Tarjetas</th>
              <th className="px-3 py-2 font-medium">Préstamos</th>
              <th className="px-3 py-2 font-medium">Origen</th>
              <th className="px-3 py-2 font-medium">Nota</th>
              <th className="px-3 py-2 font-medium text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {snapshots.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-muted">
                  No hay registros de historial de deuda aún.
                </td>
              </tr>
            ) : (
              snapshots.map((s, idx) => {
                const isBase = idx === 0;
                return (
                  <tr key={s.id} className="hover:bg-surface-2/40">
                    <td className="px-3 py-2 whitespace-nowrap text-foreground font-medium">
                      {formatShortDate(s.date)}
                      {isBase && <span className="ml-1 text-[10px] text-muted">(Inicio)</span>}
                    </td>
                    <td className="num px-3 py-2 font-bold text-foreground">{money(s.total_debt)}</td>
                    <td className="num px-3 py-2 text-muted">{money(s.cards_debt)}</td>
                    <td className="num px-3 py-2 text-muted">{money(s.loans_debt)}</td>
                    <td className="px-3 py-2 text-muted capitalize">{s.source}</td>
                    <td className="px-3 py-2 text-muted max-w-[220px] truncate" title={s.notes}>
                      {s.notes || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {snapshots.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDelete(s.id)}
                          disabled={deletingId === s.id}
                          className="text-xs text-danger hover:underline disabled:opacity-50"
                        >
                          {deletingId === s.id ? "..." : "Borrar"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
