import Link from "next/link";
import { connection } from "next/server";
import { Card } from "@/components/card";
import { addDays, formatMonthLabel, formatShortDate, todayISO } from "@/lib/dates";
import { cashTimeline, monthlyProjection, snapshot } from "@/lib/engine";
import { money } from "@/lib/format";
import { loadFinanceData } from "@/lib/repo";

export default async function Dashboard() {
  await connection();
  const data = await loadFinanceData();
  const today = todayISO();
  const snap = snapshot(data, today);
  const timeline = cashTimeline(data, today, 45);
  const months = monthlyProjection(data, today, 12);
  const next3Weeks = timeline.rows.filter((r) => r.date <= addDays(today, 21));
  const maxAbs = Math.max(1, ...months.map((m) => Math.abs(m.left_for_living)));
  const unscheduled = snap.cards.filter((c) => !c.revolving_due && c.revolving > 0);

  const askCoach = (q: string) => `/coach?q=${encodeURIComponent(q)}`;

  return (
    <div className="flex flex-col gap-5">
      <section>
        <p className="text-sm text-muted">{formatShortDate(today)}</p>
        <div className="mt-1 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Cash available</p>
            <p className="num text-3xl font-semibold tracking-tight">{money(snap.available_cash)}</p>
            {snap.voucher_balance > 0 && (
              <p className="text-sm text-muted">+ {money(snap.voucher_balance)} in food vouchers</p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/coach" className="btn">
              Talk to coach
            </Link>
            <Link href="/spending#payments" className="btn btn-ghost">
              I made a payment
            </Link>
          </div>
        </div>
      </section>

      {timeline.first_shortfall_date && (
        <section className="rounded-2xl border border-danger/30 bg-danger-soft p-4">
          <p className="font-semibold text-danger">Cash runs short on {formatShortDate(timeline.first_shortfall_date)}</p>
          <p className="mt-1 text-sm">
            If every payment below is made on its due date, your balance reaches its lowest point of{" "}
            <b className="num">{money(timeline.lowest_balance)}</b> on {formatShortDate(timeline.lowest_balance_date)}.
            This doesn&apos;t include food, transport or other spending yet.
          </p>
          <Link
            href={askCoach(
              "My cash runs short in the next weeks. Help me plan which payments to make with each paycheck so I avoid interest and late fees.",
            )}
            className="mt-3 inline-block text-sm font-semibold text-danger underline underline-offset-4"
          >
            Make a plan with the coach →
          </Link>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Monthly income (net)" value={money(snap.monthly_income, { whole: true })}>
          {snap.monthly_restricted_income > 0 && `+ ${money(snap.monthly_restricted_income, { whole: true })} vouchers`}
        </Stat>
        <Stat
          label="Fixed payments / month"
          value={money(snap.monthly_committed, { whole: true })}
          tone={snap.committed_pct_of_income > 50 ? "warn" : undefined}
        >
          {snap.committed_pct_of_income}% of income
        </Stat>
        <Stat
          label="Card balances to pay in full"
          value={money(snap.revolving_debt, { whole: true })}
          tone={snap.revolving_debt > snap.monthly_income * 0.3 ? "danger" : undefined}
        >
          excludes installments
        </Stat>
        <Stat label="Installments left" value={money(snap.installment_debt_remaining, { whole: true })}>
          incl. future interest
        </Stat>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Next 3 weeks" subtitle="Running balance of your debit accounts">
          {next3Weeks.length === 0 ? (
            <p className="text-sm text-muted">Nothing scheduled.</p>
          ) : (
            <ul className="divide-y divide-border">
              {next3Weeks.map((r, i) => (
                <li key={i} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-24 shrink-0 text-muted">{formatShortDate(r.date)}</span>
                  <span className="min-w-0 flex-1 truncate" title={r.label}>
                    {r.label}
                    {r.restricted && <span className="text-muted"> (vouchers)</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className={`num ${r.kind === "income" ? "text-ok" : ""}`}>
                      {r.kind === "income" ? "+" : "−"}
                      {money(r.amount)}
                    </span>
                    {!r.restricted && (
                      <span className={`num text-xs ${r.balance_after < 0 ? "text-danger" : "text-muted"}`}>
                        bal. {money(r.balance_after)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {unscheduled.length > 0 && (
            <p className="mt-3 rounded-lg bg-warn-soft p-2 text-xs">
              Not scheduled yet (no fecha de corte):{" "}
              {unscheduled.map((c) => `${c.account} ${money(c.revolving)}`).join(", ")}. Add it on the{" "}
              <Link href="/plan" className="underline">
                Plan
              </Link>{" "}
              page.
            </p>
          )}
        </Card>

        <Card title="Months ahead" subtitle="Income minus fixed payments and card balances = left for living costs">
          <ul className="flex flex-col gap-2">
            {months.map((m) => (
              <li key={m.month} className="text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-muted">
                    {formatMonthLabel(m.month)}
                    {m.partial && "*"}
                  </span>
                  <div className="relative h-5 flex-1 rounded bg-surface-2">
                    <div
                      className={`absolute inset-y-0 left-0 rounded ${m.left_for_living < 0 ? "bg-danger" : "bg-accent"}`}
                      style={{ width: `${(Math.abs(m.left_for_living) / maxAbs) * 100}%` }}
                    />
                  </div>
                  <span className={`num w-24 shrink-0 text-right ${m.left_for_living < 0 ? "text-danger" : ""}`}>
                    {money(m.left_for_living, { whole: true })}
                  </span>
                </div>
                {m.plans_ending.length > 0 && (
                  <p className="ml-23 text-xs text-ok">Last payment: {m.plans_ending.join(", ")}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            * from today. Months with 5 Fridays have an extra paycheck. Red bars mean fixed payments are more than
            income that month.
          </p>
        </Card>

        <Card title="Light at the end of the tunnel" subtitle="When each plan ends and what it frees up">
          <ul className="divide-y divide-border">
            {snap.relief_timeline.map((r) => (
              <li key={r.plan} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{r.plan}</span>
                  <span className="text-xs text-muted">last payment {formatShortDate(r.last_payment)}</span>
                </span>
                <span className="num shrink-0 text-ok">+{money(r.monthly_amount_freed)}/mo</span>
              </li>
            ))}
          </ul>
        </Card>

        {snap.needs_confirmation.length > 0 && (
          <Card title="Please confirm" subtitle="Assumptions made when setting up. Fix them on the Plan page.">
            <ul className="flex flex-col gap-2 text-sm">
              {snap.needs_confirmation.map((c, i) => (
                <li key={i} className="rounded-lg bg-warn-soft p-2">
                  <b>{c.item}:</b> {c.note.replace("CONFIRM:", "").trim()}
                </li>
              ))}
            </ul>
            <Link href="/plan" className="btn btn-ghost mt-3">
              Edit my plan
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string; tone?: "warn" | "danger"; children?: React.ReactNode }) {
  const tone = props.tone === "danger" ? "text-danger" : props.tone === "warn" ? "text-warn" : "";
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <p className="text-xs text-muted">{props.label}</p>
      <p className={`num mt-1 text-xl font-semibold ${tone}`}>{props.value}</p>
      {props.children && <p className="mt-0.5 text-xs text-muted">{props.children}</p>}
    </div>
  );
}
