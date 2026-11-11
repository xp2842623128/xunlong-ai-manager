/**
 * 配置文件的轻量只读解析器。
 *
 * 这里不追求完整实现 JSON5 / YAML / TOML 规范，只解析本工具需要读取的
 * provider、model、base_url 等字段。好处是不引入第三方运行时依赖，
 * 且遇到不认识的字段时保持原样、不会改写应用配置。
 */

/* ---------------- JSON5（OpenClaw 使用） ---------------- */

export function parseJson5(input) {
  const s = String(input || '').replace(/^\uFEFF/, '');
  const n = s.length;
  let i = 0;

  const fail = (msg) => {
    throw new Error(`${msg}（位置 ${i}）`);
  };

  function skip() {
    for (;;) {
      while (i < n && /\s/.test(s[i])) i += 1;
      if (s[i] === '/' && s[i + 1] === '/') {
        i += 2;
        while (i < n && s[i] !== '\n') i += 1;
        continue;
      }
      if (s[i] === '/' && s[i + 1] === '*') {
        i += 2;
        while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i += 1;
        if (i >= n) fail('块注释未闭合');
        i += 2;
        continue;
      }
      break;
    }
  }

  function parseString() {
    const quote = s[i];
    i += 1;
    let out = '';
    while (i < n) {
      const ch = s[i];
      i += 1;
      if (ch === quote) return out;
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      if (i >= n) fail('转义字符未完成');
      const esc = s[i];
      i += 1;
      if (esc === 'u') {
        const hex = s.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('\\u 转义无效');
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else if (esc === 'x') {
        const hex = s.slice(i, i + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail('\\x 转义无效');
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
      } else if (esc === '\n') {
        // 行继续，不产生字符
      } else if (esc === '\r') {
        if (s[i] === '\n') i += 1;
      } else {
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
        out += Object.prototype.hasOwnProperty.call(map, esc) ? map[esc] : esc;
      }
    }
    fail('字符串未闭合');
  }

  function parseNumber() {
    const rest = s.slice(i);
    const m = rest.match(/^[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|Infinity|NaN)/);
    if (!m) fail('数字格式无效');
    i += m[0].length;
    if (/^[+-]?0[xX]/.test(m[0])) {
      const sign = m[0].startsWith('-') ? -1 : 1;
      return sign * parseInt(m[0].replace(/^[+-]?0[xX]/, ''), 16);
    }
    return Number(m[0]);
  }

  function parseArray() {
    i += 1;
    const out = [];
    for (;;) {
      skip();
      if (s[i] === ']') {
        i += 1;
        return out;
      }
      out.push(parseValue());
      skip();
      if (s[i] === ',') {
        i += 1;
        continue;
      }
      if (s[i] === ']') {
        i += 1;
        return out;
      }
      fail('数组缺少逗号或右方括号');
    }
  }

  function parseObject() {
    i += 1;
    const out = {};
    for (;;) {
      skip();
      if (s[i] === '}') {
        i += 1;
        return out;
      }
      let key = '';
      if (s[i] === '"' || s[i] === "'") {
        key = parseString();
      } else {
        const start = i;
        while (i < n && !/[:}\]\s]/.test(s[i])) i += 1;
        key = s.slice(start, i).trim();
        if (!key) fail('对象键名为空');
      }
      skip();
      if (s[i] !== ':') fail(`键 ${key} 后缺少冒号`);
      i += 1;
      out[key] = parseValue();
      skip();
      if (s[i] === ',') {
        i += 1;
        continue;
      }
      if (s[i] === '}') {
        i += 1;
        return out;
      }
      fail('对象缺少逗号或右花括号');
    }
  }

  function parseValue() {
    skip();
    const ch = s[i];
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"' || ch === "'") return parseString();
    if (ch === '-' || ch === '+' || ch === '.' || /[0-9]/.test(ch || '')) return parseNumber();
    if (s.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (s.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (s.startsWith('null', i)) {
      i += 4;
      return null;
    }
    if (s.startsWith('Infinity', i)) {
      i += 8;
      return Infinity;
    }
    if (s.startsWith('NaN', i)) {
      i += 3;
      return NaN;
    }
    fail('无法识别的值');
  }

  skip();
  const value = parseValue();
  skip();
  if (i < n) fail('根值之后仍有内容');
  return value;
}

/* ---------------- YAML 子集（Hermes / MiniMax 使用） ---------------- */

function stripYamlComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (quote === '"' && ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && line[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line.replace(/\s+$/, '');
}

function splitInline(text, sep = ',') {
  const out = [];
  let cur = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (quote === '"' && ch === '\\') {
        cur += text[i + 1] || '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function findOutside(text, needle) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    if (ch === needle && depth === 0) return i;
  }
  return -1;
}

function yamlScalar(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    return splitInline(text.slice(1, -1)).map(yamlScalar);
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    const out = {};
    for (const part of splitInline(text.slice(1, -1))) {
      const idx = findOutside(part, ':');
      if (idx < 0) continue;
      out[yamlScalar(part.slice(0, idx))] = yamlScalar(part.slice(idx + 1));
    }
    return out;
  }
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (/^(null|~)$/i.test(text)) return null;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number(text);
  return text;
}

export function parseYaml(input) {
  const lines = [];
  const rawLines = String(input || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const raw of rawLines) {
    if (!raw.trim() || /^\s*#/.test(raw) || /^\s*(---|\.\.\.)\s*$/.test(raw)) continue;
    if (/^\s*\t/.test(raw)) throw new Error('YAML 使用了 Tab 缩进，本工具暂不解析');
    const withoutComment = stripYamlComment(raw);
    if (!withoutComment.trim()) continue;
    const indent = withoutComment.match(/^ */)[0].length;
    lines.push({ indent, text: withoutComment.slice(indent).trimEnd() });
  }
  let idx = 0;

  function parseKeyValuePair(text) {
    const colon = findOutside(text, ':');
    if (colon < 0) throw new Error(`YAML 行缺少冒号：${text}`);
    const key = yamlScalar(text.slice(0, colon).trim());
    const value = text.slice(colon + 1).trim();
    return [String(key), value];
  }

  function parseMap(indent) {
    const out = {};
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < indent) break;
      if (line.indent > indent) throw new Error(`YAML 缩进异常：${line.text}`);
      if (/^-(\s|$)/.test(line.text)) break;
      idx += 1;
      const [key, value] = parseKeyValuePair(line.text);
      if (/^[|>][+-]?$/.test(value)) {
        while (idx < lines.length && lines[idx].indent > indent) idx += 1;
        out[key] = '';
        continue;
      }
      if (value) {
        out[key] = yamlScalar(value);
        continue;
      }
      const next = lines[idx];
      if (!next || next.indent < indent) {
        out[key] = null;
      } else if (next.indent === indent && /^-(\s|$)/.test(next.text)) {
        out[key] = parseSeq(indent);
      } else if (next.indent > indent) {
        out[key] = parseNode(next.indent);
      } else {
        out[key] = null;
      }
    }
    return out;
  }

  function parseSeq(indent) {
    const out = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent !== indent || !/^-(\s|$)/.test(line.text)) break;
      idx += 1;
      const rest = line.text.replace(/^-\s?/, '').trim();
      if (!rest) {
        const next = lines[idx];
        out.push(next && next.indent > indent ? parseNode(next.indent) : null);
        continue;
      }
      const colon = findOutside(rest, ':');
      const isMapItem = colon >= 0 && (colon === rest.length - 1 || /\s/.test(rest[colon + 1]));
      if (!isMapItem) {
        out.push(yamlScalar(rest));
        continue;
      }
      const item = {};
      const [key, value] = parseKeyValuePair(rest);
      if (value) item[key] = yamlScalar(value);
      else {
        const next = lines[idx];
        item[key] = next && next.indent > indent ? parseNode(next.indent) : null;
      }
      while (idx < lines.length && lines[idx].indent > indent) {
        const before = idx;
        const childIndent = lines[idx].indent;
        const child = parseMap(childIndent);
        Object.assign(item, child);
        if (idx === before) throw new Error(`YAML 列表项缩进异常：${lines[idx].text}`);
      }
      out.push(item);
    }
    return out;
  }

  function parseNode(indent) {
    if (idx >= lines.length) return null;
    return /^-(\s|$)/.test(lines[idx].text) ? parseSeq(indent) : parseMap(indent);
  }

  if (!lines.length) return {};
  const root = parseNode(lines[0].indent);
  if (idx < lines.length) throw new Error(`YAML 未解析完：${lines[idx].text}`);
  return root;
}

/* ---------------- TOML 读取（Kimi Code 使用） ---------------- */

function stripTomlComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (quote === '"' && ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return line.slice(0, i).replace(/\s+$/, '');
  }
  return line.replace(/\s+$/, '');
}

function unquoteTomlKey(raw) {
  const text = String(raw || '').trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  return text;
}

function splitTomlPath(header) {
  const parts = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < header.length; i += 1) {
    const ch = header[i];
    if (quote) {
      cur += ch;
      if (quote === '"' && ch === '\\') {
        cur += header[i + 1] || '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '.') {
      parts.push(unquoteTomlKey(cur));
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(unquoteTomlKey(cur));
  return parts;
}

function tomlScalar(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  if (text.startsWith('[') && text.endsWith(']')) {
    return splitInline(text.slice(1, -1)).map(tomlScalar);
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^[+-]?\d+$/.test(text)) return Number(text);
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number(text);
  return text;
}

export function parseTomlHeaderPath(header) {
  return splitTomlPath(String(header || '').trim());
}

export function parseToml(input) {
  const top = {};
  const sections = [];
  let current = null;
  let arrayDepth = 0;
  for (const raw of String(input || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim();
    if (!line) continue;
    if (arrayDepth === 0 && line.startsWith('[') && line.endsWith(']')) {
      const header = line.replace(/^\[\[?/, '').replace(/\]\]?$/, '').trim();
      current = { path: splitTomlPath(header), values: {} };
      sections.push(current);
      continue;
    }
    const eq = findOutside(line, '=');
    if (eq < 0) {
      arrayDepth += tomlArrayDelta(line);
      continue;
    }
    const key = unquoteTomlKey(line.slice(0, eq).trim());
    const value = tomlScalar(line.slice(eq + 1));
    if (current) current.values[key] = value;
    else top[key] = value;
    arrayDepth += tomlArrayDelta(line.slice(eq + 1));
    if (arrayDepth < 0) arrayDepth = 0;
  }
  return { top, sections };
}

function tomlArrayDelta(text) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
  }
  return depth;
}
