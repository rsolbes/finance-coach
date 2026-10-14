import Link from "next/link";
import { connection } from "next/server";
import { Card } from "@/components/card";
import { ImportStatement } from "@/components/import-statement";
import { QuickAdd } from "@/components/quick-add";
import { MoneyIn } from "@/components/money-in";
import { RecordPayment } from "@/components/record-payment";
import { TransactionList } from "@/components/transaction-list";
import { addMonths, endOfMonth, formatMonthLabel, isISODate, todayISO } from "@/lib/dates";
import { PERIODS_PER_MONTH } from "@/lib/engine";
import { label, money } from "@/lib/format";
import { paymentTargets } from "@/lib/payments";
import { listTransactions, loadFinanceData } from "@/lib/repo";
import { spendingSummary } from "@/lib/spending";

export default async function SpendingPage({ searchParams }: PageProps<"/spending">) {
  await connection();
  const params = await searchParams;
  const today = todayISO();
  const m = typeof params.m === "string" && isISODate(`${params.m}-01`) ? params.m : today.slice(0, 7);
  const from = `${m}-01`;
  const to = endOfMonth(from);

  const [data, txs] = await Promise.all([loadFinanceData(), listTransactions({ from, to, limit: 5000 })]);
  const summary = spendingSummary(txs, from, to);
  const accounts = data.accounts.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, type: a.type }));
  const prev = addMonths(from, -1).slice(0, 7);
  const next = addMonths(from, 1).slice(0, 7);
  const top = summary.by_category[0]?.amount ?? 1;

  // Food vouchers / vales de despensa vs. groceries
  const voucherIncomes = data.incomes.filter(
    (i) =>
      i.active &&
      (i.restricted_to === "food" ||
        i.restricted_to === "despensa" ||
        accounts.find((a) => a.id === i.account_id)?.type === "voucher"),
  );
  const monthlyVouchers = Math.round(
    voucherIncomes.reduce((acc, i) => acc + i.amount * (PERIODS_PER_MONTH[i.frequency] ?? 0), 0),
  );
  const groceriesCategory = summary.by_category.find((c) => c.category === "groceries");
  const groceriesSpent = groceriesCategory?.amount ?? 0;
  const voucherAccount = data.accounts.find((a) => a.active && a.type === "voucher");

  // Payments can come from any account, including a credit card (then they're added to what it owes).
  // Put the payroll account (where the money usually is) first.
  const fromAccounts = accounts
    .filter((a) => a.type !== "voucher")
    .sort((a, b) => Number(b.name.includes("Nómina")) - Number(a.name.includes("Nómina")));
  const incomes = data.incomes
    .filter((i) => i.active)
    .map((i) => ({ id: i.id, name: i.name, amount: i.amount, account_id: i.account_id }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Spending & payments</h1>
        <div className="flex items-center gap-1 text-sm">
          <Link href={`/spending?m=${prev}`} className="btn btn-ghost px-2.5" aria-label="Previous month">
            ‹
          </Link>
          <span className="w-24 text-center font-medium">{formatMonthLabel(m)}</span>
          <Link href={`/spending?m=${next}`} className="btn btn-ghost px-2.5" aria-label="Next month">
            ›
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <RecordPayment targets={paymentTargets(data, today)} fromAccounts={fromAccounts} today={today} />
        <MoneyIn accounts={accounts} incomes={incomes} today={today} />
        <div className="lg:col-span-2">
          <ImportStatement accounts={accounts} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card title={`Spent in ${formatMonthLabel(m)}`} subtitle="Card payments and transfers between your accounts are excluded">
          <p className="num text-3xl font-semibold">{money(summary.total_spent)}</p>
          <p className="text-sm text-muted">
            {summary.transactions} transactions · {money(summary.daily_average_spent)} per day
          </p>
          {summary.financed_in_installments.total > 0 && (
            <p className="mt-2 rounded-lg bg-surface-2 p-2 text-xs text-muted">
              + {money(summary.financed_in_installments.total)} bought a meses (
              {summary.financed_in_installments.purchases.length}{" "}
              {summary.financed_in_installments.purchases.length === 1 ? "purchase" : "purchases"}). Not counted here: you
              pay it month by month through your installment plans.
            </p>
          )}
          {summary.by_category.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {summary.by_category.map((c) => (
                <li key={c.category} className="text-sm">
                  <div className="flex justify-between">
                    <span>{label(c.category)}</span>
                    <span className="num">
                      {money(c.amount)} <span className="text-muted">({c.pct}%)</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-surface-2">
                    <div className="h-full rounded bg-accent" style={{ width: `${(c.amount / top) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {summary.top_merchants.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold">Where it went</h3>
              <ul className="mt-1 divide-y divide-border text-sm">
                {summary.top_merchants.slice(0, 8).map((x) => (
                  <li key={x.merchant} className="flex justify-between py-1.5">
                    <span className="truncate">
                      {x.merchant} <span className="text-muted">×{x.count}</span>
                    </span>
                    <span className="num">{money(x.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {(monthlyVouchers > 0 || voucherAccount) && (
            <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3 text-sm">
              <div className="flex items-center justify-between font-medium">
                <span>🛒 Vales de despensa vs. Súper</span>
                <span className="num font-semibold">{money(groceriesSpent)} gastado</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                Vales mensuales estimados: {money(monthlyVouchers)}
                {voucherAccount ? ` · Saldo actual en tarjeta: ${money(voucherAccount.balance)}` : ""}
              </p>
              <div className="mt-2 text-xs">
                {groceriesSpent <= monthlyVouchers ? (
                  <span className="inline-flex items-center gap-1 font-medium text-ok">
                    ✓ Cubierto por tus vales (te quedan ~{money(monthlyVouchers - groceriesSpent)} de margen)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-warn">
                    ⚠ Excediste tus vales por ~{money(groceriesSpent - monthlyVouchers)} (pagado de tu sueldo/efectivo)
                  </span>
                )}
              </div>
            </div>
          )}
          {summary.transactions > 0 && (
            <Link
              href={`/coach?q=${encodeURIComponent(
                `Look at my spending for ${formatMonthLabel(m)} and tell me where I can realistically cut back.`,
              )}`}
              className="btn mt-4"
            >
              Ask the coach about this month
            </Link>
          )}
        </Card>

        <Card title="Transactions" action={<QuickAdd accounts={accounts} today={today} />}>
          <TransactionList transactions={txs} accounts={accounts} />
        </Card>
      </div>
    </div>
  );
}
