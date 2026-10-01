import "server-only";
import { ENTITIES, parseEntity, type EntityKind, type FieldDef } from "../entities";
import { deleteEntity, listEntity, saveEntity } from "../repo";

// Lets the coach create, change and delete the same records as the Plan page, validated by the
// same field definitions, so it can't save anything the forms wouldn't accept.

export const RECORD_KINDS = ["accounts", "plans", "bills", "incomes", "goals"] as const satisfies readonly EntityKind[];

/** Values a new record starts with before the given fields are applied. */
const NEW_DEFAULTS: Record<EntityKind, Record<string, unknown>> = {
  accounts: { active: 1 },
  plans: { active: 1, payments_made: 0 },
  bills: { active: 1 },
  incomes: { active: 1 },
  goals: { status: "active" },
};

const fieldsOf = (kind: EntityKind) => ENTITIES[kind].fields as readonly FieldDef[];

function fieldType(f: FieldDef): string {
  if (f.type === "select") return f.options!.join("|");
  if (f.type === "account") return "account id";
  if (f.type === "checkbox") return "true/false";
  if (f.type === "textarea") return "text";
  return f.type;
}

/** Field reference for the tool description (required fields marked with *). */
export function describeRecordFields(): string {
  return RECORD_KINDS.map(
    (k) => `- ${k}: ${fieldsOf(k).map((f) => `${f.name}${f.required ? "*" : ""} (${fieldType(f)})`).join(", ")}`,
  ).join("\n");
}

function toRaw(f: FieldDef, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f.type === "checkbox") return [true, 1, "1", "true", "on"].includes(v as never) ? "on" : "";
  return String(v);
}

export type FieldValue = string | number | boolean | null;

export async function listRecords(kind: EntityKind) {
  return listEntity(kind);
}

/** Creates a record (no id) or changes only the given fields of an existing one. */
export async function saveRecord(kind: EntityKind, id: number | undefined, fields: Record<string, FieldValue>) {
  const names = fieldsOf(kind).map((f) => f.name);
  const unknown = Object.keys(fields).filter((k) => !names.includes(k));
  if (unknown.length) return { error: `Unknown field(s) for ${kind}: ${unknown.join(", ")}. Valid fields: ${names.join(", ")}` };

  let current: Record<string, unknown> = NEW_DEFAULTS[kind];
  if (id) {
    const row = (await listEntity(kind)).find((r) => Number(r.id) === id);
    if (!row) return { error: `No ${ENTITIES[kind].singular} with id ${id}` };
    current = row;
  }
  const merged = { ...current, ...fields };
  const parsed = parseEntity(kind, Object.fromEntries(fieldsOf(kind).map((f) => [f.name, toRaw(f, merged[f.name])])));
  if (!parsed.ok) return { error: parsed.error };
  const savedId = await saveEntity(kind, parsed.values, id);
  return { saved: true, kind, id: savedId, created: !id, record: { id: savedId, ...parsed.values } };
}

export async function deleteRecord(kind: EntityKind, id: number) {
  const row = (await listEntity(kind)).find((r) => Number(r.id) === id);
  if (!row) return { error: `No ${ENTITIES[kind].singular} with id ${id}` };
  await deleteEntity(kind, id);
  return { deleted: true, kind, id, was: row };
}
