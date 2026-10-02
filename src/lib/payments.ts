// What happens when the user records a payment: which balances, plans and due dates change.
// Pure functions so the rules are testable; repo/record-payment.ts applies the result.
import { addDays, addMonths } from "./dates";
import { planSchedule, revolvingBalance, revolvingDueDate, round2 } from "./engine";
import { billOccurrenceFor, occurrenceKey } from "./settlement";
import type { Category, FinanceData, InstallmentPlan, RecurringBill } from "./types";

export interface PaymentTarget {
  /** "card:<account id>", "plan:<plan id>" or "bill:<bill id>" */
  key: string;
  kind: "card" | "plan" | "bill";
  id: number;
  label: string;
  due_date: string | null;
  /** Rough amount of the next payment (card: regular balance + installments due by then). */
  due_amount: number | null;
}

/** Things a payment can pay: credit cards, and plans that aren't charged to a card (loans, phone). */
export function paymentTargets(data: FinanceData, today: string): PaymentTarget[] {
  const out: PaymentTarget[] = [];
  for (const acc of data.accounts.filter((a) => a.active && a.type === "credit")) {
    const due = revolvingDueDate(acc, today);
    const installments = data.plans
      .filter((p) => p.active && p.account_id === acc.id)
      .flatMap((p) => planSchedule(p, today).filter((s) => due && s.date <= due).map(() => p.payment_amount));
    out.push({
      key: `card:${acc.id}`,
      kind: "card",
      id: acc.id,
      label: acc.name,
      due_date: due,
      due_amount: round2(revolvingBalance(data, acc, today) + installments.reduce((a, b) => a + b, 0)),
    });
  }
  // Recurring bills paid directly (not charged to a card, which its statement covers).
  for (const bill of data.bills.filter((b) => b.active && !isCardBill(data, b))) {
    let due = billOccurrenceFor(bill, addDays(today, 7));
    if (data.settled?.has(occurrenceKey(`bill:${bill.id}`, due))) due = billOccurrenceFor(bill, addDays(due, 8));
    out.push({ key: `bill:${bill.id}`, kind: "bill", id: bill.id, label: bill.name, due_date: due, due_amount: bill.amount });
  }
  for (const plan of data.plans.filter((p) => p.active && !isCardPlan(data, p))) {
    const next = planSchedule(plan, today)[0];
    if (!next) continue;
    out.push({
      key: `plan:${plan.id}`,
      kind: "plan",
      id: plan.id,
      label: `${plan.name} (${next.number}/${plan.total_payments})`,
      due_date: next.date,
      due_amount: plan.payment_amount,
    });
  }
  return out;
}

function isCardPlan(data: FinanceData, plan: InstallmentPlan): boolean {
  return data.accounts.some((a) => a.id === plan.account_id && a.type === "credit");
}

function isCardBill(data: FinanceData, bill: RecurringBill): boolean {
  return data.accounts.some((a) => a.id === bill.account_id && a.type === "credit");
}

export interface PaymentInput {
  date: string;
  amount: number;
  target: string | null;
  from_account_id: number | null;
  /** Subtract the amount from the account it was paid from. */
  deduct_from_account: boolean;
  /** Card payments: subtract the amount from the card's balance. */
  reduce_card_balance: boolean;
  /** Card payments: this pays the pending statement (its installments count as paid, due date moves on). */
  covers_statement: boolean;
}

export interface PaymentEffects {
  balances: { account_id: number; balance: number }[];
  due_dates: { account_id: number; next_due_date: string | null }[];
  plans: { plan_id: number; payments_made: number; next_payment_date: string }[];
  category: Category;
  target_label: string | null;
  /** The scheduled occurrence this payment settles, so projections stop counting it. */
  ref: string | null;
  notes: string[];
}

/** Marks plan payments up to and including number `lastPaid` as made, keeping the original schedule. */
function advancePlan(plan: InstallmentPlan, lastPaid: number) {
  return {
    plan_id: plan.id,
    payments_made: lastPaid,
    next_payment_date: addMonths(plan.next_payment_date, lastPaid - plan.payments_made),
  };
}

export function paymentEffects(
  data: FinanceData,
  input: PaymentInput,
  today: string,
): PaymentEffects | { error: string } {
  const fx: PaymentEffects = {
    balances: [],
    due_dates: [],
    plans: [],
    category: "other",
    target_label: null,
    ref: null,
    notes: [],
  };

  if (input.from_account_id && input.target === `card:${input.from_account_id}`)
    return { error: "A card can't pay itself. Pick the account the money came from." };

  if (input.from_account_id && input.deduct_from_account) {
    const from = data.accounts.find((a) => a.id === input.from_account_id);
    if (!from) return { error: "Unknown account it was paid from" };
    if (from.type === "credit") {
      // Paid with a credit card: no cash leaves today; it's added to what that card owes.
      const balance = round2(from.balance + input.amount);
      fx.balances.push({ account_id: from.id, balance });
      fx.notes.push(`Charged to ${from.name}, which now owes ${balance.toFixed(2)}.`);
    } else {
      const balance = round2(from.balance - input.amount);
      fx.balances.push({ account_id: from.id, balance });
      fx.notes.push(`${from.name} balance is now ${balance.toFixed(2)}.`);
    }
  }

  const [kind, rawId] = (input.target ?? "").split(":");
  const id = Number(rawId);

  if (kind === "card") {
    const acc = data.accounts.find((a) => a.id === id && a.type === "credit");
    if (!acc) return { error: "Unknown card" };
    fx.category = "card_payment";
    fx.target_label = acc.name;
    if (input.reduce_card_balance) {
      const balance = round2(Math.max(0, acc.balance - input.amount));
      fx.balances.push({ account_id: acc.id, balance });
      fx.notes.push(`${acc.name} now owes ${balance.toFixed(2)}.`);
    }
    if (input.covers_statement) {
      const due = revolvingDueDate(acc, today);
      if (!due) {
        fx.notes.push(`${acc.name} has no known due date, so only the balance was updated.`);
      } else if (input.date <= addMonths(due, -1)) {
        fx.notes.push(`This payment is older than the statement due ${due}, so that statement is still pending.`);
      } else {
        for (const plan of data.plans.filter((p) => p.active && p.account_id === acc.id)) {
          const covered = planSchedule(plan, today).filter((s) => s.date <= due);
          if (covered.length) {
            fx.plans.push(advancePlan(plan, covered.at(-1)!.number));
            fx.notes.push(`${plan.name}: payment ${covered.at(-1)!.number}/${plan.total_payments} marked as paid.`);
          }
        }
        const next = revolvingDueDate({ ...acc, next_due_date: null }, addDays(due, 1));
        fx.due_dates.push({ account_id: acc.id, next_due_date: next });
        fx.notes.push(
          next
            ? `Statement due ${due} marked as paid. Next payment: ${next}.`
            : `Statement due ${due} marked as paid.`,
        );
      }
    }
  } else if (kind === "plan") {
    const plan = data.plans.find((p) => p.id === id && p.active);
    if (!plan) return { error: "Unknown installment plan" };
    if (isCardPlan(data, plan)) return { error: "This plan is charged to a card. Record the payment to the card." };
    fx.category = "installment_payment";
    fx.target_label = plan.name;
    const next = planSchedule(plan, today)[0];
    if (!next) {
      fx.notes.push(`${plan.name} has no payments left.`);
    } else {
      // Due date of the payment before `next`; a receipt from on or before it paid that one (already counted).
      const previousDue = addMonths(plan.next_payment_date, next.number - plan.payments_made - 2);
      if (input.date <= previousDue) {
        fx.notes.push(`This receipt is for the payment due ${previousDue}, which was already counted.`);
      } else {
        fx.plans.push(advancePlan(plan, next.number));
        fx.notes.push(`${plan.name}: payment ${next.number}/${plan.total_payments} (due ${next.date}) marked as paid.`);
      }
    }
  } else if (kind === "bill") {
    const bill = data.bills.find((b) => b.id === id && b.active);
    if (!bill) return { error: "Unknown recurring bill" };
    if (isCardBill(data, bill)) return { error: "This bill is charged to a card. Record the payment to the card." };
    const occurrence = billOccurrenceFor(bill, input.date);
    fx.category = bill.category;
    fx.target_label = bill.name;
    fx.ref = occurrenceKey(`bill:${bill.id}`, occurrence);
    fx.notes.push(`${bill.name} due ${occurrence} marked as paid.`);
  } else if (input.target) {
    return { error: "Unknown payment target" };
  }
  return fx;
}
