import { z } from "zod";

export const ReceiptSchema = z.object({
  is_payment_receipt: z.boolean().describe("False if the file isn't proof of a payment or transfer"),
  date: z.string().nullable().describe("YYYY-MM-DD"),
  amount: z.number().nullable().describe("Amount paid, positive"),
  paid_to: z.string().nullable().describe("Who received the payment, as written (bank, card, merchant, person)"),
  paid_from: z.string().nullable().describe("Account or card the money came from, as written"),
  reference: z.string().nullable().describe("Folio, clave de rastreo or reference number"),
  suggested_target: z.string().nullable().describe("Key of the option this payment pays, or null if none fits"),
  suggested_from_account: z.string().nullable().describe("Key of the account it was paid from, or null"),
});

export type Receipt = z.infer<typeof ReceiptSchema>;
