import { describe, expect, it } from "vitest";
import { evaluate } from "./calc";

describe("evaluate (arithmetic evaluator)", () => {
  it("evaluates basic arithmetic operations", () => {
    expect(evaluate("2 + 3")).toBe(5);
    expect(evaluate("10 - 4")).toBe(6);
    expect(evaluate("6 * 7")).toBe(42);
    expect(evaluate("20 / 4")).toBe(5);
  });

  it("handles operator precedence and parentheses correctly", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("10 - 2 * 3 + 4")).toBe(8);
    expect(evaluate("10 / 2 * 5")).toBe(25);
    expect(evaluate("10 / (2 * 5)")).toBe(1);
  });

  it("evaluates power operations with right-associativity", () => {
    expect(evaluate("2 ^ 3")).toBe(8);
    expect(evaluate("2 ^ 3 ^ 2")).toBe(512); // 2 ^ (3 ^ 2) = 2 ^ 9
    expect(evaluate("(2 ^ 3) ^ 2")).toBe(64);
  });

  it("handles unary minus and plus", () => {
    expect(evaluate("-5 + 3")).toBe(-2);
    expect(evaluate("-(5 + 3)")).toBe(-8);
    expect(evaluate("+5 + 3")).toBe(8);
    expect(evaluate("5 * -2")).toBe(-10);
    expect(evaluate("2 ^ -1")).toBe(0.5);
  });

  it("handles decimal numbers, commas and scientific notation", () => {
    expect(evaluate("1.5 + 2.25")).toBe(3.75);
    expect(evaluate("1,000 + 500")).toBe(1500);
    expect(evaluate("1e3 + 200")).toBe(1200);
    expect(evaluate("1.5e2 / 10")).toBe(15);
  });

  it("throws on division by zero", () => {
    expect(() => evaluate("10 / 0")).toThrow(/Division by zero/);
  });

  it("throws on malformed syntax", () => {
    expect(() => evaluate("")).toThrow(/Empty expression/);
    expect(() => evaluate("   ")).toThrow(/Empty expression/);
    expect(() => evaluate("2 + * 3")).toThrow();
    expect(() => evaluate("(2 + 3")).toThrow(/Missing closing parenthesis/);
    expect(() => evaluate("2 + 3)")).toThrow(/Unexpected '\)'/);
    expect(() => evaluate("abc")).toThrow(/Unexpected/);
  });
});
