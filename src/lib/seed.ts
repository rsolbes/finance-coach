// Starting data for an empty database. Personal data never lives in the code: it's read from
// data/seed.json (git-ignored) when that file exists. Without it, the app starts empty and you
// fill it in on the Plan page.
import type { Account, FinanceData, IncomeSource, InstallmentPlan, RecurringBill } from "./types";

type Linked<T> = Omit<T, "id" | "account_id" | "active"> & { account?: string };

export interface SeedFile {
  /** `key` lets plans, bills and incomes point at an account. */
  accounts: (Omit<Account, "id" | "active" | "next_due_date"> & { key: string; next_due_date?: string | null })[];
  plans: Linked<InstallmentPlan>[];
  bills: Linked<RecurringBill>[];
  incomes: Linked<IncomeSource>[];
  profile?: string;
}

/** Read when needed (not at import) so tests can point it at a fixture. */
export const seedFilePath = () => process.env.SEED_FILE ?? "data/seed.json";

/** Same data as the database would hold after seeding, for tests. */
export function seedToFinanceData(seed: SeedFile): FinanceData {
  const ids = new Map(seed.accounts.map((a, i) => [a.key, i + 1]));
  const acc = (key?: string) => (key ? (ids.get(key) ?? null) : null);
  return {
    accounts: seed.accounts.map(({ key, ...a }) => ({
      ...a,
      next_due_date: a.next_due_date ?? null,
      id: ids.get(key)!,
      active: true,
    })),
    plans: seed.plans.map(({ account, ...p }, i) => ({ ...p, id: i + 1, account_id: acc(account), active: true })),
    bills: seed.bills.map(({ account, ...b }, i) => ({ ...b, id: i + 1, account_id: acc(account), active: true })),
    incomes: seed.incomes.map(({ account, ...x }, i) => ({ ...x, id: i + 1, account_id: acc(account), active: true })),
  };
}
