import fs from 'node:fs';
import path from 'node:path';
import { CLI, EXTRA_SESSION_ROOTS, HOME } from './paths.mjs';

const MAX_JSONL_READ = 4 * 1024 * 1024;
const SUMMARY_READ = 512 * 1024;

const NOISE_PREFIX = /^(#|<|The following is|You are|\[|\{|<environment_context>|<user_instructions>)/i;

function cleanTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || NOISE_PREFIX.test(t)) return '';
  return t.slice(0, 90);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c?.type === 'text' || c?.type === 'input_text' || c?.type === 'output_text') return c.text || '';
        if (c?.type === 'tool_use') return `[工具 ${c.name || ''}]`;
        if (c?.type === 'tool_result') return '[工具结果]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') return content.text || '';
  return '';
}

function sessionId(file) {
  return Buffer.from(file).toString('base64url');
}

function decodeId(id) {
  try {
    return Buffer.from(id, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isAllowedSessionFile(file) {
  let real = file;
  try {
    real = fs.realpathSync.native(file);
  } catch {
    return false;
  }
  if (!/\.(jsonl|json)$/i.test(real)) return false;
  if (/\.json$/i.test(real) && !/[\\/](chats|session)[\\/]/i.test(real)) return false;
  return ALLOWED_ROOTS.some((root) => isInside(path.resolve(root), real));
}

function walkFiles(root, { depth = 4, ext = null, limit = 500 } = {}) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [{ dir: root, d: 0 }];
  while (stack.length && out.length < limit) {
    const { dir, d } = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (d < depth) stack.push({ dir: full, d: d + 1 });
      } else if (e.isFile() && (!ext || e.name.endsWith(ext))) {
        out.push(full);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

function readJsonSafe(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readJsonl(file, maxBytes = MAX_JSONL_READ, fromEnd = false) {
  let fd = null;
  try {
    const size = fs.statSync(file).size;
    const start = fromEnd ? Math.max(0, size - maxBytes) : 0;
    const len = Math.min(size - start, maxBytes);
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    const rows = [];
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {}
    }
    return { rows, size, truncated: size > maxBytes };
  } catch {
    return { rows: [], size: 0, truncated: false };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function tailTimestamp(file) {
  const { rows } = readJsonl(file, 128 * 1024, true);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const ts = row?.timestamp || row?.ts || row?.payload?.timestamp;
    if (ts && Number.isFinite(new Date(ts).getTime())) return ts;
  }
  return null;
}

function summarizeClaude(file) {
  const { rows, size, truncated } = readJsonl(file, SUMMARY_READ);
  let title = '';
  let messages = 0;
  let lastTs = null;
  let tokens = 0;
  let cwd = '';
  for (const row of rows) {
    const ts = row.timestamp || row.ts;
    if (ts) lastTs = ts;
    if (row.cwd && !cwd) cwd = row.cwd;
    const msg = row.message || row;
    const role = msg?.role || row.type;
    if (role === 'user' || role === 'assistant') {
      messages += 1;
      const usage = msg?.usage || row.usage;
      if (usage) tokens += Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0);
      if (!title && role === 'user') {
        const t = cleanTitle(textOf(msg.content));
        if (t) title = t;
      }
    }
  }
  return {
    id: sessionId(file),
    path: file,
    app: 'claude',
    project: path.basename(path.dirname(file)),
    title: title || path.basename(file, '.jsonl'),
    messages,
    tokens,
    size,
    truncated,
    lastTs: (truncated ? tailTimestamp(file) : lastTs) || fs.statSync(file).mtime.toISOString(),
    cwd,
  };
}

/* ---------------- Codex CLI ---------------- */

function summarizeCodex(file) {
  const { rows, size, truncated } = readJsonl(file, SUMMARY_READ);
  let title = '';
  let messages = 0;
  let lastTs = null;
  let cwd = '';
  let tokens = 0;
  for (const row of rows) {
    const ts = row.timestamp || row.ts;
    if (ts) lastTs = ts;
    if (row.type === 'session_meta') {
      cwd = row.payload?.cwd || cwd;
      if (row.payload?.timestamp) lastTs = row.payload.timestamp;
      continue;
    }
    if (row.type === 'event_msg' && row.payload?.type === 'token_count') {
      const info = row.payload.info || row.payload;
      const usage = info.total_token_usage || info.last_token_usage || info;
      const sum = Number(usage.input_tokens || usage.input || 0) + Number(usage.output_tokens || usage.output || 0);
      if (Number.isFinite(sum)) tokens = Math.max(tokens, sum);
    }
    if (row.type === 'response_item' && row.payload?.role) {
      const role = row.payload.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = textOf(row.payload.content).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      messages += 1;
      if (!title && role === 'user') {
        const t = cleanTitle(text);
        if (t) title = t;
      }
    }
    if (row.type === 'event_msg' && row.payload?.type === 'user_message') {
      const text = cleanTitle(row.payload.message);
      if (!title && text) title = text;
    }
  }
  return {
    id: sessionId(file),
    path: file,
    app: 'codex',
    project: cwd ? path.basename(cwd) : path.basename(path.dirname(path.dirname(file))),
    title: title || path.basename(file, '.jsonl'),
    messages,
    tokens,
    size,
    truncated,
    lastTs: (truncated ? tailTimestamp(file) : lastTs) || fs.statSync(file).mtime.toISOString(),
    cwd,
  };
}

/* ---------------- Gemini CLI / Qwen Code（chats/*.json） ---------------- */

function chatMessages(data) {
  const list = Array.isArray(data?.messages) ? data.messages : Array.isArray(data) ? data : [];
  const out = [];
  for (const m of list) {
    const role = m.role || m.type;
    if (!['user', 'assistant', 'model', 'gemini'].includes(role)) continue;
    const text = textOf(m.content ?? m.parts ?? m.text);
    if (!text.trim()) continue;
    out.push({ role: role === 'model' || role === 'gemini' ? 'assistant' : role, text, ts: m.timestamp || null });
  }
  return out;
}

function summarizeChat(file, app) {
  const data = readJsonSafe(file);
  const msgs = chatMessages(data);
  const userMsgs = msgs.filter((m) => m.role === 'user');
  const title = cleanTitle(userMsgs[0]?.text) || path.basename(file, '.json');
  const lastTs =
    data?.lastUpdated || data?.lastUpdatedTime || msgs[msgs.length - 1]?.ts || fs.statSync(file).mtime.toISOString();
  return {
    id: sessionId(file),
    path: file,
    app,
    project: path.basename(path.dirname(path.dirname(file))) || 'default',
    title,
    messages: msgs.length,
    tokens: 0,
    size: fs.statSync(file).size,
    truncated: false,
    lastTs,
    cwd: data?.cwd || '',
  };
}

function listChatSessions(root, app) {
  const files = walkFiles(root, { depth: 5, ext: '.json', limit: 400 }).filter((f) =>
    /[\\/]chats[\\/][^\\/]+\.json$/i.test(f),
  );
  const out = [];
  for (const f of files) {
    try {
      out.push(summarizeChat(f, app));
    } catch {}
  }
  return out;
}

/* ---------------- OpenCode（storage/session + message + part） ---------------- */

function listOpencodeSessions(root) {
  if (!root || !fs.existsSync(root)) return [];
  const sessionDir = path.join(root, 'session');
  if (!fs.existsSync(sessionDir)) return [];
  const out = [];
  for (const projectDir of safeDirs(sessionDir)) {
    for (const file of safeFiles(projectDir, '.json')) {
      const meta = readJsonSafe(file);
      if (!meta) continue;
      const id = meta.id || path.basename(file, '.json');
      const messageDir = path.join(root, 'message', id);
      let messages = 0;
      let title = cleanTitle(meta.title) || '';
      let lastTs = meta.time?.updated || meta.time?.created || null;
      if (fs.existsSync(messageDir)) {
        const msgFiles = safeFiles(messageDir, '.json');
        messages = msgFiles.length;
        if (!title && msgFiles.length) {
          const first = readJsonSafe(msgFiles[0]);
          if (first?.role === 'user') {
            const partDir = path.join(root, 'part', first.id || '');
            let text = '';
            if (fs.existsSync(partDir)) {
              for (const partFile of safeFiles(partDir, '.json').slice(0, 20)) {
                const part = readJsonSafe(partFile);
                if (part?.type === 'text' && part.text) text += part.text;
              }
            }
            title = cleanTitle(text);
          }
        }
      }
      out.push({
        id: sessionId(file),
        path: file,
        app: 'opencode',
        project: meta.projectID || path.basename(projectDir) || 'default',
        title: title || id,
        messages,
        tokens: 0,
        size: fs.statSync(file).size,
        truncated: false,
        lastTs: lastTs && Number.isFinite(new Date(lastTs).getTime())
          ? new Date(lastTs).toISOString()
          : fs.statSync(file).mtime.toISOString(),
        cwd: meta.directory || '',
      });
    }
  }
  return out;
}

function safeDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function safeFiles(dir, ext) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(ext))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/* ---------------- 通用 JSONL（Kimi / Copilot / iFlow / Grok / Pi / OMP…） ---------------- */

function genericMessages(rows) {
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const role = row.role || row.type || row.message?.role;
    if (!['user', 'assistant', 'model', 'gemini'].includes(role)) continue;
    const text = textOf(row.content ?? row.message?.content ?? row.text ?? row.parts);
    if (!text.trim()) continue;
    out.push({ role: role === 'model' || role === 'gemini' ? 'assistant' : role, text, ts: row.timestamp || row.ts || null });
  }
  return out;
}

function summarizeGeneric(file, app) {
  const { rows, size, truncated } = readJsonl(file, SUMMARY_READ);
  const msgs = genericMessages(rows);
  const firstUser = msgs.find((m) => m.role === 'user');
  return {
    id: sessionId(file),
    path: file,
    app,
    project: path.basename(path.dirname(file)) || app,
    title: cleanTitle(firstUser?.text) || path.basename(file, '.jsonl'),
    messages: msgs.length,
    tokens: 0,
    size,
    truncated,
    lastTs: msgs[msgs.length - 1]?.ts || fs.statSync(file).mtime.toISOString(),
    cwd: '',
  };
}

function listGenericSessions(roots) {
  const out = [];
  for (const { app, dir } of roots) {
    if (!fs.existsSync(dir)) continue;
    const files = walkFiles(dir, { depth: 5, ext: '.jsonl', limit: 80 }).filter((f) => !f.endsWith('.zstd'));
    for (const f of files) {
      try {
        const s = summarizeGeneric(f, app);
        if (s.messages > 0) out.push(s);
      } catch {}
    }
  }
  return out;
}

/* ---------------- 汇总 ---------------- */

const ALLOWED_ROOTS = [
  ...Object.values(CLI).flatMap((a) => a.sessions || []),
  ...EXTRA_SESSION_ROOTS.map((r) => r.dir),
  path.join(HOME, '.local', 'share', 'opencode', 'storage'),
];

export function listSessions() {
  const out = [];
  for (const f of walkFiles(CLI.claude.sessions[0], { depth: 3, ext: '.jsonl', limit: 300 })) {
    try {
      out.push(summarizeClaude(f));
    } catch {}
  }
  for (const f of walkFiles(CLI.codex.sessions[0], { depth: 5, ext: '.jsonl', limit: 300 })) {
    try {
      out.push(summarizeCodex(f));
    } catch {}
  }
  out.push(...listChatSessions(CLI.gemini.sessions[0], 'gemini'));
  out.push(...listChatSessions(CLI.qwen.sessions[0], 'qwen'));
  out.push(...listOpencodeSessions(CLI.opencode.sessions[0]));
  out.push(
    ...listGenericSessions([
      ...EXTRA_SESSION_ROOTS.map((r) => ({ app: r.app, dir: r.dir })),
      { app: 'kimi', dir: CLI.kimi.sessions[0] },
      { app: 'grok', dir: CLI.grok.sessions[0] },
      { app: 'pi', dir: CLI.pi.sessions[0] },
      { app: 'omp', dir: CLI.omp.sessions[0] },
    ]),
  );
  return out.sort((a, b) => new Date(b.lastTs) - new Date(a.lastTs));
}

export function sessionDetail(id, limit = 200) {
  const file = decodeId(id);
  if (!file) throw new Error('无效的会话 ID');
  if (!isAllowedSessionFile(file)) throw new Error('会话路径不在允许范围内');
  if (!fs.existsSync(file)) throw new Error('会话文件不存在');

  if (file.endsWith('.json') && /[\\/]chats[\\/]/i.test(file)) {
    const msgs = chatMessages(readJsonSafe(file)).slice(0, limit);
    return { path: file, messages: msgs.map((m) => ({ role: m.role, text: m.text.slice(0, 8000), ts: m.ts })) };
  }

  if (file.endsWith('.json')) {
    const meta = readJsonSafe(file) || {};
    const id2 = path.basename(String(meta.id || path.basename(file, '.json')));
    const rootIdx = file.indexOf(path.sep + 'session' + path.sep);
    const storageRoot = rootIdx > 0 ? file.slice(0, rootIdx) : CLI.opencode.sessions[0];
    const messageDir = path.join(storageRoot, 'message', id2);
    if (!isInside(storageRoot, messageDir)) return { path: file, messages: [] };
    const messages = [];
    for (const msgFile of safeFiles(messageDir, '.json').slice(0, limit)) {
      const msg = readJsonSafe(msgFile) || {};
      const partDir = path.join(storageRoot, 'part', path.basename(String(msg.id || path.basename(msgFile, '.json'))));
      let text = '';
      if (fs.existsSync(partDir) && isInside(storageRoot, partDir)) {
        for (const partFile of safeFiles(partDir, '.json')) {
          const part = readJsonSafe(partFile);
          if (part?.type === 'text' && part.text) text += part.text;
        }
      }
      const created = msg.time?.created;
      const validCreated = created && Number.isFinite(new Date(created).getTime());
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        text: text.slice(0, 8000),
        ts: validCreated ? new Date(created).toISOString() : null,
      });
    }
    return { path: file, messages };
  }

  const { rows } = readJsonl(file, MAX_JSONL_READ, true);
  const messages = [];
  for (const row of rows.slice(-limit * 4)) {
    if (messages.length >= limit) break;
    if (row.type === 'user' || row.type === 'assistant') {
      const msg = row.message || row;
      messages.push({ role: msg.role || row.type, text: textOf(msg.content).slice(0, 8000), ts: row.timestamp || null });
      continue;
    }
    if (row.type === 'response_item' && row.payload?.role) {
      if (row.payload.role !== 'user' && row.payload.role !== 'assistant') continue;
      const text = textOf(row.payload.content);
      if (!text.trim()) continue;
      messages.push({ role: row.payload.role, text: text.slice(0, 8000), ts: row.timestamp || null });
      continue;
    }
    if (['user', 'assistant'].includes(row.role)) {
      messages.push({ role: row.role, text: textOf(row.content).slice(0, 8000), ts: row.timestamp || null });
    }
  }
  return { path: file, messages };
}
