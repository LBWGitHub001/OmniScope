const FUNCS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  sqrt: Math.sqrt,
};

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if ("+-*/^()".includes(ch)) {
      tokens.push({ kind: ch });
      i += 1;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch === "." && source[i + 1] >= "0" && source[i + 1] <= "9")) {
      let end = i + 1;
      while (end < source.length && ((source[end] >= "0" && source[end] <= "9") || source[end] === ".")) end += 1;
      const value = Number(source.slice(i, end));
      if (!Number.isFinite(value)) throw new Error("数字无效");
      tokens.push({ kind: "num", value });
      i = end;
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
      let end = i + 1;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end += 1;
      tokens.push({ kind: "id", value: source.slice(i, end) });
      i = end;
      continue;
    }
    throw new Error(`无法识别「${ch}」`);
  }
  return tokens;
}

function compileAst(tokens) {
  let index = 0;
  const peek = () => tokens[index];
  const startsValue = (token) => token && (token.kind === "num" || token.kind === "id" || token.kind === "(");

  function parseExpr() {
    let node = parseTerm();
    while (peek() && (peek().kind === "+" || peek().kind === "-")) {
      const op = tokens[index].kind;
      index += 1;
      node = { op, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm() {
    let node = parsePower();
    while (peek()) {
      if (peek().kind === "*" || peek().kind === "/") {
        const op = tokens[index].kind;
        index += 1;
        node = { op, left: node, right: parsePower() };
        continue;
      }
      if (startsValue(peek())) {
        node = { op: "*", left: node, right: parsePower() };
        continue;
      }
      break;
    }
    return node;
  }

  function parsePower() {
    let node = parseUnary();
    if (peek()?.kind === "^") {
      index += 1;
      node = { op: "^", left: node, right: parseUnary() };
    }
    return node;
  }

  function parseUnary() {
    if (peek()?.kind === "-") {
      index += 1;
      return { op: "neg", right: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary() {
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
        if (peek()?.kind !== ")") throw new Error("缺少 )");
        index += 1;
        return { op: "call", name: token.value, arg };
      }
      if (token.value !== "x") throw new Error("只认识变量 x");
      return { op: "x" };
    }
    if (token.kind === "(") {
      index += 1;
      const inner = parseExpr();
      if (peek()?.kind !== ")") throw new Error("缺少 )");
      index += 1;
      return inner;
    }
    throw new Error("无法解析");
  }

  const ast = parseExpr();
  if (index < tokens.length) throw new Error("表达式有多余内容");
  return ast;
}

function evaluate(node, x) {
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
    case "/":
      return evaluate(node.left, x) / evaluate(node.right, x);
    case "^":
      return evaluate(node.left, x) ** evaluate(node.right, x);
    case "call":
      return FUNCS[node.name](evaluate(node.arg, x));
    default:
      throw new Error("表达式无效");
  }
}

export function compileExpr(source) {
  const text = source.trim();
  if (!text) throw new Error("表达式为空");
  const ast = compileAst(tokenize(text));
  return (x) => evaluate(ast, x);
}
