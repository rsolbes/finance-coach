import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  endOfMonth,
  formatISO,
  formatMonthLabel,
  formatShortDate,
  isISODate,
  monthKey,
  parseISO,
  startOfMonth,
  todayISO,
  withDayOfMonth,
} from "./dates";

describe("dates utility functions", () => {
  it("formats and parses ISO dates consistently", () => {
    const d = parseISO("2026-10-15");
    expect(formatISO(d)).toBe("2026-10-15");
    expect(isISODate("2026-10-15")).toBe(true);
    expect(isISODate("invalid")).toBe(false);
    expect(isISODate("2026-02-30")).toBe(false);
  });

  it("adds and subtracts days accurately", () => {
    expect(addDays("2026-10-01", 5)).toBe("2026-10-06");
    expect(addDays("2026-10-01", -2)).toBe("2026-09-29");
    expect(diffDays("2026-10-01", "2026-10-10")).toBe(9);
    expect(diffDays("2026-10-10", "2026-10-01")).toBe(-9);
  });

  it("handles days in month including leap years", () => {
    expect(daysInMonth(2024, 1)).toBe(29); // 2024 is a leap year (Feb = month 1)
    expect(daysInMonth(2025, 1)).toBe(28); // 2025 is not a leap year
    expect(daysInMonth(2026, 0)).toBe(31); // Jan
    expect(daysInMonth(2026, 3)).toBe(30); // Apr
  });

  it("adds months clamping to month length", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28"); // non-leap year Feb clamps to 28
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // leap year Feb clamps to 29
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30"); // Apr clamps to 30
    expect(addMonths("2026-10-15", 3)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("works with day of month, start of month, and end of month", () => {
    expect(withDayOfMonth("2026-10-05", 20)).toBe("2026-10-20");
    expect(withDayOfMonth("2026-02-10", 31)).toBe("2026-02-28"); // clamped
    expect(startOfMonth("2026-10-25")).toBe("2026-10-01");
    expect(endOfMonth("2026-10-05")).toBe("2026-10-31");
    expect(endOfMonth("2026-04-12")).toBe("2026-04-30");
    expect(monthKey("2026-10-15")).toBe("2026-10");
  });

  it("formats short dates and month labels", () => {
    expect(formatMonthLabel("2026-10")).toBe("Oct 2026");
    expect(formatShortDate("2026-10-15")).toBe("Thu, Oct 15");
  });

  it("computes todayISO in Mexico City time", () => {
    // 2026-10-02 at 01:00 UTC is 2026-10-01 at 19:00 in Mexico City (UTC-6)
    const lateUtc = new Date("2026-10-02T01:00:00Z");
    expect(todayISO(lateUtc)).toBe("2026-10-01");
  });
});
