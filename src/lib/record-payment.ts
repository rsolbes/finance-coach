import "server-only";
import { db, query } from "./db";
import { todayISO } from "./dates";
import { paymentEffects, type PaymentInput } from "./payments";
import { loadFinanceData } from "./repo";

export type RecordPaymentResult = { ok: true; message: string; notes: string[] } | { ok: false; error: string };

/** Records a payment: logs it as a transaction and updates balances, plans and due dates in one batch. */
export async function recordPayment(
  input: PaymentInput & { description: string; force?: boolean },
): Promise<RecordPaymentResult> {
  const today = todayISO();
  const data = await loadFinanceData();
  const fx = paymentEffects(data, input, today);
  if ("error" in fx) return { ok: false, error: fx.error };

  if (!input.force) {
    const dup = await query(
      "SELECT description FROM transactions WHERE source = 'payment' AND date = ? AND amount = ? LIMIT 1",
      [input.date, -input.amount],
    );
    if (dup.length)
      return {
        ok: false,
        error: `A payment of ${input.amount.toFixed(2)} on ${input.date} is already recorded ("${String(
          dup[0].description,
        )}"). If this is a different payment, save it again with "record anyway".`,
      };
  }

  const description = input.description.trim() || (fx.target_label ? `Payment to ${fx.target_label}` : "Payment");
  await (await db()).batch(
    [
      ...fx.balances.map((b) => ({ sql: "UPDATE accounts SET balance = ? WHERE id = ?", args: [b.balance, b.account_id] })),
      ...fx.due_dates.map((d) => ({
        sql: "UPDATE accounts SET next_due_date = ? WHERE id = ?",
        args: [d.next_due_date, d.account_id],
      })),
      ...fx.plans.map((p) => ({
        sql: "UPDATE plans SET payments_made = ?, next_payment_date = ? WHERE id = ?",
        args: [p.payments_made, p.next_payment_date, p.plan_id],
      })),
      {
        sql: `INSERT INTO transactions (account_id, date, description, amount, category, notes, source)
              VALUES (?, ?, ?, ?, ?, ?, 'payment')`,
        args: [input.from_account_id, input.date, description.slice(0, 300), -input.amount, fx.category, fx.notes.join(" ")],
      },
    ],
    "write",
  );
  return { ok: true, message: `Recorded ${description} (${input.amount.toFixed(2)}).`, notes: fx.notes };
}
