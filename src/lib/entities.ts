// Field definitions for the editable tables on the Plan page. The same
// definitions render the forms (client) and parse/validate submissions (server).
import { isISODate } from "./dates";
import {
  ACCOUNT_TYPES,
  CATEGORIES,
  GOAL_KINDS,
  GOAL_STATUSES,
  INCOME_FREQUENCIES,
  PLAN_KINDS,
} from "./types";

export type FieldType = "text" | "textarea" | "number" | "int" | "date" | "select" | "checkbox" | "account";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  required?: boolean;
  min?: number;
  max?: number;
  help?: string;
}

export interface EntityDef {
  table: string;
  title: string;
  singular: string;
  fields: FieldDef[];
}

export const ENTITIES = {
  accounts: {
    table: "accounts",
    title: "Accounts & cards",
    singular: "account",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "institution", label: "Bank", type: "text" },
      { name: "type", label: "Type", type: "select", options: ACCOUNT_TYPES, required: true },
      {
        name: "balance",
        label: "Balance",
        type: "number",
        required: true,
        help: "Debit/wallet: money you have. Credit card: total you owe (positive number).",
      },
      { name: "credit_limit", label: "Credit limit", type: "number" },
      { name: "statement_day", label: "Fecha de corte (day)", type: "int", min: 1, max: 31 },
      { name: "payment_due_days", label: "Days to pay after corte", type: "int", min: 1, max: 60 },
      {
        name: "next_due_date",
        label: "Next payment due (fecha límite)",
        type: "date",
        help: "Set it when you already paid the current statement, or when you don't know the fecha de corte.",
      },
      { name: "notes", label: "Notes", type: "textarea" },
      { name: "active", label: "Active", type: "checkbox" },
    ],
  },
  plans: {
    table: "plans",
    title: "Installments & loans",
    singular: "plan",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      {
        name: "account_id",
        label: "Card / account",
        type: "account",
        help: "For card installments pick the card: it separates them from the balance you must pay in full.",
      },
      { name: "kind", label: "Kind", type: "select", options: PLAN_KINDS, required: true },
      { name: "original_amount", label: "Original amount", type: "number", required: true },
      { name: "payment_amount", label: "Payment (incl. interest + IVA)", type: "number", required: true },
      { name: "capital_per_payment", label: "Capital per payment", type: "number" },
      { name: "total_payments", label: "Total payments", type: "int", required: true, min: 1, max: 120 },
      { name: "payments_made", label: "Payments made", type: "int", required: true, min: 0, max: 120 },
      { name: "next_payment_date", label: "Next payment due", type: "date", required: true },
      { name: "notes", label: "Notes", type: "textarea" },
      { name: "active", label: "Active", type: "checkbox" },
    ],
  },
  bills: {
    table: "bills",
    title: "Recurring bills",
    singular: "bill",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "amount", label: "Amount", type: "number", required: true },
      { name: "day_of_month", label: "Day of month", type: "int", required: true, min: 1, max: 31 },
      { name: "account_id", label: "Paid from", type: "account" },
      { name: "category", label: "Category", type: "select", options: CATEGORIES, required: true },
      { name: "is_estimate", label: "Amount/date is an estimate", type: "checkbox" },
      { name: "notes", label: "Notes", type: "textarea" },
      { name: "active", label: "Active", type: "checkbox" },
    ],
  },
  incomes: {
    table: "incomes",
    title: "Income",
    singular: "income",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "amount", label: "Amount per payment", type: "number", required: true },
      { name: "frequency", label: "Frequency", type: "select", options: INCOME_FREQUENCIES, required: true },
      { name: "anchor_date", label: "A real pay date", type: "date", required: true },
      { name: "account_id", label: "Deposited to", type: "account" },
      { name: "restricted_to", label: "Only usable for (e.g. food)", type: "text" },
      { name: "notes", label: "Notes", type: "textarea" },
      { name: "active", label: "Active", type: "checkbox" },
    ],
  },
  goals: {
    table: "goals",
    title: "Goals",
    singular: "goal",
    fields: [
      { name: "title", label: "Goal", type: "text", required: true },
      { name: "kind", label: "Kind", type: "select", options: GOAL_KINDS, required: true },
      { name: "target_amount", label: "Target amount", type: "number" },
      { name: "current_amount", label: "Current amount", type: "number" },
      { name: "category", label: "Category (for spending limits)", type: "select", options: CATEGORIES },
      { name: "target_date", label: "Target date", type: "date" },
      { name: "status", label: "Status", type: "select", options: GOAL_STATUSES, required: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
} as const satisfies Record<string, EntityDef>;

export type EntityKind = keyof typeof ENTITIES;

export function isEntityKind(kind: string): kind is EntityKind {
  return Object.hasOwn(ENTITIES, kind);
}

export type ParsedValue = string | number | null;

/** Validates raw form values against the field definitions. */
export function parseEntity(
  kind: EntityKind,
  raw: Record<string, string | undefined>,
): { ok: true; values: Record<string, ParsedValue> } | { ok: false; error: string } {
  const values: Record<string, ParsedValue> = {};
  for (const f of ENTITIES[kind].fields as readonly FieldDef[]) {
    const input = (raw[f.name] ?? "").trim();
    if (f.type === "checkbox") {
      values[f.name] = input === "on" || input === "true" || input === "1" ? 1 : 0;
      continue;
    }
    if (input === "") {
      if (f.required) return { ok: false, error: `${f.label} is required` };
      values[f.name] = f.type === "text" || f.type === "textarea" ? "" : null;
      // Nullable text columns: an empty "restricted_to" means no restriction.
      if (f.name === "restricted_to") values[f.name] = null;
      continue;
    }
    switch (f.type) {
      case "number":
      case "int":
      case "account": {
        const n = Number(input.replace(/[$,\s]/g, ""));
        if (!Number.isFinite(n)) return { ok: false, error: `${f.label} must be a number` };
        if ((f.type === "int" || f.type === "account") && !Number.isInteger(n))
          return { ok: false, error: `${f.label} must be a whole number` };
        if (f.min !== undefined && n < f.min) return { ok: false, error: `${f.label} must be at least ${f.min}` };
        if (f.max !== undefined && n > f.max) return { ok: false, error: `${f.label} must be at most ${f.max}` };
        values[f.name] = n;
        break;
      }
      case "date":
        if (!isISODate(input)) return { ok: false, error: `${f.label} must be a date` };
        values[f.name] = input;
        break;
      case "select":
        if (!f.options?.includes(input)) return { ok: false, error: `${f.label} has an invalid value` };
        values[f.name] = input;
        break;
      default:
        values[f.name] = input.slice(0, 4000);
    }
  }
  if (kind === "plans" && Number(values.payments_made) > Number(values.total_payments))
    return { ok: false, error: "Payments made can't be more than total payments" };
  return { ok: true, values };
}
