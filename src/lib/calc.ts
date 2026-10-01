// Tiny arithmetic evaluator for the coach's `calculate` tool: numbers, + - * / ^,
// parentheses and unary minus. No eval(), no identifiers.

export function evaluate(expression: string): number {
  const src = expression.replace(/,/g, "").replace(/\s+/g, "");
  if (!src) throw new Error("Empty expression");
  if (src.length > 500) throw new Error("Expression too long");
  let pos = 0;

  const peek = () => src[pos];

  function number(): number {
    const match = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(src.slice(pos));
    if (!match) throw new Error(`Unexpected '${peek() ?? "end"}' at position ${pos}`);
    pos += match[0].length;
    return Number(match[0]);
  }

  function primary(): number {
    if (peek() === "(") {
      pos++;
      const v = additive();
      if (peek() !== ")") throw new Error("Missing closing parenthesis");
      pos++;
      return v;
    }
    if (peek() === "-") {
      pos++;
      return -primary();
    }
    if (peek() === "+") {
      pos++;
      return primary();
    }
    return number();
  }

  function power(): number {
    const base = primary();
    if (peek() === "^") {
      pos++;
      return base ** unary();
    }
    return base;
  }

  function unary(): number {
    if (peek() === "-") {
      pos++;
      return -unary();
    }
    return power();
  }

  function multiplicative(): number {
    let v = unary();
    while (peek() === "*" || peek() === "/") {
      const op = src[pos++];
      const rhs = unary();
      if (op === "/" && rhs === 0) throw new Error("Division by zero");
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  }

  function additive(): number {
    let v = multiplicative();
    while (peek() === "+" || peek() === "-") {
      const op = src[pos++];
      const rhs = multiplicative();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  const result = additive();
  if (pos !== src.length) throw new Error(`Unexpected '${peek()}' at position ${pos}`);
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
  return Math.round(result * 1e6) / 1e6;
}
