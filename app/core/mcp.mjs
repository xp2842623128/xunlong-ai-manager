import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { CLI, readJson, readJsonStrict, writeJsonAtomic } from './paths.mjs';
import { getState, mutate, uidFor } from './store.mjs';
import { backupFile } from './adapters.mjs';

const BEGIN = '# >>> xunlong-mcp >>>';
const END = '# <<< xunlong-mcp <<<';

function writeJson(file, data) {
  writeJsonAtomic(file, data);
}

function stripBlock(text) {
  const i = text.indexOf(BEGIN);
  if (i === -1) return text;
  const j = text.indexOf(END, i);
  if (j === -1) {
    throw new Error('Codex 配置里的 MCP 托管区块不完整（缺少结束标记），已中止写入，请先手动修复');
  }
  return (text.slice(0, i) + text.slice(j + END.length)).trim() + '\n';
}

function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function tomlHeaderName(line) {
  const m = line.match(/^\s*\[mcp_servers\.(?:"((?:[^"\\]|\\.)*)"|([A-Za-z0-9_-]+))(?:\.[^\]]*)?\]\s*$/);
  if (!m) return null;
  return m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2];
}

/** 删除 Codex 现有配置中与托管项同名的 mcp_servers 表（含子表），避免重复 TOML 表。 */
function removeCodexManagedSections(text, names) {
  if (!names.size) return text;
  const lines = text.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      const name = tomlHeaderName(line);
      skipping = Boolean(name && names.has(name));
      if (skipping) continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

function tomlKey(name) {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name);
}

function tomlValue(v) {
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(String(x))).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).map(([k, val]) => `${JSON.stringify(k)} = ${JSON.stringify(String(val))}`);
    return `{ ${entries.join(', ')} }`;
  }
  return JSON.stringify(String(v ?? ''));
}

export function listMcp() {
  return getState().mcpServers;
}

export function upsertMcp(input) {
  return mutate((state) => {
    const now = new Date().toISOString();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('MCP 名称不能为空');
    const duplicate = state.mcpServers.find((m) => m.name === name && m.id !== input.id);
    if (duplicate) throw new Error(`MCP 名称“${name}”已存在，请换一个名称`);
    const apps = Array.isArray(input.apps) ? input.apps : ['claude', 'codex', 'gemini', 'qwen'];
    if (input.id) {
      const idx = state.mcpServers.findIndex((m) => m.id === input.id);
      if (idx === -1) throw new Error('MCP 不存在');
      state.mcpServers[idx] = { ...state.mcpServers[idx], ...input, name, apps, updatedAt: now };
      return state.mcpServers[idx];
    }
    const item = {
      id: uidFor('mcp'),
      name,
      command: input.command || 'npx',
      args: Array.isArray(input.args) ? input.args : [],
      env: input.env && typeof input.env === 'object' ? input.env : {},
      enabled: input.enabled !== false,
      apps,
      note: input.note || '',
      createdAt: now,
      updatedAt: now,
    };
    state.mcpServers.push(item);
    return item;
  });
}

export function removeMcp(id) {
  return mutate((state) => {
    const before = state.mcpServers.length;
    state.mcpServers = state.mcpServers.filter((m) => m.id !== id);
    return before !== state.mcpServers.length;
  });
}

/** 把启用的 MCP 写入各 CLI 配置 */
export function applyMcp() {
  const state = getState();
  const list = state.mcpServers.filter((m) => m.enabled !== false);
  const previous = state.meta.mcpAppliedByApp && typeof state.meta.mcpAppliedByApp === 'object'
    ? state.meta.mcpAppliedByApp
    : {};
  const result = {};
  const namesFor = (app) => {
    const names = new Set();
    for (const item of state.mcpServers) {
      if (Array.isArray(item.apps) && item.apps.includes(app) && item.name) names.add(String(item.name));
    }
    for (const name of previous[app] || []) if (name) names.add(String(name));
    return names;
  };
  const serversFor = (app) => {
    const servers = {};
    for (const m of list) {
      if (Array.isArray(m.apps) && m.apps.includes(app) && m.name) {
        servers[m.name] = {
          command: m.command,
          args: Array.isArray(m.args) ? m.args : [],
          ...(m.env && Object.keys(m.env).length ? { env: m.env } : {}),
        };
      }
    }
    return servers;
  };
  const removeManaged = (servers, app) => {
    const out = { ...(servers || {}) };
    for (const name of namesFor(app)) delete out[name];
    return out;
  };

  // Claude Code
  const claude = readJsonStrict(CLI.claude.settings) || {};
  const claudeBefore = claude.mcpServers || {};
  const claudeServers = serversFor('claude');
  const claudeAfter = { ...removeManaged(claudeBefore, 'claude'), ...claudeServers };
  if (JSON.stringify(claudeBefore) !== JSON.stringify(claudeAfter)) {
    backupFile(CLI.claude.settings, 'claude-mcp');
    claude.mcpServers = claudeAfter;
    writeJson(CLI.claude.settings, claude);
  }
  result.claude = Object.keys(claudeServers).length;

  // Gemini CLI / Qwen Code（同为 settings.json 的 mcpServers）
  for (const appKey of ['gemini', 'qwen']) {
    const appCfg = CLI[appKey];
    const target = readJsonStrict(appCfg.settings) || {};
    const before = target.mcpServers || {};
    const servers = serversFor(appKey);
    const after = { ...removeManaged(before, appKey), ...servers };
    result[appKey] = Object.keys(servers).length;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    backupFile(appCfg.settings, `${appKey}-mcp`);
    target.mcpServers = after;
    writeJson(appCfg.settings, target);
  }

  // Codex CLI（托管区块；同时清理同名普通表，避免重复 TOML 表）
  let codexText = '';
  try {
    codexText = fs.readFileSync(CLI.codex.settings, 'utf8');
  } catch {}
  const codexList = list.filter((m) => Array.isArray(m.apps) && m.apps.includes('codex'));
  const codexNames = namesFor('codex');
  const hadCodexBlock = codexText.includes(BEGIN);
  if (codexList.length || hadCodexBlock || codexNames.size) {
    let text = stripBlock(codexText);
    text = removeCodexManagedSections(text, codexNames);
    if (codexList.length) {
      const block = [
        BEGIN,
        ...codexList.flatMap((m) => [
          `[mcp_servers.${tomlKey(m.name)}]`,
          `command = ${tomlValue(m.command)}`,
          `args = ${tomlValue(Array.isArray(m.args) ? m.args : [])}`,
          ...(m.env && Object.keys(m.env).length ? [`env = ${tomlValue(m.env)}`] : []),
          '',
        ]),
        END,
      ].join('\n');
      text = `${text.trim()}\n\n${block}\n`;
    } else {
      text = text.trim() ? `${text.trim()}\n` : '';
    }
    if (text !== codexText) {
      backupFile(CLI.codex.settings, 'codex-mcp');
      writeTextAtomic(CLI.codex.settings, text);
    }
    result.codex = codexList.length;
  } else {
    result.codex = 0;
  }

  mutate((next) => {
    next.meta.mcpAppliedByApp = {
      claude: Object.keys(serversFor('claude')),
      gemini: Object.keys(serversFor('gemini')),
      qwen: Object.keys(serversFor('qwen')),
      codex: codexList.map((m) => m.name),
    };
  });
  return result;
}

export function mcpTemplates() {
  return [
    {
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(process.env.USERPROFILE || '.', 'Desktop')],
      note: '读写本机文件系统（MCP 官方）',
    },
    {
      name: 'fetch',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      note: '抓取网页并转 Markdown',
    },
    {
      name: 'memory',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      note: '持久化记忆知识图谱',
    },
    {
      name: 'sequential-thinking',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      note: '结构化推理',
    },
  ];
}

/** 从各 CLI 现有配置里收集 MCP（用于「从应用导入」） */
export function collectFromApps() {
  const found = new Map();
  const add = (name, entry, app) => {
    const key = String(name || '').trim();
    if (!key || !entry?.command) return;
    if (!found.has(key)) {
      found.set(key, { name: key, command: entry.command || '', args: entry.args || [], env: entry.env || {}, apps: [] });
    }
    const item = found.get(key);
    if (!item.apps.includes(app)) item.apps.push(app);
  };

  for (const [appKey, cfg] of [
    ['claude', CLI.claude],
    ['gemini', CLI.gemini],
    ['qwen', CLI.qwen],
  ]) {
    const data = readJson(cfg.settings, {}) || {};
    for (const [name, entry] of Object.entries(data.mcpServers || {})) add(name, entry || {}, appKey);
  }

  let toml = '';
  try {
    toml = fs.readFileSync(CLI.codex.settings, 'utf8').replace(/^\uFEFF/, '');
  } catch {}
  const re = /\[mcp_servers\.("?)([^"\]]+)\1\]\s*\n([\s\S]*?)(?=\n\[|$)/g;
  let m;
  while ((m = re.exec(toml))) {
    const name = m[2];
    const block = m[3];
    const command = (block.match(/^\s*command\s*=\s*"([^"]*)"/m) || [])[1] || '';
    const argsRaw = (block.match(/^\s*args\s*=\s*\[([^\]]*)\]/m) || [])[1] || '';
    const args = [...argsRaw.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    add(name, { command, args }, 'codex');
  }
  return [...found.values()];
}

export function importMcpFromApps() {
  const found = collectFromApps();
  let added = 0;
  let merged = 0;
  mutate((state) => {
    for (const item of found) {
      const exist = state.mcpServers.find((x) => x.name === item.name);
      if (exist) {
        exist.apps = [...new Set([...(exist.apps || []), ...item.apps])];
        if (!exist.command && item.command) exist.command = item.command;
        merged += 1;
      } else {
        state.mcpServers.push({
          id: uidFor('mcp'),
          name: item.name,
          command: item.command || 'npx',
          args: item.args || [],
          env: item.env || {},
          enabled: true,
          apps: item.apps,
          note: '从应用配置导入',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        added += 1;
      }
    }
  });
  return { ok: true, added, merged, total: found.length };
}

/** 检查已启用 MCP 的命令是否存在 */
export function checkMcp() {
  return getState()
    .mcpServers.filter((m) => m.enabled !== false)
    .map((m) => {
      const cmd = m.command || '';
      let ok = false;
      try {
        if (cmd && (cmd.includes(path.sep) || cmd.includes('/'))) {
          ok = fs.existsSync(cmd) && fs.statSync(cmd).isFile();
        } else if (cmd) {
          execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [cmd], { stdio: 'ignore', timeout: 3000 });
          ok = true;
        }
      } catch {
        ok = false;
      }
      return { name: m.name, command: cmd, ok };
    });
}

