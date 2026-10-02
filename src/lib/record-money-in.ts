import "server-only";
import { db, query } from "./db";
import { moneyInEffects, type MoneyInInput } from "./money-in";
import { loadFinanceData } from "./repo";

export type RecordMoneyInResult = { ok: true; message: string; notes: string[] } | { ok: false; error: string };

/** Logs money received and adds it to the account's balance, in one batch. */
export async function recordMoneyIn(input: MoneyInInput & { force?: boolean }): Promise<RecordMoneyInResult> {
  const data = await loadFinanceData();
  const fx = moneyInEffects(data, input);
  if ("error" in fx) return { ok: false, error: fx.error };

  if (!input.force) {
    const dup = await query(
      "SELECT description FROM transactions WHERE source = 'money_in' AND date = ? AND amount = ? AND account_id IS ? LIMIT 1",
      [input.date, input.amount, input.account_id],
    );
    if (dup.length)
      return {
        ok: false,
        error: `${input.amount.toFixed(2)} into ${fx.account_name} on ${input.date} is already recorded ("${String(
          dup[0].description,
        )}"). If this is a different deposit, save it again with "record anyway".`,
      };
  }

  const description = input.description.trim() || (input.category === "income" ? "Income" : "Money in");
  await (await db()).batch(
    [
      ...(fx.balance
        ? [{ sql: "UPDATE accounts SET balance = ? WHERE id = ?", args: [fx.balance.balance, fx.balance.account_id] }]
        : []),
      {
        sql: `INSERT INTO transactions (account_id, date, description, amount, category, notes, source)
              VALUES (?, ?, ?, ?, ?, ?, 'money_in')`,
        args: [input.account_id, input.date, description.slice(0, 300), input.amount, input.category, fx.notes.join(" ")],
      },
    ],
    "write",
  );
  return { ok: true, message: `Recorded ${description} (${input.amount.toFixed(2)}) into ${fx.account_name}.`, notes: fx.notes };
}
