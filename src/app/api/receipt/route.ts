import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anthropic, describeApiError, FALLBACK_BETA, MODEL } from "@/lib/claude";
import { todayISO } from "@/lib/dates";
import { paymentTargets } from "@/lib/payments";
import { ReceiptSchema } from "@/lib/receipt";
import { loadFinanceData } from "@/lib/repo";
import { requireAuth } from "@/lib/session";
import { fileToContentBlock } from "@/lib/uploads";

// Claude calls with tools or large files can take a while (Vercel default is shorter).
export const maxDuration = 300;

/** Reads a payment receipt (comprobante) and suggests which card or loan it pays. Nothing is saved here. */
export async function POST(request: Request) {
  try {
    await requireAuth();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  const converted = await fileToContentBlock(file, { allowText: false });
  if ("error" in converted) return Response.json({ error: converted.error }, { status: 400 });

  const today = todayISO();
  const data = await loadFinanceData();
  const targets = paymentTargets(data, today);
  const fromAccounts = data.accounts.filter((a) => a.active && (a.type === "debit" || a.type === "wallet"));
  const targetKeys = new Set(targets.map((t) => t.key));
  const fromKeys = new Set(fromAccounts.map((a) => `account:${a.id}`));

  const prompt = `This is a payment receipt or transfer confirmation (comprobante de pago, SPEI, pago de tarjeta, pago en app) from Mexico. Today is ${today}.

Extract the payment date (YYYY-MM-DD), the amount paid, who received it, the account it came from, and the reference (folio / clave de rastreo).

Then pick which of these the payment pays (suggested_target), or null if none fits:
${targets.map((t) => `- ${t.key}: ${t.label}${t.due_date ? `, next due ${t.due_date}` : ""}${t.due_amount ? ` (about ${t.due_amount})` : ""}`).join("\n")}

And which of these accounts it was paid from (suggested_from_account), or null if unclear:
${fromAccounts.map((a) => `- account:${a.id}: ${a.name} (${a.institution})`).join("\n")}

If the file is not a payment receipt, set is_payment_receipt to false.`;

  try {
    const msg = await anthropic()
      .beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 16000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          output_config: { effort: "low", format: betaZodOutputFormat(ReceiptSchema) },
          messages: [{ role: "user", content: [converted.block, { type: "text", text: prompt }] }],
        },
        { signal: request.signal },
      )
      .finalMessage();
    if (msg.stop_reason === "refusal") return Response.json({ error: "This file couldn't be processed." }, { status: 422 });
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = ReceiptSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return Response.json({ error: "Couldn't read the receipt." }, { status: 422 });
    const r = parsed.data;
    return Response.json({
      ...r,
      // Only keep suggestions that point at something real.
      suggested_target: r.suggested_target && targetKeys.has(r.suggested_target) ? r.suggested_target : null,
      suggested_from_account:
        r.suggested_from_account && fromKeys.has(r.suggested_from_account) ? r.suggested_from_account : null,
    });
  } catch (err) {
    return Response.json({ error: describeApiError(err) }, { status: 502 });
  }
}
