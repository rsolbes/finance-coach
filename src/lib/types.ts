export const ACCOUNT_TYPES = ["debit", "credit", "wallet", "voucher"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const PLAN_KINDS = ["msi", "with_interest", "loan", "device"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const INCOME_FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;
export type IncomeFrequency = (typeof INCOME_FREQUENCIES)[number];

export const GOAL_KINDS = ["save", "pay_off", "spending_limit", "habit"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_STATUSES = ["active", "done", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const CATEGORIES = [
  "groceries",
  "food_delivery",
  "restaurants",
  "transport",
  "gas",
  "housing",
  "utilities",
  "phone_internet",
  "subscriptions",
  "health",
  "personal_care",
  "clothing",
  "entertainment",
  "shopping",
  "education",
  "gifts",
  "fees_interest",
  "installment_payment",
  "installment_purchase",
  "card_payment",
  "transfer",
  "cash_withdrawal",
  "income",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Excluded from spending totals: movements between your own accounts, and purchases made "a meses"
 * (their cost is counted month by month through the installment plan instead).
 */
export const NON_SPENDING_CATEGORIES: readonly Category[] = ["card_payment", "transfer", "income", "installment_purchase"];

export interface Account {
  id: number;
  name: string;
  institution: string;
  type: AccountType;
  /** Debit/wallet/voucher: money available. Credit: amount owed (positive). */
  balance: number;
  credit_limit: number | null;
  /** Fecha de corte (day of month). Credit cards only. */
  statement_day: number | null;
  /** Days between fecha de corte and fecha límite de pago. */
  payment_due_days: number | null;
  /** Known date of the next payment (fecha límite). Overrides the one computed from fecha de corte until it passes. */
  next_due_date: string | null;
  notes: string;
  active: boolean;
}

export interface InstallmentPlan {
  id: number;
  name: string;
  /** Card the installments are charged to (affects that card's revolving balance), or the account it is paid from. */
  account_id: number | null;
  kind: PlanKind;
  original_amount: number;
  /** Full amount of each payment, including interest and IVA. */
  payment_amount: number;
  /** Capital part of each payment, when the plan charges interest. */
  capital_per_payment: number | null;
  total_payments: number;
  /** Payments already made as of next_payment_date. */
  payments_made: number;
  /** Due date of the next unpaid payment. Later payments are one month apart. */
  next_payment_date: string;
  notes: string;
  active: boolean;
}

export interface RecurringBill {
  id: number;
  name: string;
  amount: number;
  day_of_month: number;
  account_id: number | null;
  category: Category;
  is_estimate: boolean;
  notes: string;
  active: boolean;
}

export interface IncomeSource {
  id: number;
  name: string;
  amount: number;
  frequency: IncomeFrequency;
  /** Any real pay date; other pay dates are computed from it. */
  anchor_date: string;
  account_id: number | null;
  /** e.g. "food" for despensa vouchers that can only be spent on groceries. */
  restricted_to: string | null;
  notes: string;
  active: boolean;
}

export interface Transaction {
  id: number;
  account_id: number | null;
  date: string;
  description: string;
  /** Negative = money out, positive = money in. */
  amount: number;
  category: Category;
  notes: string;
  source: string;
  created_at: string;
}

export interface Goal {
  id: number;
  title: string;
  kind: GoalKind;
  target_amount: number | null;
  current_amount: number | null;
  category: Category | null;
  target_date: string | null;
  status: GoalStatus;
  notes: string;
  created_at: string;
}

export interface CoachMemory {
  id: number;
  content: string;
  created_at: string;
}

export interface FinanceData {
  accounts: Account[];
  plans: InstallmentPlan[];
  bills: RecurringBill[];
  incomes: IncomeSource[];
}
