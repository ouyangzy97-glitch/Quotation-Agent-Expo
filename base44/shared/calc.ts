// 极小沙箱表达式求值器：只允许算术 + max/min/round/abs/floor/ceil + input.变量 + 已计算步骤引用。
// 用于执行 LLM 生成的测算程序（JSON 步骤列表），替代 eval/new Function。

const FUNCS = {
  max: Math.max,
  min: Math.min,
  round: (x, d) => Math.round(Number(x) * Math.pow(10, d || 0)) / Math.pow(10, d || 0),
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
  pow: Math.pow,
};

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c >= '0' && c <= '9' || c === '.') {
      let j = i;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      tokens.push(src.slice(i, j)); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push(src.slice(i, j)); i = j; continue;
    }
    if ('+-*/(),.'.includes(c)) { tokens.push(c); i++; continue; }
    throw new Error('表达式含有不允许的字符: "' + c + '"');
  }
  return tokens;
}

export function evalExpr(expr, scope) {
  const tokens = tokenize(String(expr));
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseCall(fn) {
    if (next() !== '(') throw new Error('函数调用缺少左括号: ' + expr);
    const args = [];
    if (peek() !== ')') {
      args.push(parseSum());
      while (peek() === ',') { next(); args.push(parseSum()); }
    }
    if (next() !== ')') throw new Error('函数调用缺少右括号: ' + expr);
    return fn(...args);
  }

  function parseFactor() {
    const t = peek();
    if (t === undefined) throw new Error('表达式不完整: ' + expr);
    if (t === '(') { next(); const v = parseSum(); if (next() !== ')') throw new Error('缺少右括号: ' + expr); return v; }
    if (t === '-') { next(); return -parseFactor(); }
    if (t === '+') { next(); return parseFactor(); }
    if (/^[0-9]/.test(t)) { next(); return Number(t); }
    if (/^[A-Za-z_]/.test(t)) {
      next();
      if (peek() === '.') {
        next();
        const sub = next();
        if (t === 'Math') {
          const fn = FUNCS[sub];
          if (!fn) throw new Error('不支持的函数: Math.' + sub);
          return parseCall(fn);
        }
        if (t === 'input') {
          const val = (scope.input || {})[sub];
          if (val === undefined || val === null) throw new Error('缺少输入变量: input.' + sub);
          return Number(val);
        }
        throw new Error('不支持的引用: ' + t + '.' + sub);
      }
      const fn = FUNCS[t];
      if (fn) return parseCall(fn);
      if (scope.steps && scope.steps[t] !== undefined) return Number(scope.steps[t]);
      const val = (scope.input || {})[t];
      if (val !== undefined && val !== null) return Number(val);
      throw new Error('未知变量或函数: ' + t);
    }
    throw new Error('无法解析的记号: ' + t);
  }

  function parseTerm() {
    let v = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const r = parseFactor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }

  function parseSum() {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  const v = parseSum();
  if (pos < tokens.length) throw new Error('表达式有多余内容: ' + expr);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('表达式结果不是有限数值: ' + expr);
  return v;
}

// 执行测算程序：[{name, expr}]，后面步骤可引用前面步骤名。
export function evalProgram(program, input) {
  const steps = {};
  const out = {};
  for (const step of program || []) {
    if (!step || !step.name || typeof step.expr !== 'string') throw new Error('测算程序格式错误');
    const v = evalExpr(step.expr, { input: input || {}, steps });
    if (!Number.isFinite(v)) throw new Error('步骤 ' + step.name + ' 结果不是数值');
    steps[step.name] = v;
    out[step.name] = Math.round(v * 1e6) / 1e6;
  }
  return out;
}

// 生成终端风格的执行输出行：name = value   ← expr
export function outputLines(program, output) {
  return (program || []).map((s) => {
    const val = output[s.name];
    const expr = String(s.expr).replace(/\s+/g, ' ');
    return s.name + ' = ' + val + '   <- ' + expr;
  });
}