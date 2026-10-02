// What the Spending page forms send to the server. Kept here (not in actions.ts) so they can be tested.
import { z } from "zod";
import { MONEY_IN_CATEGORIES } from "./money-in";
import { CATEGORIES } from "./types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ImportPayload = z.object({
  accountId: z.number().int().positive().nullable(),
  rows: z
    .array(
      z.object({
        date: isoDate,
        description: z.string().min(1).max(300),
        amount: z.number().finite(),
        category: z.enum(CATEGORIES),
        note: z.string().max(500),
      }),
    )
    .max(2000),
  newBalance: z.number().finite().nullable(),
});

export const PaymentPayload = z.object({
  date: isoDate,
  amount: z.number().positive().finite(),
  description: z.string().max(300),
  target: z
    .string()
    .regex(/^(card|plan):\d+$/)
    .nullable(),
  from_account_id: z.number().int().positive().nullable(),
  deduct_from_account: z.boolean(),
  reduce_card_balance: z.boolean(),
  covers_statement: z.boolean(),
  force: z.boolean().optional(),
});

export const MoneyInPayload = z.object({
  date: isoDate,
  amount: z.number().positive().finite(),
  account_id: z.number().int().positive(),
  description: z.string().max(300),
  category: z.enum(MONEY_IN_CATEGORIES),
  add_to_balance: z.boolean(),
  force: z.boolean().optional(),
});
