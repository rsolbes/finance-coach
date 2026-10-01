import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.COACH_MODEL ?? "claude-opus-5-5";

/** Server-side fallback: if a request is declined by a safety classifier, the API retries it on a fallback model. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | undefined;

/** Created on first use so the app can start (and show setup help) before a key is configured. */
export function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError)
    return "The Claude API key is missing or invalid. Put ANTHROPIC_API_KEY in .env.local and restart the app.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use this model.";
  if (err instanceof Anthropic.RateLimitError) return "Too many requests right now. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `The request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error (${err.status}): ${err.message}`;
  if (err instanceof Error && /api key|apiKey|ANTHROPIC/i.test(err.message))
    return "The Claude API key is missing. Put ANTHROPIC_API_KEY in .env.local and restart the app.";
  return err instanceof Error ? err.message : String(err);
}
