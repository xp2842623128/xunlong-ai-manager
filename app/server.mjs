import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, FILES, APP_NAME, CLI, ensureDirs, timestamp, HOME } from './core/paths.mjs';
import {
  getState,
  saveState,
  mutate,
  reloadState,
  listProviders,
  publicProvider,
  newProvider,
  findProvider,
  uidFor,
} from './core/store.mjs';
import { PRESETS, findPreset, presetToProvider } from './core/presets.mjs';
import { applyProvider, detectApps, readCurrent, readActiveProvider, testProvider, fetchModels } from './core/adapters.mjs';
import { queryBalance } from './core/balance.mjs';
import { gateway } from './core/gateway.mjs';
import { summary, clear as clearUsage } from './core/usage.mjs';
import { scanSessionUsage } from './core/session-usage.mjs';
import { listMcp, upsertMcp, removeMcp, applyMcp, mcpTemplates, importMcpFromApps, checkMcp } from './core/mcp.mjs';
import { listPrompts, upsertPrompt, removePrompt, setPromptCategory } from './core/prompts.mjs';
import {
  listSkills,
  listInstalledSkills,
  listAvailableSkills,
  importSkills,
  skillTargets,
  setSkillApps,
  setSkillCategory,
  syncSkills,
  removeSkill,
  installSkillFromDir,
} from './core/skills.mjs';
import { listSessions, sessionDetail } from './core/sessions.mjs';
import { createBackup, listBackups, restoreBackup, deleteBackup, clearBackups } from './core/backup.mjs';
import { scanAll, clearScanCache } from './core/scanner.mjs';
import { mirrorStatus, applyMirror, restoreMirror, testMirrors } from './core/mirrors.mjs';
import { CATALOG } from './core/marketplace.mjs';
import { CATEGORIES, resolveCategory } from './core/classify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');
const VERSION = '1.1.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};


function setAutostart(enabled) {
  try {
    const startup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    if (!startup || !fs.existsSync(startup)) return;
    const file = path.join(startup, '迅龙AI管家.cmd');
    if (enabled) {
      const exe = process.env.XUNLONG_EXE || process.execPath;
      fs.writeFileSync(file, `@echo off\r\nstart "" "${exe}"\r\n`, 'utf8');
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {}
}

function importCcSwitch() {
  const file = path.join(HOME, '.cc-switch', 'config.json');
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error('未找到 ~/.cc-switch/config.json（本机未安装 CC-Switch）'), { status: 400 });
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    throw Object.assign(new Error(`CC-Switch 配置解析失败：${err.message}`), { status: 400 });
  }
  const items = [];
  const push = (app, p) => {
    if (!p || typeof p !== 'object') return;
    const env = p.settingsConfig?.env || p.env || {};
    const baseUrl = p.baseUrl || p.base_url || p.url || env.ANTHROPIC_BASE_URL || '';
    const apiKey = p.apiKey || p.api_key || env.ANTHROPIC_AUTH_TOKEN || env.OPENAI_API_KEY || '';
    const model = p.model || env.ANTHROPIC_MODEL || '';
    if (!baseUrl) return;
    items.push({ app: CLI[app] ? app : 'claude', name: p.name || p.id || 'CC-Switch 导入', baseUrl, apiKey, model, protocol: CLI[app]?.protocol || 'anthropic' });
  };
  const providers = data.providers || data;
  if (Array.isArray(providers)) providers.forEach((p) => push(p.app || 'claude', p));
  else if (providers && typeof providers === 'object') {
    for (const [app, list] of Object.entries(providers)) {
      if (Array.isArray(list)) list.forEach((p) => push(app, p));
      else push(app, list);
    }
  }
  let imported = 0;
  let skipped = 0;
  mutate((state) => {
    for (const item of items) {
      const base = item.baseUrl.replace(/\/+$/, '');
      if (state.providers.some((p) => p.app === item.app && (p.baseUrl || '').replace(/\/+$/, '') === base)) {
        skipped += 1;
        continue;
      }
      state.providers.push(
        newProvider({
          app: item.app,
          name: item.name,
          protocol: item.protocol,
          baseUrl: base,
          apiKey: item.apiKey,
          model: item.model,
          note: '从 CC-Switch 导入',
        }),
      );
      imported += 1;
    }
  });
  return { ok: true, imported, skipped, total: items.length };
}

const DSH_PROFILE = path.join(HOME, '.dsh', 'profiles', 'desktop');
const DSH_CARDS = {
  'dsh-pet': { label: '大肥鱼桌宠（DSH 端内）', candidates: ['dsh-pet', 'dsh-pet-plugin', 'pet-whale'] },
  'dsh-pet-desktop': { label: '大肥鱼桌宠（桌面版）', candidates: ['dsh-whale-widget', 'dsh-pet-plugin'] },
  'dsh-bilibili': { label: '自动刷 B 站', candidates: ['dsh-bili-whale', 'dsh-bili-pond'] },
  'dsh-douyin': { label: '自动刷抖音', candidates: ['dsh-douyin-agent', 'dsh-douyin-browser-local'] },
  'dsh-qq': { label: '接入 QQ', candidates: ['dsh-onebot-qq', 'dsh-qq-onebot'] },
};
const DSH_INSTALLABLE = { 'dsh-qq': 'dsh-onebot-qq', 'dsh-douyin': 'dsh-douyin-agent' };

function findPnpmRuntime() {
  const base = path.join(HOME, '.dsh', 'dsh-runtimes');
  try {
    for (const d of fs.readdirSync(base)) {
      const pnpm = path.join(base, d, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs');
      const node = path.join(base, d, 'dependencies', 'node', 'bin', 'node.exe');
      if (fs.existsSync(pnpm) && fs.existsSync(node)) return { pnpm, node };
    }
  } catch {}
  return null;
}

function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: process.env, windowsHide: true });
    let out = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
    }, opts.timeout || 180000);
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.slice(-4000) }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: String(err.message || err) }); });
  });
}

function safeDirName(raw) {
  const name = String(raw || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60);
  if (!name || name === '.' || name === '..') return '';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) ? `${name}_skill` : name;
}

function listArchiveEntries(zipFile) {
  try {
    const out = execFileSync('tar', ['-tf', zipFile], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    });
    return String(out).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function dshPluginStatus() {
  const pkgFile = path.join(DSH_PROFILE, 'package.json');
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')); } catch {}
  let patch = '';
  try { patch = fs.readFileSync(path.join(DSH_PROFILE, 'cordis.patch.yml'), 'utf8'); } catch {}
  const deps = pkg.dependencies || {};
  const bundles = pkg.dsh?.profile?.bundles || [];
  return Object.entries(DSH_CARDS).map(([id, card]) => {
    const pkgName = card.candidates.find((c) => deps[c]) || '';
    const installed = Boolean(pkgName) && fs.existsSync(path.join(DSH_PROFILE, 'node_modules', pkgName));
    return {
      id,
      label: card.label,
      package: pkgName,
      dep: pkgName ? deps[pkgName] : '',
      installed,
      inBundles: Boolean(pkgName) && bundles.includes(pkgName),
      configured: Boolean(pkgName) && (patch.includes(`- id: ${pkgName}`) || patch.includes(`name: ${pkgName}`)),
      installable: Boolean(DSH_INSTALLABLE[id]),
    };
  });
}

async function desktopItems() {
  const scan = await scanAll();
  return (scan.desktop || []).map((d) => {
    let exe = '';
    try {
      if (d.location && fs.existsSync(d.location)) {
        const hit = fs.readdirSync(d.location).find((f) => f.toLowerCase().endsWith('.exe'));
        if (hit) exe = path.join(d.location, hit);
      }
    } catch {}
    return { name: d.name, version: d.version || '', publisher: d.publisher || '', location: d.location || '', exe };
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (message, status = 400) => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error(message), { status }));
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        fail('请求体过大', 413);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }));
      }
    });
    req.on('aborted', () => fail('请求已中断', 400));
    req.on('error', (err) => fail(String(err.message || err), 400));
  });
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function hostnameOf(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : raw;
  }
  return raw.split(':')[0];
}

function isLocalHostHeader(host) {
  return LOCAL_HOSTS.has(hostnameOf(host));
}

function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** 本地面板只接受本机 Host、同源写请求和 JSON 请求体，避免浏览器跨站调用。 */
function admitRequest(req, pathname) {
  if (!isLocalHostHeader(req.headers.host)) {
    throw Object.assign(new Error('只接受本机访问'), { status: 403 });
  }
  const mutating = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH';
  if (!mutating) return;
  const origin = req.headers.origin;
  if (origin && !isLocalOrigin(origin)) {
    throw Object.assign(new Error('拒绝跨站请求'), { status: 403 });
  }
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw Object.assign(new Error('写请求需要 application/json'), { status: 415 });
  }
  if (pathname === '/api/skills/install-zip' && req.headers['x-requested-with'] !== 'xunlong-panel') {
    throw Object.assign(new Error('缺少本机面板请求标记'), { status: 403 });
  }
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/* ---------- 手动导入 / GitHub 安装 所需的小工具 ---------- */

function normalizeMcpEntry(name, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const command = String(raw.command || raw.cmd || '').trim();
  if (!command) return null;
  let args = raw.args ?? raw.arguments ?? [];
  if (typeof args === 'string') args = args.split(/\s+/).filter(Boolean);
  if (!Array.isArray(args)) args = [];
  const env = raw.env && typeof raw.env === 'object' ? Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [k, String(v)])) : {};
  const clean = String(name || raw.name || '').trim();
  if (!clean) return null;
  return { name: clean, command, args: args.map((a) => String(a)), env };
}

/** 解析粘贴/上传的 MCP 配置：支持 {"mcpServers":{...}}、裸映射、单条对象、数组。 */
function parseMcpConfig(input) {
  let data = input;
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return [];
    try {
      data = JSON.parse(text);
    } catch {
      return [];
    }
  }
  if (!data || typeof data !== 'object') return [];
  const out = [];
  const push = (name, raw) => {
    const item = normalizeMcpEntry(name, raw);
    if (item) out.push(item);
  };
  if (Array.isArray(data)) {
    for (const raw of data) push(raw?.name, raw);
    return out;
  }
  if (data.mcpServers && typeof data.mcpServers === 'object') {
    for (const [name, raw] of Object.entries(data.mcpServers)) push(name, raw);
    return out;
  }
  if (data.servers && typeof data.servers === 'object' && !data.command) {
    for (const [name, raw] of Object.entries(data.servers)) push(name, raw);
    return out;
  }
  if (data.command || data.cmd) {
    push(data.name || '', data);
    return out;
  }
  for (const [name, raw] of Object.entries(data)) {
    if (raw && typeof raw === 'object' && (raw.command || raw.cmd)) push(name, raw);
  }
  return out;
}

/** 从 README 文本里抓第一个带 command / mcpServers 的 JSON 代码块。 */
function parseMcpConfigFromText(text) {
  if (!text) return [];
  const blocks = [...String(text).matchAll(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = blocks.filter((b) => /"command"|"mcpServers"|'command'/.test(b));
  for (const block of [...candidates, String(text)]) {
    const start = block.indexOf('{');
    const end = block.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    const slice = block.slice(start, end + 1);
    try {
      const parsed = parseMcpConfig(slice);
      if (parsed.length) return parsed;
    } catch {}
  }
  return [];
}

function parseRepoSpec(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let owner = '';
  let repo = '';
  const url = raw.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i);
  if (url) {
    owner = url[1];
    repo = url[2];
  } else {
    const plain = raw.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (plain) {
      owner = plain[1];
      repo = plain[2];
    }
  }
  repo = String(repo || '').replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function ghFetch(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'xunlong-ai-manager', accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    throw Object.assign(new Error(`访问 GitHub 失败：${String(err.message || err)}`), { status: 502 });
  }
}

async function ghText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'xunlong-ai-manager' }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.text();
}

function providerRaw(id) {
  const p = getState().providers.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error('供应商不存在'), { status: 404 });
  return p;
}

function appOf(app) {
  if (!CLI[app]) throw Object.assign(new Error('不支持的应用'), { status: 400 });
  return CLI[app];
}

/* ------------------------- 路由处理 ------------------------- */

function buildDiagnostics() {
  const state = getState();
  return {
    app: APP_NAME,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    runtime: {
      os: `${process.platform} ${process.arch}`,
      release: process.getSystemVersion?.() || '',
      node: process.versions.node,
      electron: process.versions.electron || '',
    },
    dataDir: DATA_DIR,
    settings: {
      ...state.settings,
      proxy: state.settings.proxy ? '[已设置]' : '',
      proxyUser: state.settings.proxyUser ? '[已设置]' : '',
      proxyPass: state.settings.proxyPass ? '[已设置]' : '',
    },
    gateway: gateway.status(),
    apps: detectApps().map((a) => ({ key: a.key, label: a.label, installed: a.installed, strategy: a.strategy, configPath: a.configPath })),
    providers: state.providers.map((p) => ({
      app: p.app,
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      model: p.model,
      hasKey: Boolean(p.apiKey),
      activatedAt: p.activatedAt || null,
    })),
    counts: { providers: state.providers.length, mcp: state.mcpServers.length, prompts: state.prompts.length, backups: listBackups().length },
    usage7d: summary(7).totals,
    gatewayUsage: gateway.status(),
    note: '诊断包不包含任何 API Key 明文。',
  };
}

const handlers = {
  'GET /api/health': () => ({ ok: true, app: APP_NAME, version: VERSION, time: new Date().toISOString() }),

  'GET /api/overview': () => {
    const state = getState();
    const apps = detectApps();
    const active = {};
    for (const app of apps) {
      const p = state.providers.find((x) => x.app === app.key && x.activatedAt);
      if (p) active[app.key] = p.id;
    }
    return {
      app: APP_NAME,
      version: VERSION,
      edition: 'free',
      dataDir: DATA_DIR,
      apps,
      active,
      providerCount: state.providers.length,
      presetsCount: PRESETS.length,
      gateway: gateway.status(),
      usage: summary(7),
      settings: state.settings,
      mcpCount: state.mcpServers.length,
      promptCount: listPrompts().length,
      skillCount: listSkills().length,
    };
  },

  'GET /api/apps': () => detectApps(),

  'GET /api/presets': (ctx) => {
    const app = ctx.query.get('app');
    const items = app ? PRESETS.filter((p) => p.app === app) : PRESETS;
    return { items };
  },

  'GET /api/providers': (ctx) => {
    const app = ctx.query.get('app');
    return { items: listProviders(app || undefined) };
  },

  'POST /api/providers': (ctx) => {
    let payload = { ...ctx.body };
    if (payload.presetId) {
      const preset = findPreset(payload.presetId);
      if (!preset) throw Object.assign(new Error('预设不存在'), { status: 400 });
      payload = { ...presetToProvider(preset), ...payload };
    }
    appOf(payload.app || 'claude');
    const provider = newProvider({
      ...payload,
      protocol: payload.protocol || CLI[payload.app].protocol,
    });
    mutate((state) => {
      state.providers.push(provider);
    });
    return { ok: true, provider: publicProvider(provider) };
  },

  'GET /api/providers/:id': (ctx) => ({ provider: publicProvider(providerRaw(ctx.params.id)) }),

  'GET /api/providers/:id/key': (ctx) => ({ apiKey: providerRaw(ctx.params.id).apiKey || '' }),

  'PUT /api/providers/:id': (ctx) => {
    const raw = providerRaw(ctx.params.id);
    const patch = { ...ctx.body };
    if (typeof patch.apiKey === 'string' && patch.apiKey.includes('•')) delete patch.apiKey;
    if (patch.app) appOf(patch.app);
    const updated = mutate((state) => {
      const p = state.providers.find((x) => x.id === raw.id);
      Object.assign(p, patch, { id: p.id, updatedAt: new Date().toISOString() });
      return p;
    });
    return { ok: true, provider: publicProvider(updated) };
  },

  'DELETE /api/providers/:id': (ctx) => {
    mutate((state) => {
      state.providers = state.providers.filter((p) => p.id !== ctx.params.id);
      state.gateway.order = (state.gateway.order || []).filter((id) => id !== ctx.params.id);
    });
    return { ok: true };
  },

  'POST /api/providers/:id/activate': (ctx) => {
    const provider = providerRaw(ctx.params.id);
    if (CLI[provider.app]?.readOnly) throw Object.assign(new Error('该应用为只读识别：可读取当前配置，但不会写回'), { status: 400 });
    if (!provider.apiKey && !/api\.anthropic\.com|generativelanguage\.googleapis\.com/i.test(provider.baseUrl || '')) {
      throw Object.assign(new Error('请先填写 API Key'), { status: 400 });
    }
    const result = applyProvider(provider);
    mutate((state) => {
      for (const p of state.providers) {
        if (p.app === provider.app) delete p.activatedAt;
      }
      const p = state.providers.find((x) => x.id === provider.id);
      p.activatedAt = new Date().toISOString();
    });
    return {
      ok: true,
      applied: result,
      current: readCurrent(provider.app),
      note: `已写入 ${CLI[provider.app].label} 配置，重启该 CLI 后生效`,
    };
  },

  'POST /api/providers/:id/test': async (ctx) => {
    const provider = providerRaw(ctx.params.id);
    return testProvider(provider);
  },

  'POST /api/providers/:id/models': async (ctx) => {
    const provider = providerRaw(ctx.params.id);
    return { models: await fetchModels(provider) };
  },

  'POST /api/providers/:id/balance': async (ctx) => {
    const provider = providerRaw(ctx.params.id);
    return queryBalance(provider);
  },

  'POST /api/providers/test': async (ctx) => {
    const body = ctx.body || {};
    return testProvider({
      protocol: body.protocol || 'openai',
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      model: body.model,
    });
  },

  'GET /api/gateway': () => ({ ...gateway.status(), config: getState().gateway, settings: getState().settings }),

  'POST /api/gateway/start': async (ctx) => {
    const port = Number(ctx.body?.port || getState().settings.gatewayPort || 8317);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw Object.assign(new Error('端口需在 1024-65535 之间'), { status: 400 });
    }
    const status = await gateway.start(port);
    mutate((state) => {
      state.settings.gatewayPort = port;
    });
    return { ok: true, status };
  },

  'POST /api/gateway/stop': async () => {
    await gateway.stop();
    return { ok: true, status: gateway.status() };
  },

  'POST /api/gateway/order': (ctx) => {
    const order = Array.isArray(ctx.body?.order) ? ctx.body.order : [];
    mutate((state) => {
      state.gateway.order = order;
    });
    return { ok: true, order };
  },

  'GET /api/usage': (ctx) => {
    const start = Number(ctx.query.get('start') || 0);
    const end = Number(ctx.query.get('end') || 0);
    const hasRange = ctx.query.has('start') && ctx.query.has('end');
    const session = scanSessionUsage();
    const extra = (session.rows || []).map((r) => ({
      ts: r.ts,
      app: r.app,
      providerName: '会话日志',
      model: r.model || 'unknown',
      input: r.input,
      output: r.output,
      cached: r.cached,
      latency: 0,
      status: 200,
      source: 'session',
    }));
    return summary(Number(ctx.query.get('days') || 7), hasRange ? { start, end } : null, extra);
  },

  'POST /api/usage/clear': () => {
    clearUsage();
    return { ok: true };
  },

  'GET /api/mcp': () => ({
    items: listMcp().map((m) => ({
      ...m,
      category: resolveCategory(m.category, m.name, m.command, (m.args || []).join(' '), m.note),
      categoryManual: !!m.category,
    })),
    templates: mcpTemplates(),
  }),

  'POST /api/mcp': (ctx) => {
    if (!ctx.body?.name) throw Object.assign(new Error('请填写名称'), { status: 400 });
    return { ok: true, item: upsertMcp(ctx.body) };
  },

  'PUT /api/mcp/:id': (ctx) => {
    const cur = getState().mcpServers.find((m) => m.id === ctx.params.id);
    if (!cur) throw Object.assign(new Error('MCP 不存在'), { status: 404 });
    return { ok: true, item: upsertMcp({ ...cur, ...ctx.body, id: ctx.params.id, name: String(ctx.body?.name || cur.name) }) };
  },

  'DELETE /api/mcp/:id': (ctx) => ({ ok: true, removed: removeMcp(ctx.params.id) }),

  'POST /api/mcp/import-config': (ctx) => {
    const parsed = parseMcpConfig(ctx.body?.config);
    if (!parsed.length) throw Object.assign(new Error('没有解析到 MCP 配置：需要包含 command 的 JSON'), { status: 400 });
    const apps = (Array.isArray(ctx.body?.apps) && ctx.body.apps.length ? ctx.body.apps : ['claude']).filter((a) =>
      ['claude', 'codex', 'gemini', 'qwen'].includes(a),
    );
    const imported = [];
    const merged = [];
    const skipped = [];
    for (const item of parsed) {
      const exists = getState().mcpServers.find((m) => m.name === item.name);
      if (exists) {
        mutate((state) => {
          const m = state.mcpServers.find((x) => x.name === item.name);
          m.apps = [...new Set([...(m.apps || []), ...apps])];
        });
        merged.push(item.name);
        continue;
      }
      try {
        upsertMcp({ ...item, apps, note: '手动导入' });
        imported.push(item.name);
      } catch (err) {
        skipped.push({ name: item.name, reason: String(err.message || err) });
      }
    }
    if (imported.length || merged.length) applyMcp();
    return { ok: true, imported, merged, skipped, total: parsed.length };
  },

  'POST /api/github/probe': async (ctx) => {
    const spec = parseRepoSpec(ctx.body?.repo);
    if (!spec) throw Object.assign(new Error('请输入 GitHub 仓库地址，例如 owner/repo 或 https://github.com/owner/repo'), { status: 400 });
    const meta = await ghFetch(`https://api.github.com/repos/${spec.owner}/${spec.repo}`);
    if (meta.status === 404) throw Object.assign(new Error('GitHub 上找不到这个仓库（可能是私有或拼写有误）'), { status: 404 });
    if (meta.status === 403) throw Object.assign(new Error('GitHub 访问次数受限，稍后再试，或改用「手动导入」粘贴配置'), { status: 429 });
    if (!meta.ok) throw Object.assign(new Error(`读取仓库信息失败（HTTP ${meta.status}）`), { status: 502 });
    const info = meta.json || {};
    const branch = info.default_branch || 'main';
    const base = `https://raw.githubusercontent.com/${spec.owner}/${spec.repo}/${branch}`;
    const [readme, pkg] = await Promise.all([
      ghText(`${base}/README.md`).catch(() => ''),
      ghText(`${base}/package.json`).catch(() => ''),
    ]);
    let pkgJson = null;
    try { pkgJson = JSON.parse(pkg); } catch {}
    const fromReadme = parseMcpConfigFromText(readme);
    let candidate = fromReadme[0] || null;
    let source = candidate ? 'readme' : '';
    if (!candidate && pkgJson && pkgJson.name) {
      const bin = pkgJson.bin && typeof pkgJson.bin === 'object' ? Object.keys(pkgJson.bin)[0] : String(pkgJson.bin || '');
      candidate = { name: spec.repo, command: 'npx', args: ['-y', pkgJson.name], env: {}, note: bin ? `bin: ${bin}` : '' };
      source = 'package';
    }
    const warn = source === 'package' && !(pkgJson && (pkgJson.bin || pkgJson.directories)) && pkgJson && pkgJson.workspaces
      ? '这个仓库是 monorepo（workspaces），上面的包名可能不是可执行的那个；请到子目录里找具体包名再改。'
      : '';
    return {
      ok: true,
      repo: {
        owner: spec.owner,
        name: spec.repo,
        full: `${spec.owner}/${spec.repo}`,
        description: info.description || '',
        stars: info.stargazers_count || 0,
        branch,
        archived: info.archived === true,
        language: info.language || '',
        homepage: info.html_url || '',
      },
      candidate: candidate ? { name: candidate.name || spec.repo, command: candidate.command, args: candidate.args || [], env: candidate.env || {} } : null,
      source,
      warn,
      readmeHasConfig: fromReadme.length > 0,
    };
  },

  'POST /api/mcp/apply': () => ({ ok: true, result: applyMcp() }),

  'POST /api/mcp/import': () => importMcpFromApps(),

  'POST /api/mcp/check': () => ({ items: checkMcp() }),

  'GET /api/prompts': () => ({
    items: listPrompts().map((p) => ({
      ...p,
      category: resolveCategory(p.category, p.title, (p.tags || []).join(' '), String(p.content || '').slice(0, 400)),
      categoryManual: !!p.category,
    })),
  }),

  'POST /api/prompts': (ctx) => ({ ok: true, item: upsertPrompt(ctx.body || {}) }),

  'PUT /api/prompts/:id': (ctx) => ({ ok: true, item: upsertPrompt({ ...ctx.body, id: ctx.params.id }) }),

  'PATCH /api/prompts/:id': (ctx) => {
    if (ctx.body?.category === undefined) throw Object.assign(new Error('没有要修改的字段'), { status: 400 });
    return setPromptCategory(ctx.params.id, ctx.body.category);
  },

  'DELETE /api/prompts/:id': (ctx) => ({ ok: true, removed: removePrompt(ctx.params.id) }),

  'POST /api/skills/install-zip': async (ctx) => {
    const b64 = String(ctx.body?.data || '');
    if (!b64) throw Object.assign(new Error('没有收到文件内容'), { status: 400 });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 30 * 1024 * 1024) throw Object.assign(new Error('压缩包过大（上限 30MB）'), { status: 400 });
    const rawName = String(ctx.body?.filename || 'skill.zip').replace(/\.zip$/i, '');
    const safe = safeDirName(rawName) || `skill-${Date.now()}`;
    fs.mkdirSync(FILES.backups, { recursive: true });
    const tmpZip = path.join(FILES.backups, `upload-${process.pid}-${Date.now()}.zip`);
    const stage = fs.mkdtempSync(path.join(FILES.backups, 'skill-unzip-'));
    fs.writeFileSync(tmpZip, buf);
    try {
      const archiveEntries = listArchiveEntries(tmpZip);
      if (!archiveEntries) throw Object.assign(new Error('无法读取压缩包目录'), { status: 400 });
      for (const entry of archiveEntries) {
        const normalized = entry.replace(/\\/g, '/');
        if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
          throw Object.assign(new Error(`压缩包包含越界路径：${entry}`), { status: 400 });
        }
      }
      let ok = false;
      try {
        execFileSync('tar', ['-xf', tmpZip, '-C', stage], { stdio: 'ignore', timeout: 30000 });
        ok = true;
      } catch {}
      if (!ok) {
        try {
          execFileSync(
            'powershell',
            ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${stage.replace(/'/g, "''")}' -Force`],
            { stdio: 'ignore', timeout: 30000 },
          );
          ok = true;
        } catch {}
      }
      if (!ok) throw Object.assign(new Error('解压失败（系统缺少 tar / Expand-Archive）'), { status: 500 });
      // 如果压缩包内只有一层目录，上提一层
      const entries = fs.readdirSync(stage, { withFileTypes: true });
      if (entries.length === 1 && entries[0].isDirectory()) {
        const inner = path.join(stage, entries[0].name);
        for (const f of fs.readdirSync(inner)) {
          fs.renameSync(path.join(inner, f), path.join(stage, f));
        }
        fs.rmdirSync(inner);
      }
      const skillFile = path.join(stage, 'SKILL.md');
      if (!fs.existsSync(skillFile) || !fs.lstatSync(skillFile).isFile()) {
        throw Object.assign(new Error('压缩包内没有 SKILL.md，不是有效技能'), { status: 400 });
      }
      const result = installSkillFromDir(stage, safe, ctx.body?.apps || [], {
        update: ctx.body?.update === true,
        origin: 'zip',
      });
      if (result.status === 'skipped') {
        if (result.reason === 'exists') {
          throw Object.assign(new Error('同名技能已存在；勾选“覆盖更新”后可替换'), { status: 409 });
        }
        throw Object.assign(new Error('没有可安装的技能'), { status: 400 });
      }
      return { ok: true, name: result.folder || safe, title: result.name || safe, result };
    } finally {
      try { fs.unlinkSync(tmpZip); } catch {}
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    }
  },

  'GET /api/skills': () => ({
    installed: listInstalledSkills().map((s) => ({
      ...s,
      category: resolveCategory(s.category, s.name, s.description, s.folder),
    })),
    available: listAvailableSkills(),
    targets: skillTargets(),
  }),

  'GET /api/categories': () => ({ items: CATEGORIES }),

  'POST /api/marketplace/category': (ctx) => {
    const id = String(ctx.body?.id || '');
    if (!CATALOG.some((c) => c.id === id)) throw Object.assign(new Error('插件不存在'), { status: 400 });
    const key = String(ctx.body?.category || '');
    return mutate((state) => {
      state.meta = state.meta && typeof state.meta === 'object' ? state.meta : {};
      state.meta.marketCategories = state.meta.marketCategories && typeof state.meta.marketCategories === 'object' ? state.meta.marketCategories : {};
      if (key) state.meta.marketCategories[id] = key;
      else delete state.meta.marketCategories[id];
      return { ok: true, id, category: key };
    });
  },

  'POST /api/skills/md': async (ctx) => {
    const raw = String(ctx.body?.content || '');
    if (!raw.trim()) throw Object.assign(new Error('没有收到 Markdown 内容'), { status: 400 });
    if (raw.length > 1024 * 1024) throw Object.assign(new Error('Markdown 过大（上限 1MB）'), { status: 400 });
    const text = raw.replace(/\r\n/g, '\n');
    const fm = text.startsWith('---') ? text.slice(0, Math.max(0, text.indexOf('\n---', 3))) : '';
    const fmName = (fm.match(/^name:\s*(.+)$/m) || [])[1];
    const fmDesc = (fm.match(/^description:\s*(.+)$/m) || [])[1];
    const heading = (text.match(/^#[ \t]+(.+)$/m) || [])[1];
    const fileBase = String(ctx.body?.filename || 'skill.md').replace(/\.[^.]+$/, '');
    const title = String(fmName || heading || fileBase || '新技能').replace(/["']/g, '').trim().slice(0, 80) || '新技能';
    const desc = String(fmDesc || '')
      .replace(/^["']|["']$/g, '')
      .trim() || (text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('---') && !/^[A-Za-z0-9_-]+:\s/.test(l)) || '').slice(0, 160);
    const safe = safeDirName(title) || `skill-${Date.now()}`;
    fs.mkdirSync(FILES.backups, { recursive: true });
    const stage = fs.mkdtempSync(path.join(FILES.backups, 'skill-md-'));
    try {
      const hasFm = text.startsWith('---') && text.indexOf('\n---', 3) !== -1;
      const content = hasFm
        ? text
        : `---\nname: ${title}\ndescription: ${desc.replace(/\n/g, ' ')}\n---\n\n${text.trim()}\n`;
      fs.writeFileSync(path.join(stage, 'SKILL.md'), content, 'utf8');
      const result = installSkillFromDir(stage, safe, ctx.body?.apps || [], {
        update: ctx.body?.update === true,
        origin: 'md',
      });
      if (result.status === 'skipped') {
        if (result.reason === 'exists') {
          throw Object.assign(new Error('同名技能已存在；勾选“覆盖更新”后可替换'), { status: 409 });
        }
        throw Object.assign(new Error('没有可安装的技能'), { status: 400 });
      }
      return { ok: true, name: result.folder || safe, title: result.name || title, result };
    } finally {
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    }
  },

  'POST /api/skills/import': (ctx) =>
    importSkills(ctx.body?.items || [], ctx.body?.apps || [], { update: ctx.body?.update === true }),

  'POST /api/skills/sync': (ctx) => syncSkills(ctx.body?.name || ''),

  'PATCH /api/skills/:name': (ctx) => {
    const result = {};
    if (ctx.body && ctx.body.category !== undefined) Object.assign(result, setSkillCategory(ctx.params.name, ctx.body.category));
    if (Array.isArray(ctx.body?.apps)) Object.assign(result, setSkillApps(ctx.params.name, ctx.body.apps));
    if (!Object.keys(result).length) throw Object.assign(new Error('没有要修改的字段'), { status: 400 });
    return result;
  },

  'DELETE /api/skills/:name': (ctx) => removeSkill(ctx.params.name),

  'GET /api/sessions': () => ({ items: listSessions() }),

  'GET /api/sessions/:id': (ctx) => sessionDetail(ctx.params.id),

  'GET /api/backups': () => ({ items: listBackups() }),

  'POST /api/backups': (ctx) => ({ ok: true, item: createBackup(ctx.body?.label || '手动备份') }),

  'POST /api/backups/:id/restore': (ctx) => {
    const result = restoreBackup(ctx.params.id);
    reloadState();
    return { ok: true, ...result };
  },

  'DELETE /api/backups/:id': (ctx) => deleteBackup(ctx.params.id),

  'DELETE /api/backups': () => clearBackups(),

  'GET /api/scan': async (ctx) => {
    const scan = await scanAll({ force: ctx.query.get('force') === '1' });
    const existing = getState().providers;
    for (const c of scan.candidates) {
      c.duplicate = existing.some(
        (p) => p.app === c.app && (p.baseUrl || '').replace(/\/+$/, '') === (c.baseUrl || '').replace(/\/+$/, ''),
      );
      c.keyTail = c.apiKey ? c.apiKey.slice(-4) : '';
      c.hasKey = Boolean(c.apiKey);
      delete c.apiKey;
    }
    return scan;
  },

  'POST /api/scan/import': (ctx) => {
    const items = Array.isArray(ctx.body?.items) ? ctx.body.items : [];
    let created = 0;
    let skipped = 0;
    const made = [];
    mutate((state) => {
      for (const item of items) {
        if (!item?.app || !CLI[item.app]) {
          skipped += 1;
          continue;
        }
        const base = (item.baseUrl || '').replace(/\/+$/, '');
        const dup = state.providers.some(
          (p) => p.app === item.app && (p.baseUrl || '').replace(/\/+$/, '') === base,
        );
        if (dup || !base) {
          skipped += 1;
          continue;
        }
        // 扫描结果不再把明文 Key 发到前端；导入时按当前本机配置重新读取。
        const active = readActiveProvider(item.app);
        const sameSource = active && (active.baseUrl || '').replace(/\/+$/, '') === base;
        const provider = newProvider({
          app: item.app,
          name: item.name || `${CLI[item.app].label} · 导入`,
          protocol: item.protocol || CLI[item.app].protocol,
          baseUrl: base,
          apiKey: sameSource ? active.apiKey || '' : '',
          model: item.model || '',
          note: `从 ${item.source || '本机配置'} 扫描导入`,
          importedFrom: item.source || '',
        });
        state.providers.push(provider);
        made.push(provider.id);
        created += 1;
      }
    });
    clearScanCache();
    return { ok: true, created, skipped, ids: made };
  },

  'POST /api/import/config': (ctx) => {
    const data = ctx.body?.data;
    if (!data || typeof data !== 'object') throw Object.assign(new Error('配置文件内容无效'), { status: 400 });
    let providers = 0;
    let mcp = 0;
    let prompts = 0;
    let skipped = 0;
    mutate((state) => {
      for (const raw of Array.isArray(data.providers) ? data.providers : []) {
        if (!raw || !CLI[raw.app] || !raw.baseUrl) {
          skipped += 1;
          continue;
        }
        const base = String(raw.baseUrl).replace(/\/+$/, '');
        if (state.providers.some((p) => p.app === raw.app && (p.baseUrl || '').replace(/\/+$/, '') === base)) {
          skipped += 1;
          continue;
        }
        const apiKey = typeof raw.apiKey === 'string' && !raw.apiKey.includes('•') ? raw.apiKey : '';
        state.providers.push(
          newProvider({
            app: raw.app,
            name: raw.name || `${CLI[raw.app].label} · 导入`,
            protocol: raw.protocol || CLI[raw.app].protocol,
            baseUrl: base,
            apiKey,
            model: raw.model || '',
            models: Array.isArray(raw.models) ? raw.models : [],
            group: raw.group || '',
            note: raw.note || '从配置文件导入',
          }),
        );
        providers += 1;
      }
      for (const raw of Array.isArray(data.mcp) ? data.mcp : []) {
        if (!raw?.name || state.mcpServers.some((m) => m.name === raw.name)) {
          skipped += 1;
          continue;
        }
        state.mcpServers.push({
          id: uidFor('mcp'),
          name: String(raw.name),
          command: String(raw.command || 'npx'),
          args: Array.isArray(raw.args) ? raw.args.map(String) : [],
          env: raw.env && typeof raw.env === 'object' ? raw.env : {},
          enabled: raw.enabled !== false,
          apps: Array.isArray(raw.apps) ? raw.apps : ['claude'],
          note: raw.note || '从配置文件导入',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        mcp += 1;
      }
      for (const raw of Array.isArray(data.prompts) ? data.prompts : []) {
        if (!raw?.title) {
          skipped += 1;
          continue;
        }
        const now = new Date().toISOString();
        state.prompts.push({
          id: uidFor('prm'),
          title: String(raw.title),
          tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
          content: String(raw.content || ''),
          createdAt: now,
          updatedAt: now,
        });
        prompts += 1;
      }
      state.meta.promptsSeeded = true;
    });
    return { ok: true, providers, mcp, prompts, skipped };
  },

  'GET /api/settings': () => getState().settings,

  'PUT /api/settings': async (ctx) => {
    const patch = ctx.body || {};
    if (patch.gatewayPort !== undefined) {
      const port = Number(patch.gatewayPort);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw Object.assign(new Error('端口需在 1024-65535 之间'), { status: 400 });
      }
    }
    if (patch.requestTimeout !== undefined) {
      const timeout = Number(patch.requestTimeout);
      if (!Number.isFinite(timeout) || timeout < 5000 || timeout > 600000) {
        throw Object.assign(new Error('超时需在 5000-600000 毫秒之间'), { status: 400 });
      }
    }
    if (patch.retryCount !== undefined) {
      const retry = Number(patch.retryCount);
      if (!Number.isInteger(retry) || retry < 0 || retry > 10) {
        throw Object.assign(new Error('最大尝试数需在 0-10 之间'), { status: 400 });
      }
    }
    if (patch.backupKeep !== undefined) {
      const keep = Number(patch.backupKeep);
      if (!Number.isInteger(keep) || keep < 1 || keep > 100) {
        throw Object.assign(new Error('备份保留数量需在 1-100 之间'), { status: 400 });
      }
    }
    if (patch.backupInterval !== undefined && !['关闭', '6 小时', '12 小时', '24 小时'].includes(patch.backupInterval)) {
      throw Object.assign(new Error('自动备份间隔无效'), { status: 400 });
    }
    if (patch.theme !== undefined && !['light', 'dark', 'system'].includes(patch.theme)) {
      throw Object.assign(new Error('外观主题只能是 light / dark / system'), { status: 400 });
    }
    if (patch.language !== undefined && !['zh', 'en'].includes(patch.language)) {
      throw Object.assign(new Error('界面语言只能是 zh / en'), { status: 400 });
    }
    if (patch.theme !== undefined && !['light', 'dark', 'system'].includes(patch.theme)) {
      throw Object.assign(new Error('外观主题只能是 light / dark / system'), { status: 400 });
    }
    const before = { ...getState().settings };
    mutate((state) => {
      state.settings = { ...state.settings, ...patch };
    });
    if (gateway.status().running && before.gatewayPort !== getState().settings.gatewayPort) {
      await gateway.start(getState().settings.gatewayPort);
    }
    if (patch.autoStart !== undefined) setAutostart(Boolean(patch.autoStart));
    if (patch.backupInterval !== undefined) scheduleAutoBackup();
    return { ok: true, settings: getState().settings };
  },

  'GET /api/dsh-plugins': () => {
    const cache = path.join(HOME, '.dsh', 'profiles', 'desktop', '.dsh-market', 'discovery-compatibility-v1.json');
    if (!fs.existsSync(cache)) return { items: [], found: false };
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(cache, 'utf8'));
    } catch {
      return { items: [], found: false };
    }
    const label = (id) => {
      const base = String(id).split('/').pop().replace(/^dsh-/, '');
      return base.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    };
    const items = Object.entries(data.entries || {})
      .map(([id, e]) => ({ id, version: e?.facts?.version || '', engines: e?.facts?.enginesDsh || '' }))
      .filter((x) => x.version)
      .slice(0, 40)
      .map((x) => ({ ...x, label: label(x.id) }));
    return { items, found: true, total: Object.keys(data.entries || {}).length };
  },

  'GET /api/marketplace': () => {
    const state = getState();
    const installed = new Set(state.mcpServers.map((m) => m.name));
    const overrides = (state.meta && state.meta.marketCategories) || {};
    return {
      items: CATALOG.map((c) => ({
        ...c,
        installed: installed.has(c.name),
        category: resolveCategory(overrides[c.id], c.name, c.desc, (c.tags || []).join(' '), (c.args || []).join(' ')),
        categoryManual: !!overrides[c.id],
      })),
      note: '全部为公开开源 MCP 服务器；安装即写入所选 CLI 的 MCP 配置。',
    };
  },

  'POST /api/marketplace/install': (ctx) => {
    const item = CATALOG.find((c) => c.id === ctx.body?.id);
    if (!item) throw Object.assign(new Error('插件不存在'), { status: 400 });
    const apps = (Array.isArray(ctx.body?.apps) && ctx.body.apps.length ? ctx.body.apps : ['claude']).filter((app) =>
      ['claude', 'codex', 'gemini', 'qwen'].includes(app),
    );
    if (!apps.length) throw Object.assign(new Error('请选择至少一个支持的应用'), { status: 400 });
    const dir = String(ctx.body?.dir || '').trim();
    const db = String(ctx.body?.db || '').trim();
    if (item.requiresDir && !dir) throw Object.assign(new Error('该插件需要填写目录'), { status: 400 });
    if (item.requiresDb && !db) throw Object.assign(new Error('该插件需要填写数据库路径'), { status: 400 });
    const env = ctx.body?.env && typeof ctx.body.env === 'object' ? ctx.body.env : {};
    if ((item.envKeys || []).some((key) => !String(env[key] || '').trim())) {
      throw Object.assign(new Error('请填写该插件要求的环境变量'), { status: 400 });
    }
    const name = item.name;
    const args = item.args.map((a) => a.replace('{{dir}}', dir).replace('{{db}}', db));
    const exists = getState().mcpServers.find((m) => m.name === name);
    if (exists) {
      mutate((state) => {
        const m = state.mcpServers.find((x) => x.name === name);
        m.apps = [...new Set([...(m.apps || []), ...apps])];
      });
      applyMcp();
      return { ok: true, merged: true, name };
    }
    upsertMcp({ name, command: item.command, args, env, apps, note: `插件市场：${item.repo}`, enabled: true });
    const applied = applyMcp();
    return { ok: true, name, applied };
  },

  'GET /api/dsh/plugins': () => ({ items: dshPluginStatus(), profile: DSH_PROFILE }),

  'POST /api/dsh/install': async (ctx) => {
    const id = ctx.body?.id;
    if (!DSH_INSTALLABLE[id]) throw Object.assign(new Error('该插件暂不支持一键安装'), { status: 400 });
    if (!fs.existsSync(path.join(DSH_PROFILE, 'package.json'))) throw Object.assign(new Error('未找到 DSH profile'), { status: 400 });
    const backupDir = path.join(FILES.backups, `dsh-install-${Date.now()}`);
    fs.mkdirSync(backupDir, { recursive: true });
    for (const f of ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml']) {
      const src = path.join(DSH_PROFILE, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, f));
    }
    const rt = findPnpmRuntime();
    if (!rt) throw Object.assign(new Error('未找到 DSH 自带的 node/pnpm'), { status: 500 });
    const res = await runProcess(rt.node, [rt.pnpm, 'add', DSH_INSTALLABLE[id]], { cwd: DSH_PROFILE, timeout: 240000 });
    if (res.code !== 0) {
      for (const f of ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml']) {
        const bak = path.join(backupDir, f);
        if (fs.existsSync(bak)) fs.copyFileSync(bak, path.join(DSH_PROFILE, f));
      }
      return { ok: false, rolledBack: true, backupDir, log: res.out };
    }
    // 注册为 DSH 插件 bundle，重启后加载
    let bundleAdded = false;
    try {
      const pkgFile = path.join(DSH_PROFILE, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      pkg.dsh = pkg.dsh || {};
      pkg.dsh.profile = pkg.dsh.profile || {};
      pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || [];
      const name = DSH_INSTALLABLE[id];
      if (!pkg.dsh.profile.bundles.includes(name)) {
        pkg.dsh.profile.bundles.push(name);
        fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2), 'utf8');
        bundleAdded = true;
      }
    } catch {}
    return { ok: true, backupDir, log: res.out, bundleAdded, status: dshPluginStatus() };
  },

  'GET /api/desktop-apps': async () => ({ items: await desktopItems() }),

  'POST /api/desktop/launch': async (ctx) => {
    const exe = path.resolve(String(ctx.body?.exe || ''));
    if (!exe || !fs.existsSync(exe)) throw Object.assign(new Error('没有找到可执行文件'), { status: 400 });
    const allowed = new Set(
      (await desktopItems())
        .map((item) => item.exe)
        .filter(Boolean)
        .map((item) => path.resolve(item).toLowerCase()),
    );
    if (!allowed.has(exe.toLowerCase())) throw Object.assign(new Error('只能启动扫描到的桌面应用'), { status: 403 });
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return { ok: true, exe };
  },

  'POST /api/desktop/open': (ctx) => {
    const target = ctx.body?.path;
    if (!target || !fs.existsSync(target)) throw Object.assign(new Error('目录不存在'), { status: 400 });
    const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  },

  'GET /api/mirrors': () => mirrorStatus(),

  'POST /api/mirrors/apply': (ctx) => applyMirror(ctx.body?.target),

  'POST /api/mirrors/restore': (ctx) => restoreMirror(ctx.body?.target),

  'POST /api/mirrors/test': () => testMirrors(),
  'GET /api/diagnostics': () => buildDiagnostics(),
  'POST /api/diagnostics/export': () => {
    const dir = path.join(DATA_DIR, 'diagnostics');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `xunlong-diagnostics-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(buildDiagnostics(), null, 2), 'utf8');
    return { ok: true, path: file, dir };
  },
  'POST /api/import/ccswitch': () => importCcSwitch(),

  'GET /api/keys': () => ({
    note: '所有 API Key 仅保存在本机 %APPDATA%\\XunlongAIManager\\config.json，不上传任何服务器。',
    dataDir: DATA_DIR,
  }),
};

const ROUTES = Object.entries(handlers).map(([key, handler]) => {
  const [method, pattern] = key.split(' ');
  const parts = pattern.split('/').filter(Boolean);
  return { method, parts, handler };
});

/**
 * Run an API route without an HTTP socket. The Electron app:// bridge uses
 * this so the UI never depends on a locally listening TCP port.
 */
export async function dispatchApi(method, pathname, body = {}) {
  const verb = String(method || 'GET').toUpperCase();
  const url = new URL(String(pathname || '/'), 'http://app.local');
  const match = matchRoute(verb, url.pathname);
  if (!match) throw Object.assign(new Error('接口不存在'), { status: 404 });
  const ctx = {
    method: verb,
    pathname: url.pathname,
    params: match.params,
    query: url.searchParams,
    body: verb === 'GET' || verb === 'DELETE' ? {} : body || {},
  };
  return match.handler(ctx);
}

function matchRoute(method, pathname) {
  const segs = pathname.split('/').filter(Boolean);
  for (const r of ROUTES) {
    if (r.method !== method || r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i];
      if (p.startsWith(':')) {
        try {
          params[p.slice(1)] = decodeURIComponent(segs[i]);
        } catch {
          throw Object.assign(new Error('路径参数编码无效'), { status: 400 });
        }
      } else if (p !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

function serveStatic(req, res, pathname) {
  let rel = pathname;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    res.end('bad request');
    return;
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  rel = rel.replace(/^[/\\]+/, '');
  const file = path.resolve(UI_DIR, rel);
  if (!isInside(UI_DIR, file) || path.basename(file).startsWith('.')) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (path.extname(rel)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      fs.readFile(path.join(UI_DIR, 'index.html'), (e2, html) => {
        if (e2) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        res.writeHead(200, { 'content-type': MIME['.html'], ...SECURITY_HEADERS });
        res.end(req.method === 'HEAD' ? undefined : html);
      });
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

export function createServer() {
  ensureDirs();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname.startsWith('/api/')) {
        admitRequest(req, url.pathname);
        const match = matchRoute(req.method, url.pathname);
        if (!match) {
          send(res, 404, { error: '接口不存在' });
          return;
        }
        const bodyLimit = url.pathname === '/api/skills/install-zip' ? 45 * 1024 * 1024 : 2 * 1024 * 1024;
        const ctx = {
          req,
          res,
          params: match.params,
          query: url.searchParams,
          body: req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req, bodyLimit),
        };
        const result = await match.handler(ctx);
        if (!res.writableEnded) send(res, 200, result ?? { ok: true });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end('method not allowed');
        return;
      }
      serveStatic(req, res, url.pathname);
    } catch (err) {
      const status = err.status || 500;
      if (!res.writableEnded) send(res, status, { error: String(err.message || err) });
    }
  });
}

let autoBackupTimer = null;

function scheduleAutoBackup() {
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  autoBackupTimer = null;
  const setting = getState().settings.backupInterval;
  const hours = setting === '6 小时' ? 6 : setting === '12 小时' ? 12 : setting === '24 小时' ? 24 : 0;
  if (!hours) return;
  autoBackupTimer = setInterval(() => {
    try {
      createBackup('自动备份', false);
    } catch (err) {
      console.error('[backup] 自动备份失败：', err.message);
    }
  }, hours * 60 * 60 * 1000);
  autoBackupTimer.unref?.();
}

export async function startServer({ port = Number(process.env.PORT) || 20917 } = {}) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actual = server.address().port;
  const state = getState();
  scheduleAutoBackup();
  fs.writeFileSync(
    FILES.runtime,
    JSON.stringify({ port: actual, pid: process.pid, startedAt: new Date().toISOString(), version: VERSION }, null, 2),
  );

  if (state.settings.autoStartGateway && !gateway.status().running) {
    try {
      await gateway.start(state.settings.gatewayPort);
    } catch (err) {
      console.error('[gateway] 自动启动失败：', err.message);
    }
  }

  return { server, port: actual };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { port } = await startServer();
  console.log(`\n  ${APP_NAME} v${VERSION}  (无账号 · 无会员)\n  → http://127.0.0.1:${port}\n`);
  console.log(`  数据目录：${DATA_DIR}`);
  console.log(`  启动时间：${timestamp()}\n`);
}








