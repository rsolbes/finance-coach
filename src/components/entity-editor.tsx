"use client";

import { useActionState, useState, useTransition } from "react";
import { deleteEntityAction, saveEntityAction, type FormState } from "@/app/actions";
import { ENTITIES, type EntityKind, type FieldDef } from "@/lib/entities";
import { label } from "@/lib/format";

export interface EntityRow {
  id: number;
  values: Record<string, unknown>;
  summary: string;
  detail?: string;
  inactive?: boolean;
}

export function EntityEditor(props: { kind: EntityKind; rows: EntityRow[]; accounts: { id: number; name: string }[] }) {
  const def = ENTITIES[props.kind];
  const [open, setOpen] = useState<number | "new" | null>(null);

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{def.title}</h2>
        <button className="btn btn-ghost" onClick={() => setOpen(open === "new" ? null : "new")}>
          {open === "new" ? "Cancel" : `+ Add ${def.singular}`}
        </button>
      </div>
      {open === "new" && (
        <EntityForm kind={props.kind} accounts={props.accounts} onDone={() => setOpen(null)} />
      )}
      <ul className="mt-2 divide-y divide-border">
        {props.rows.map((r) => (
          <li key={r.id} className={r.inactive ? "opacity-50" : ""}>
            <button
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
              onClick={() => setOpen(open === r.id ? null : r.id)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{r.summary}</span>
                {r.detail && <span className="block truncate text-xs text-muted">{r.detail}</span>}
              </span>
              <span className="text-muted">{open === r.id ? "−" : "+"}</span>
            </button>
            {open === r.id && (
              <EntityForm
                kind={props.kind}
                id={r.id}
                values={r.values}
                accounts={props.accounts}
                onDone={() => setOpen(null)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EntityForm(props: {
  kind: EntityKind;
  id?: number;
  values?: Record<string, unknown>;
  accounts: { id: number; name: string }[];
  onDone: () => void;
}) {
  const save = saveEntityAction.bind(null, props.kind, props.id ?? null);
  const [state, action, pending] = useActionState<FormState, FormData>(save, {});
  const [deleting, startDelete] = useTransition();
  const fields = ENTITIES[props.kind].fields as readonly FieldDef[];

  return (
    <form action={action} className="mb-3 grid gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-2">
      {fields.map((f) => (
        <Field key={f.name} field={f} value={props.values?.[f.name]} isNew={!props.id} accounts={props.accounts} />
      ))}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button className="btn" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={props.onDone}>
          Close
        </button>
        {props.id && (
          <button
            type="button"
            className="btn btn-danger ml-auto"
            disabled={deleting}
            onClick={() =>
              confirm("Delete permanently? (To keep history, uncheck Active instead.)") &&
              startDelete(async () => {
                await deleteEntityAction(props.kind, props.id!);
                props.onDone();
              })
            }
          >
            Delete
          </button>
        )}
        {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
        {state.ok && <p className="w-full text-sm text-ok">{state.message}</p>}
      </div>
    </form>
  );
}

function Field({
  field: f,
  value,
  isNew,
  accounts,
}: {
  field: FieldDef;
  value: unknown;
  isNew: boolean;
  accounts: { id: number; name: string }[];
}) {
  const str = value === null || value === undefined ? "" : String(value);
  const wide = f.type === "textarea" ? "sm:col-span-2" : "";
  if (f.type === "checkbox")
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={f.name} defaultChecked={isNew ? f.name === "active" : Boolean(Number(value))} />
        {f.label}
      </label>
    );

  let control: React.ReactNode;
  if (f.type === "select")
    control = (
      <select name={f.name} defaultValue={str || (f.required ? f.options?.[0] : "")} className="field">
        {!f.required && <option value="">—</option>}
        {f.options?.map((o) => (
          <option key={o} value={o}>
            {label(o)}
          </option>
        ))}
      </select>
    );
  else if (f.type === "account")
    control = (
      <select name={f.name} defaultValue={str} className="field">
        <option value="">—</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    );
  else if (f.type === "textarea")
    control = <textarea name={f.name} defaultValue={str} rows={3} className="field" />;
  else
    control = (
      <input
        name={f.name}
        defaultValue={str}
        type={f.type === "date" ? "date" : "text"}
        inputMode={f.type === "number" ? "decimal" : f.type === "int" ? "numeric" : undefined}
        required={f.required}
        className="field"
      />
    );

  return (
    <label className={`flex flex-col gap-1 text-sm ${wide}`}>
      <span className="text-xs font-medium text-muted">{f.label}</span>
      {control}
      {f.help && <span className="text-xs text-muted">{f.help}</span>}
    </label>
  );
}
