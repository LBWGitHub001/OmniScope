/**
 * Safe Mathematical Expression Compiler for Real-Time Oscilloscope & Virtual Channels
 * Supports: +, -, *, /, ^, (), unary neg, implicit multiplication (e.g. 2x, 5sin(x))
 * Standard functions: sin, cos, tan, abs, sqrt, exp, log, round, floor, ceil
 * Constants: pi, e, deg (180/pi), rad (pi/180)
 */

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  sqrt: Math.sqrt,
  exp: Math.exp,
  log: Math.log,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  deg: 180 / Math.PI, // radian to degree multiplier (~57.29578)
  rad: Math.PI / 180, // degree to radian multiplier
};

type Token =
  | { kind: "+" | "-" | "*" | "/" | "^" | "(" | ")" }
  | { kind: "num"; value: number }
  | { kind: "id"; value: string };

type AstNode =
  | { op: "num"; value: number }
  | { op: "x" }
  | { op: "neg"; right: AstNode }
  | { op: "+" | "-" | "*" | "/" | "^"; left: AstNode; right: AstNode }
  | { op: "call"; name: string; arg: AstNode };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if ("+-*/^()".includes(ch)) {
      tokens.push({ kind: ch as any });
      i += 1;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch === "." && source[i + 1] >= "0" && source[i + 1] <= "9")) {
      let end = i + 1;
      while (end < source.length && ((source[end] >= "0" && source[end] <= "9") || source[end] === ".")) {
        end += 1;
      }
      const value = Number(source.slice(i, end));
      if (!Number.isFinite(value)) throw new Error("数字无效");
      tokens.push({ kind: "num", value });
      i = end;
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let end = i + 1;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) {
        end += 1;
      }
      tokens.push({ kind: "id", value: source.slice(i, end).toLowerCase() });
      i = end;
      continue;
    }
    throw new Error(`无法识别符号「${ch}」`);
  }
  return tokens;
}

function compileAst(tokens: Token[]): AstNode {
  let index = 0;
  const peek = (): Token | undefined => tokens[index];
  const startsValue = (token?: Token) =>
    token && (token.kind === "num" || token.kind === "id" || token.kind === "(");

  function parseExpr(): AstNode {
    let node = parseTerm();
    while (peek() && (peek()!.kind === "+" || peek()!.kind === "-")) {
      const op = tokens[index].kind as "+" | "-";
      index += 1;
      node = { op, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm(): AstNode {
    let node = parsePower();
    while (peek()) {
      if (peek()!.kind === "*" || peek()!.kind === "/") {
        const op = tokens[index].kind as "*" | "/";
        index += 1;
        node = { op, left: node, right: parsePower() };
        continue;
      }
      if (startsValue(peek())) {
        // implicit multiplication: 2x or (a)(b)
        node = { op: "*", left: node, right: parsePower() };
        continue;
      }
      break;
    }
    return node;
  }

  function parsePower(): AstNode {
    let node = parseUnary();
    if (peek()?.kind === "^") {
      index += 1;
      node = { op: "^", left: node, right: parseUnary() };
    }
    return node;
  }

  function parseUnary(): AstNode {
    if (peek()?.kind === "-") {
      index += 1;
      return { op: "neg", right: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): AstNode {
    const token = peek();
    if (!token) throw new Error("表达式不完整");
    if (token.kind === "num") {
      index += 1;
      return { op: "num", value: token.value };
    }
    if (token.kind === "id") {
      index += 1;
      if (peek()?.kind === "(") {
        if (!FUNCS[token.value]) throw new Error(`未知函数 ${token.value}`);
        index += 1;
        const arg = parseExpr();
        if (peek()?.kind !== ")") throw new Error("缺少匹配的 )");
        index += 1;
        return { op: "call", name: token.value, arg };
      }
      if (token.value === "x") return { op: "x" };
      if (CONSTANTS[token.value] !== undefined) {
        return { op: "num", value: CONSTANTS[token.value] };
      }
      throw new Error(`未知变量「${token.value}」，计算变量请使用 x`);
    }
    if (token.kind === "(") {
      index += 1;
      const inner = parseExpr();
      if (peek()?.kind !== ")") throw new Error("缺少匹配的 )");
      index += 1;
      return inner;
    }
    throw new Error("无法解析");
  }

  const ast = parseExpr();
  if (index < tokens.length) throw new Error("表达式有多余内容");
  return ast;
}

function evaluate(node: AstNode, x: number): number {
  switch (node.op) {
    case "num":
      return node.value;
    case "x":
      return x;
    case "neg":
      return -evaluate(node.right, x);
    case "+":
      return evaluate(node.left, x) + evaluate(node.right, x);
    case "-":
      return evaluate(node.left, x) - evaluate(node.right, x);
    case "*":
      return evaluate(node.left, x) * evaluate(node.right, x);
    case "/": {
      const denom = evaluate(node.right, x);
      if (Math.abs(denom) < 1e-15) return NaN;
      return evaluate(node.left, x) / denom;
    }
    case "^":
      return evaluate(node.left, x) ** evaluate(node.right, x);
    case "call":
      return FUNCS[node.name](evaluate(node.arg, x));
    default:
      throw new Error("表达式无效");
  }
}

export type ExprFn = (x: number) => number;

export function compileExpr(source: string): ExprFn {
  const text = source.trim();
  if (!text) throw new Error("表达式为空");
  const ast = compileAst(tokenize(text));
  return (x: number) => {
    if (!Number.isFinite(x)) return NaN;
    try {
      const res = evaluate(ast, x);
      return Number.isFinite(res) ? res : NaN;
    } catch {
      return NaN;
    }
  };
}
