import type Anthropic from "@anthropic-ai/sdk";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
  txt: "text/plain",
};

/** Turns an uploaded PDF, image or CSV/text file into a content block Claude can read. */
export async function fileToContentBlock(
  file: File,
  opts: { allowText: boolean },
): Promise<{ block: Anthropic.Beta.BetaContentBlockParam } | { error: string }> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (max 20 MB)." };
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const type = file.type || EXTENSION_TYPES[ext] || "application/octet-stream";
  const bytes = Buffer.from(await file.arrayBuffer());

  if (type === "application/pdf")
    return {
      block: { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } },
    };
  if ((IMAGE_TYPES as readonly string[]).includes(type))
    return {
      block: { type: "image", source: { type: "base64", media_type: type as ImageType, data: bytes.toString("base64") } },
    };
  if (opts.allowText && (type.startsWith("text/") || ["csv", "txt", "tsv"].includes(ext)))
    return { block: { type: "text", text: `File "${file.name}":\n\n${bytes.toString("utf8")}` } };
  if (type === "image/heic" || type === "image/heif" || ext === "heic")
    return { error: "iPhone HEIC photos aren't supported. Take a screenshot of it instead, or export it as JPG." };
  return {
    error: opts.allowText
      ? "Unsupported file. Upload a PDF, a photo/screenshot (JPG or PNG), or a CSV export."
      : "Unsupported file. Upload a PDF or a photo/screenshot (JPG or PNG).",
  };
}
