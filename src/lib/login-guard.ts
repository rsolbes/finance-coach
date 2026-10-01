import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { query, run } from "./db";

// Slows down passcode guessing: after 5 wrong tries from one IP address that address is
// locked out for 15 minutes. IP headers can be faked, so 20 wrong tries from anywhere also
// pause all logins for 15 minutes. Stored in the database so it holds across serverless instances.
const LOCK_MINUTES = 15;
const LIMITS = { ip: 5, all: 20 };
const ALL = "*";

interface Attempts {
  failures: number;
  locked_until: number;
}

const key = (ip: string) => `login_attempts:${ip}`;

async function read(ip: string): Promise<Attempts> {
  const rows = await query("SELECT value FROM settings WHERE key = ?", [key(ip)]);
  if (!rows.length) return { failures: 0, locked_until: 0 };
  try {
    return JSON.parse(String(rows[0].value)) as Attempts;
  } catch {
    return { failures: 0, locked_until: 0 };
  }
}

async function write(ip: string, a: Attempts) {
  await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    key(ip),
    JSON.stringify(a),
  ]);
}

/** Minutes left on a lockout for this IP, or 0 if it may try. */
export async function lockedMinutes(ip: string, now = Date.now()): Promise<number> {
  const until = Math.max((await read(ip)).locked_until, (await read(ALL)).locked_until);
  return until > now ? Math.ceil((until - now) / 60_000) : 0;
}

async function bump(k: string, limit: number, now: number): Promise<number> {
  const failures = (await read(k)).failures + 1;
  if (failures >= limit) {
    await write(k, { failures: 0, locked_until: now + LOCK_MINUTES * 60_000 });
    return 0;
  }
  await write(k, { failures, locked_until: 0 });
  return limit - failures;
}

export async function recordFailure(ip: string, now = Date.now()): Promise<{ locked: boolean; triesLeft: number }> {
  const ipLeft = await bump(ip, LIMITS.ip, now);
  const allLeft = await bump(ALL, LIMITS.all, now);
  const triesLeft = Math.min(ipLeft, allLeft);
  return { locked: triesLeft === 0, triesLeft };
}

/** After a correct passcode: forget this IP's failures, and the global count unless it's locked. */
export async function clearFailures(ip: string) {
  await run("DELETE FROM settings WHERE key = ?", [key(ip)]);
  if ((await read(ALL)).locked_until === 0) await run("DELETE FROM settings WHERE key = ?", [key(ALL)]);
}

/** Constant-time comparison, so response timing doesn't reveal how much of the passcode matched. */
export function passcodeMatches(given: string, expected: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}

export function clientIp(headers: Headers): string {
  // Vercel sets these to the visitor's address; elsewhere they're best effort (see the global limit).
  const forwarded = headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for");
  return headers.get("x-real-ip") || forwarded?.split(",")[0]?.trim() || "local";
}
