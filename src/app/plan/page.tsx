import { connection } from "next/server";
import { EntityEditor, type EntityRow } from "@/components/entity-editor";
import { ProfileEditor } from "@/components/profile-editor";
import { authEnabled } from "@/lib/auth";
import { formatShortDate, todayISO } from "@/lib/dates";
import { planStatus, revolvingBalance } from "@/lib/engine";
import { label, money } from "@/lib/format";
import { getSetting, listEntity, listGoals, listMemories, loadFinanceData } from "@/lib/repo";
import { logoutAction } from "../actions";

export default async function PlanPage() {
  await connection();
  const today = todayISO();
  const [data, goals, profile, memories, rawAccounts, rawPlans, rawBills, rawIncomes, rawGoals] = await Promise.all([
    loadFinanceData(),
    listGoals(),
    getSetting("profile"),
    listMemories(),
    listEntity("accounts"),
    listEntity("plans"),
    listEntity("bills"),
    listEntity("incomes"),
    listEntity("goals"),
  ]);
  const values = (raw: Record<string, unknown>[], id: number) => raw.find((r) => Number(r.id) === id) ?? {};
  const accounts = data.accounts.map((a) => ({ id: a.id, name: a.name }));
  const accountName = (id: number | null) => data.accounts.find((a) => a.id === id)?.name;

  const accountRows: EntityRow[] = data.accounts.map((a) => ({
    id: a.id,
    values: values(rawAccounts, a.id),
    inactive: !a.active,
    summary: `${a.name} · ${a.type === "credit" ? `owe ${money(a.balance)}` : money(a.balance)}`,
    detail:
      a.type === "credit"
        ? `To pay in full: ${money(revolvingBalance(data, a, today))}${
            a.statement_day ? ` · corte day ${a.statement_day}` : " · no fecha de corte set"
          }`
        : label(a.type),
  }));

  const planRows: EntityRow[] = data.plans.map((p) => {
    const s = planStatus(data, p, today);
    return {
      id: p.id,
      values: values(rawPlans, p.id),
      inactive: !p.active || s.payments_left === 0,
      summary: `${p.name} · ${money(p.payment_amount)}/mo`,
      detail:
        s.payments_left === 0
          ? "Paid off 🎉"
          : `${s.payments_left} of ${p.total_payments} left · next ${formatShortDate(s.next_payment!)} · ends ${formatShortDate(s.last_payment!)}`,
    };
  });

  const billRows: EntityRow[] = data.bills.map((b) => ({
    id: b.id,
    values: values(rawBills, b.id),
    inactive: !b.active,
    summary: `${b.name} · ${money(b.amount)}`,
    detail: `Day ${b.day_of_month}${b.is_estimate ? " (estimated)" : ""}${
      accountName(b.account_id) ? ` · ${accountName(b.account_id)}` : ""
    }`,
  }));

  const incomeRows: EntityRow[] = data.incomes.map((i) => ({
    id: i.id,
    values: values(rawIncomes, i.id),
    inactive: !i.active,
    summary: `${i.name} · ${money(i.amount)} ${i.frequency}`,
    detail: `${accountName(i.account_id) ?? "No account"}${i.restricted_to ? ` · only for ${i.restricted_to}` : ""}`,
  }));

  const goalRows: EntityRow[] = goals.map((g) => ({
    id: g.id,
    values: values(rawGoals, g.id),
    inactive: g.status !== "active",
    summary: g.title,
    detail: [
      label(g.status),
      g.target_amount != null &&
        `${g.current_amount != null ? `${money(g.current_amount)} of ` : ""}${money(g.target_amount)}`,
      g.target_date && `by ${formatShortDate(g.target_date)}`,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">My plan</h1>
        <p className="text-sm text-muted">
          Everything the dashboard and coach use. Keep balances up to date (or just tell the coach) for accurate advice.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <EntityEditor kind="accounts" rows={accountRows} accounts={accounts} />
        <EntityEditor kind="plans" rows={planRows} accounts={accounts} />
        <EntityEditor kind="bills" rows={billRows} accounts={accounts} />
        <EntityEditor kind="incomes" rows={incomeRows} accounts={accounts} />
        <EntityEditor kind="goals" rows={goalRows} accounts={accounts} />
        <ProfileEditor profile={profile ?? ""} memories={memories} />
      </div>
      {authEnabled() && (
        <form action={logoutAction}>
          <button className="btn btn-ghost">Log out</button>
        </form>
      )}
    </div>
  );
}
