"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AUTH_COOKIE, authEnabled, sessionToken } from "@/lib/auth";
import { isEntityKind, parseEntity } from "@/lib/entities";
import { clearFailures, clientIp, lockedMinutes, passcodeMatches, recordFailure } from "@/lib/login-guard";
import {
  deleteConversation,
  deleteEntity,
  deleteMemory,
  deleteTransaction,
  insertTransactions,
  saveEntity,
  setAccountBalance,
  setSetting,
  updateTransactionCategory,
} from "@/lib/repo";
import { recordPayment } from "@/lib/record-payment";
import { requireAuth } from "@/lib/session";
import { CATEGORIES } from "@/lib/types";

export interface FormState {
  ok?: boolean;
  error?: string;
  message?: string;
}

function refreshAll() {
  revalidatePath("/", "layout");
}

export async function saveEntityAction(kind: string, id: number | null, _prev: FormState, form: FormData) {
  await requireAuth();
  if (!isEntityKind(kind)) return { error: "Unknown item type" };
  const raw: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseEntity(kind, raw);
  if (!parsed.ok) return { error: parsed.error };
  await saveEntity(kind, parsed.values, id ?? undefined);
  refreshAll();
  return { ok: true, message: "Saved" };
}

export async function deleteEntityAction(kind: string, id: number) {
  await requireAuth();
  if (!isEntityKind(kind)) return;
  await deleteEntity(kind, id);
  refreshAll();
}

export async function saveProfileAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAuth();
  await setSetting("profile", String(form.get("profile") ?? "").slice(0, 8000));
  refreshAll();
  return { ok: true, message: "Saved. New coach conversations will use it." };
}

export async function deleteMemoryAction(id: number) {
  await requireAuth();
  await deleteMemory(id);
  refreshAll();
}

const ImportRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(300),
  amount: z.number().finite(),
  category: z.enum(CATEGORIES),
  note: z.string().max(500),
});

const ImportPayload = z.object({
  accountId: z.number().int().positive().nullable(),
  rows: z.array(ImportRow).max(2000),
  newBalance: z.number().finite().nullable(),
});

export async function saveImportAction(payload: unknown): Promise<FormState> {
  await requireAuth();
  const parsed = ImportPayload.safeParse(payload);
  if (!parsed.success) return { error: "Some rows are invalid" };
  const { accountId, rows, newBalance } = parsed.data;
  const res = await insertTransactions(
    rows.map((r) => ({
      account_id: accountId,
      date: r.date,
      description: r.description,
      amount: r.amount,
      category: r.category,
      notes: r.note,
      source: "import",
    })),
  );
  if (accountId && newBalance !== null) await setAccountBalance(accountId, newBalance);
  refreshAll();
  return {
    ok: true,
    message: `Saved ${res.inserted} transactions${res.skipped ? ` (${res.skipped} duplicates skipped)` : ""}${
      accountId && newBalance !== null ? " and updated the balance" : ""
    }.`,
  };
}

const PaymentPayload = z.object({
  date: z.string().regex(/^d{4}-d{2}-d{2}$/),
  amount: z.number().positive().finite(),
  description: z.string().max(300),
  target: z.string().regex(/^(card|plan):\d+$/).nullable(),
  from_account_id: z.number().int().positive().nullable(),
  deduct_from_account: z.boolean(),
  reduce_card_balance: z.boolean(),
  covers_statement: z.boolean(),
  force: z.boolean().optional(),
});

export async function recordPaymentAction(payload: unknown): Promise<FormState & { notes?: string[] }> {
  await requireAuth();
  const parsed = PaymentPayload.safeParse(payload);
  if (!parsed.success) return { error: "Fill in a valid date and amount" };
  const res = await recordPayment(parsed.data);
  if (!res.ok) return { error: res.error };
  refreshAll();
  return { ok: true, message: res.message, notes: res.notes };
}

export async function addTransactionAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAuth();
  const parsed = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      description: z.string().trim().min(1).max(300),
      amount: z.coerce.number().positive(),
      direction: z.enum(["out", "in"]),
      category: z.enum(CATEGORIES),
      account_id: z.string(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Fill in date, description, amount and category" };
  const d = parsed.data;
  await insertTransactions([
    {
      account_id: d.account_id ? Number(d.account_id) : null,
      date: d.date,
      description: d.description,
      amount: d.direction === "out" ? -d.amount : d.amount,
      category: d.category,
      notes: "",
      source: "manual",
    },
  ]);
  refreshAll();
  return { ok: true, message: "Added" };
}

export async function updateCategoryAction(id: number, category: string) {
  await requireAuth();
  const c = z.enum(CATEGORIES).safeParse(category);
  if (!c.success) return;
  await updateTransactionCategory(id, c.data);
  refreshAll();
}

export async function deleteTransactionAction(id: number) {
  await requireAuth();
  await deleteTransaction(id);
  refreshAll();
}

export async function deleteConversationAction(id: number) {
  await requireAuth();
  await deleteConversation(id);
  revalidatePath("/coach");
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!authEnabled()) redirect("/");
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const wait = await lockedMinutes(ip);
  if (wait) return { error: `Too many wrong attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` };
  if (!passcodeMatches(String(form.get("passcode") ?? ""), process.env.APP_PASSCODE ?? "")) {
    const { locked, triesLeft } = await recordFailure(ip);
    return {
      error: locked
        ? "Too many wrong attempts. Try again in 15 minutes."
        : `Wrong passcode. ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left before a 15-minute lockout.`,
    };
  }
  await clearFailures(ip);
  const jar = await cookies();
  jar.set(AUTH_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    // Secure only over HTTPS, so logging in over plain http on your home network still works.
    secure: hdrs.get("x-forwarded-proto") === "https",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });
  redirect("/");
}

export async function logoutAction() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/login");
}
