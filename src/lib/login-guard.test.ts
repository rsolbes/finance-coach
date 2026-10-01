import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_FILE = join(tmpdir(), `finance-coach-login-${process.pid}.db`).replaceAll("\\", "/");

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", `file:${DB_FILE}`);
  vi.stubEnv("SEED_FILE", join(tmpdir(), "does-not-exist.json"));
});

afterAll(async () => {
  const { db } = await import("./db");
  (await db()).close();
  try {
    rmSync(DB_FILE, { force: true });
  } catch {
    // Windows may keep the file locked briefly; it lives in the temp folder anyway.
  }
});

describe("login lockout", () => {
  it("locks an IP after 5 wrong tries, for 15 minutes", async () => {
    const g = await import("./login-guard");
    const now = 1_000_000;
    for (let i = 4; i >= 1; i--) expect(await g.recordFailure("1.1.1.1", now)).toEqual({ locked: false, triesLeft: i });
    expect((await g.recordFailure("1.1.1.1", now)).locked).toBe(true);
    expect(await g.lockedMinutes("1.1.1.1", now)).toBe(15);
    expect(await g.lockedMinutes("1.1.1.1", now + 15 * 60_000 + 1)).toBe(0);
    expect(await g.lockedMinutes("2.2.2.2", now)).toBe(0); // other visitors unaffected
  });

  it("pauses everyone after 20 wrong tries from rotating IPs", async () => {
    const g = await import("./login-guard");
    const now = 5_000_000;
    // 5 already counted globally by the previous test; 15 more from different "IPs"
    for (let i = 0; i < 15; i++) await g.recordFailure(`10.0.0.${i}`, now);
    expect(await g.lockedMinutes("9.9.9.9", now)).toBe(15);
  });

  it("compares passcodes exactly", async () => {
    const g = await import("./login-guard");
    expect(g.passcodeMatches("correct horse", "correct horse")).toBe(true);
    expect(g.passcodeMatches("correct hors", "correct horse")).toBe(false);
  });
});
