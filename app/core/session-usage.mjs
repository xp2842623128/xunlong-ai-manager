/**
 * 会话日志用量解析：从各 CLI 的本地会话文件里提取真实 token。
 * 只读，不改任何应用文件。
 */
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const MAX_FILE_BYTES = 32 * 1024 * 1024;
let cache = null;
let cachedAt = 0;

function walk(dir, out, depth = 6) {
  if (depth <= 0) return;
  let items = [];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walk(p, out, depth - 1);
    else if (it.name.toLowerCase().endsWith('.jsonl')) out.push(p);
  }
}

function readLines(file, cb) {
  let text = '';
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - MAX_FILE_BYTES);
    const length = stat.size - start;
    if (length <= 0) return;
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buf, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }
    text = buf.toString('utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    cb(obj);
  }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function claudeRecord(obj) {
  const u = obj?.message?.usage;
  if (!u) return null;
  const ts = obj.timestamp || obj.created_at || '';
  const model = obj.message?.model || '';
  return {
    ts,
    app: 'claude',
    model,
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cached: num(u.cache_read_input_tokens),
  };
}

function codexRecord(obj) {
  const p = obj?.payload;
  if (!p || (p.type !== 'token_count' && !p.info)) return null;
  const info = p.info || p;
  const u = info.last_token_usage || info.total_token_usage || info;
  if (!u) return null;
  return {
    ts: obj.timestamp || '',
    app: 'codex',
    model: info.model || obj.model || '',
    input: num(u.input_tokens ?? u.input),
    output: num(u.output_tokens ?? u.output),
    cached: num(u.cached_input_tokens ?? u.cached),
  };
}

export function scanSessionUsage({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < 60000) return cache;
  if (!HOME) {
    return { records: 0, rows: [], totals: { requests: 0, input: 0, output: 0, cached: 0 }, byModel: [], recent: [] };
  }
  const roots = [
    [path.join(HOME, '.claude', 'projects'), claudeRecord],
    [path.join(HOME, '.codex'), codexRecord],
  ];
  const records = [];
  for (const [root, parse] of roots) {
    const files = [];
    walk(root, files);
    for (const f of files) {
      let curModel = '';
      readLines(f, (obj) => {
        const payload = obj?.payload || obj;
        if (payload?.model) curModel = payload.model;
        if (obj?.model) curModel = obj.model;
        const r = parse(obj);
        if (r) {
          if (!r.model && curModel) r.model = curModel;
          if (r.input || r.output) records.push(r);
        }
      });
    }
  }
  const byModel = {};
  for (const r of records) {
    const k = `${r.app}|${r.model || 'unknown'}`;
    const m = (byModel[k] ||= { app: r.app, model: r.model || 'unknown', requests: 0, input: 0, output: 0, cached: 0 });
    m.requests += 1;
    m.input += r.input;
    m.output += r.output;
    m.cached += r.cached;
  }
  cache = {
    records: records.length,
    rows: records.slice(-2000),
    totals: {
      requests: records.length,
      input: records.reduce((a, r) => a + r.input, 0),
      output: records.reduce((a, r) => a + r.output, 0),
      cached: records.reduce((a, r) => a + r.cached, 0),
    },
    byModel: Object.values(byModel).sort((a, b) => b.input + b.output - (a.input + a.output)),
    recent: records.slice(-5),
  };
  cachedAt = Date.now();
  return cache;
}