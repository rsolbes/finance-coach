import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anthropic, describeApiError, FALLBACK_BETA, MODEL } from "@/lib/claude";
import { StatementSchema } from "@/lib/statement";
import { requireAuth } from "@/lib/session";
import { fileToContentBlock } from "@/lib/uploads";
import { CATEGORIES } from "@/lib/types";

// Reading many screenshots can take a while.
export const maxDuration = 300;

const MAX_FILES = 30;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const MULTI_FILE_NOTE = `The files above are several pages or screenshots of the SAME account (e.g. scrolling through the movements in a banking app). Screenshots often overlap: when the same movement (same date, description and amount) appears in more than one file, list it only once. Two genuinely separate movements can look identical (e.g. two equal purchases on the same day); keep both only if they clearly appear as two separate rows in the same file. Fill the summary from whichever file shows it.`;

const PROMPT = `This is a bank or credit card statement (estado de cuenta) or a movements export from a Mexican bank or fintech.

Extract every transaction (movimiento). Rules:
- date: YYYY-MM-DD. If the statement shows dates without a year, infer the year from the statement period.
- amount: negative for money out (purchases, cargos, retiros, comisiones, intereses, IVA), positive for money in (abonos, depósitos, pagos received by a credit card, refunds).
- On a credit card statement, a payment you made to the card ("PAGO", "SU PAGO GRACIAS") is positive with category card_payment.
- On a debit account, money sent to pay one of your own credit cards or to your own accounts is negative with category card_payment or transfer.
- Monthly installment charges of MSI or meses con intereses plans: category installment_payment, and put the plan progress (e.g. "3 de 12") in note.
- Interest, commissions and their IVA: category fees_interest.
- Salary/nómina deposits: category income.
- Pick the closest category for everything else from: ${CATEGORIES.join(", ")}.
- description: the merchant or concept as written, cleaned of long reference numbers.
- Do not invent transactions. Skip summary lines and running totals.

Also fill the statement summary fields that appear in the document (use null when a field isn't there): institution, period, fecha de corte, fecha límite de pago, pago mínimo, pago para no generar intereses, and the balance (saldo) at the end of the period. For a credit card the balance is what is owed, as a positive number.`;

export async function POST(request: Request) {
  try {
    await requireAuth();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("file") ?? []).filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  if (files.length > MAX_FILES)
    return Response.json({ error: `Upload at most ${MAX_FILES} files at a time.` }, { status: 400 });
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES)
    return Response.json({ error: "Files are too large together (max 25 MB). Upload them in two batches." }, { status: 400 });

  // Label each file so Claude can tell the pages/screenshots apart.
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const [i, file] of files.entries()) {
    const converted = await fileToContentBlock(file, { allowText: true });
    if ("error" in converted) return Response.json({ error: `${file.name}: ${converted.error}` }, { status: 400 });
    if (files.length > 1) content.push({ type: "text", text: `File ${i + 1} of ${files.length}: ${file.name}` });
    content.push(converted.block);
  }
  content.push({ type: "text", text: files.length > 1 ? `${MULTI_FILE_NOTE}\n\n${PROMPT}` : PROMPT });

  try {
    const stream = anthropic().beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(StatementSchema) },
        messages: [{ role: "user", content }],
      },
      { signal: request.signal },
    );
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal")
      return Response.json({ error: "This file couldn't be processed." }, { status: 422 });
    if (msg.stop_reason === "max_tokens")
      return Response.json(
        { error: "The statement is too long to read in one go. Try uploading fewer pages." },
        { status: 422 },
      );
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const result = StatementSchema.safeParse(JSON.parse(text));
    if (!result.success) return Response.json({ error: "Couldn't read the statement format." }, { status: 422 });
    return Response.json(result.data);
  } catch (err) {
    return Response.json({ error: describeApiError(err) }, { status: 502 });
  }
}
