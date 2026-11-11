import fs from 'node:fs';
import { FILES, readJson, writeJsonAtomic } from './paths.mjs';

const MAX_REQUESTS = 1500;

const PRICES = {
  'deepseek-chat': { in: 0.27, out: 1.1, cached: 0.07 },
  'deepseek-reasoner': { in: 0.55, out: 2.19, cached: 0.14 },
  'deepseek-flash': { in: 0.27, out: 1.1, cached: 0.07 },
  'claude-sonnet-4': { in: 3, out: 15, cached: 0.3 },
  'claude-opus-4': { in: 15, out: 75, cached: 1.5 },
  'gpt-4.1': { in: 2, out: 8, cached: 0.5 },
  'gpt-5': { in: 1.25, out: 10, cached: 0.125 },
  'gemini-2.5-pro': { in: 1.25, out: 10, cached: 0.31 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5, cached: 0.075 },
};
function priceOf(model) {
  const m = String(model || '').toLowerCase();
  const hit = Object.keys(PRICES).find((k) => m.includes(k));
  return hit ? PRICES[hit] : { in: 1, out: 3, cached: 0.2 };
}
function costOf(r) {
  const p = priceOf(r.model);
  const cached = Number(r.cached || 0);
  const input = Math.max(0, Number(r.input || 0) - cached);
  return (input * p.in + cached * p.cached + Number(r.output || 0) * p.out) / 1e6;
}



let cache = null;

function load() {
  if (cache) return cache;
  const exists = fs.existsSync(FILES.stats);
  const raw = readJson(FILES.stats, null);
  if (!raw || typeof raw !== 'object') {
    if (exists) {
      try { fs.renameSync(FILES.stats, `${FILES.stats}.corrupt-${Date.now()}`); } catch {}
    }
    cache = { requests: [], version: 1 };
    return cache;
  }
  cache = raw;
  if (!Array.isArray(cache.requests)) cache.requests = [];
  return cache;
}

function save() {
  if (cache) writeJsonAtomic(FILES.stats, cache);
}

export function record(entry) {
  const db = load();
  const row = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    ts: new Date().toISOString(),
    ...entry,
  };
  db.requests.push(row);
  if (db.requests.length > MAX_REQUESTS) db.requests.splice(0, db.requests.length - MAX_REQUESTS);
  save();
  return row;
}

export function dayKey(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function summary(days = 7, range = null, extraRows = []) {
  const db = load();
  const requestedDays = Number(days);
  days = Number.isFinite(requestedDays) && requestedDays > 0 ? Math.min(366, requestedDays) : 7;
  const now = Date.now();
  let startMs = now - days * 86400000;
  let endMs = now;
  let mode = 'day';
  if (range && Number.isFinite(Number(range.start)) && Number.isFinite(Number(range.end))) {
    startMs = Number(range.start);
    endMs = Number(range.end);
    if (endMs < startMs) [startMs, endMs] = [endMs, startMs];
    mode = endMs - startMs <= 2 * 86400000 ? 'hour' : 'day';
  }

  const all = db.requests.concat(Array.isArray(extraRows) ? extraRows : []);
  const rows = all
    .filter((r) => {
      const t = new Date(r.ts).getTime();
      if (!Number.isFinite(t)) return false;
      return t >= startMs && t <= endMs;
    })
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const totals = { requests: 0, input: 0, output: 0, cached: 0, errors: 0, cost: 0 };
  const byDay = {};
  const byProvider = {};
  const byModel = {};

  if (mode === 'hour') {
    const cursor = new Date(startMs);
    cursor.setMinutes(0, 0, 0);
    while (cursor.getTime() <= endMs) {
      const k = `${dayKey(cursor.toISOString())} ${String(cursor.getHours()).padStart(2, '0')}:00`;
      byDay[k] = { requests: 0, input: 0, output: 0 };
      cursor.setHours(cursor.getHours() + 1);
    }
  } else {
    const cursor = new Date(startMs);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= endMs) {
      byDay[dayKey(cursor.toISOString())] = { requests: 0, input: 0, output: 0 };
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  for (const r of rows) {
    totals.requests += 1;
    totals.input += Number(r.input || 0);
    totals.output += Number(r.output || 0);
    if (r.status && r.status >= 400) totals.errors += 1;
    totals.cached += Number(r.cached || 0);
    totals.cost += costOf(r);

    const d = new Date(r.ts);
    const key = mode === 'hour'
      ? `${dayKey(r.ts)} ${String(d.getHours()).padStart(2, '0')}:00`
      : dayKey(r.ts);
    if (!byDay[key]) byDay[key] = { requests: 0, input: 0, output: 0 };
    byDay[key].requests += 1;
    byDay[key].input += Number(r.input || 0);
    byDay[key].output += Number(r.output || 0);
    byDay[key].cached = (byDay[key].cached || 0) + Number(r.cached || 0);
    byDay[key].cost = (byDay[key].cost || 0) + costOf(r);

    const p = (byProvider[r.providerName || (r.source === 'session' ? '会话日志' : '')] ||= { requests: 0, input: 0, output: 0, errors: 0 });
    p.requests += 1;
    p.input += Number(r.input || 0);
    p.output += Number(r.output || 0);
    if (r.status && r.status >= 400) p.errors += 1;

    if (r.model) {
      const m = (byModel[r.model] ||= { requests: 0, input: 0, output: 0 });
      m.requests += 1;
      m.input += Number(r.input || 0);
      m.output += Number(r.output || 0);
    }
  }

  return {
    days,
    sources: {
      gateway: rows.filter((r) => r.source !== 'session').length,
      session: rows.filter((r) => r.source === 'session').length,
    },
    mode,
    totals,
    cacheRate: totals.input ? Math.round((totals.cached / totals.input) * 1000) / 10 : 0,
    byDay: Object.entries(byDay).map(([date, v]) => ({ date, ...v })),
    byProvider: Object.entries(byProvider)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.requests - a.requests),
    byModel: Object.entries(byModel)
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 10),
    recent: rows.slice(-500).reverse().map((r) => ({ ...r, cost: costOf(r) })),
    recentTotal: rows.length,
  };
}

export function allRequests() {
  return load().requests.slice().reverse();
}

export function clear() {
  cache = { requests: [], version: 1 };
  save();
}
