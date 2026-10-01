import { z } from "zod";
import { CATEGORIES } from "./types";

const date = z.string().describe("YYYY-MM-DD");
const money = z.number().nullable();

export const StatementSchema = z.object({
  summary: z.object({
    institution: z.string().nullable(),
    account_description: z.string().nullable().describe("e.g. 'Tarjeta de crédito terminación 1234'"),
    is_credit_card: z.boolean(),
    period_start: date.nullable(),
    period_end: date.nullable(),
    statement_date: date.nullable().describe("Fecha de corte"),
    payment_due_date: date.nullable().describe("Fecha límite de pago"),
    minimum_payment: money,
    payment_to_avoid_interest: money.describe("Pago para no generar intereses"),
    ending_balance: money,
  }),
  transactions: z.array(
    z.object({
      date,
      description: z.string(),
      amount: z.number(),
      category: z.enum(CATEGORIES),
      note: z.string(),
    }),
  ),
});

export type Statement = z.infer<typeof StatementSchema>;
