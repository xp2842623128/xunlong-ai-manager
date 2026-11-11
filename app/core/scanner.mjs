import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CLI, HOME, EXTRA_SESSION_ROOTS } from './paths.mjs';
import { readActiveProvider } from './adapters.mjs';

const exec = promisify(execFile);

const AI_NAME_RE =
  /claude|chatgpt|openai|cursor|windsurf|codebuddy|qoder|manus|cherry\s*studio|chatbox|lm\s*studio|ollama|dify|anythingllm|msty|open\s*webui|kimi|moonshot|豆包|doubao|通义|qwen|文心|ernie|讯飞|iflytek|智谱|chatglm|trae|comate|lingma|灵码|codegeex|codeium|tabnine|continue|jan\.ai|gpt4all|localai|vllm|sillytavern|openclaw|workbuddy|antigravity|grok|perplexity|mistral|poe|monica|sider|deepseek|aider|cline|roo\s*code|bolt|v0|replit/i;

const EXTRA_BINS = [
  'kimi',
  'copilot',
  'iflow',
  'codebuddy',
  'cursor-agent',
  'qoder',
  'manus',
  'aider',
  'aichat',
  'ollama',
];

let cache = null;
let cachedAt = 0;

async function which(bin) {
  try {
    const { stdout } = await exec(process.platform === 'win32' ? 'where.exe' : 'which', [bin], {
      timeout: 4000,
      windowsHide: true,
    });
    return String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

function registryUninstallKeys() {
  return [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
}

function parseRegBlocks(stdout) {
  const apps = [];
  let cur = null;
  for (const raw of String(stdout).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^HKEY_/i.test(line)) {
      if (cur) apps.push(cur);
      cur = { key: line };
      continue;
    }
    const m = line.match(/^(\S+)\s+REG_\w+\s+(.*)$/);
    if (m && cur) cur[m[1]] = m[2];
  }
  if (cur) apps.push(cur);
  return apps;
}

function decodeWindowsOutput(buffer) {
  if (!Buffer.isBuffer(buffer)) return String(buffer || '');
  try {
    return new TextDecoder('gbk').decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

async function scanRegistry() {
  const out = [];
  for (const root of registryUninstallKeys()) {
    try {
      const { stdout } = await exec('reg.exe', ['query', root, '/s'], {
        timeout: 12000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        encoding: 'buffer',
      });
      for (const item of parseRegBlocks(decodeWindowsOutput(stdout))) {
        const name = item.DisplayName;
        if (!name || !AI_NAME_RE.test(name)) continue;
        out.push({
          name,
          version: item.DisplayVersion || '',
          publisher: item.Publisher || '',
          location: item.InstallLocation || '',
          source: 'registry',
        });
      }
    } catch {}
  }
  return out;
}

function scanStartMenu() {
  const dirs = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : '',
  ].filter(Boolean);
  const out = [];
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    const stack = [{ d: dir, depth: 0 }];
    while (stack.length && out.length < 80) {
      const { d, depth } = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory() && depth < 3) stack.push({ d: full, depth: depth + 1 });
        else if (e.isFile() && e.name.toLowerCase().endsWith('.lnk')) {
          const name = e.name.replace(/\.lnk$/i, '');
          if (AI_NAME_RE.test(name)) out.push({ name, source: 'startmenu', location: '' });
        }
      }
    }
  }
  return out;
}

function dedupeDesktop(list) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+\d+(\.\d+)*\s*$/, '').replace(/\s*[-\u2013\u2014]\s*v?\d+(\.\d+)*\s*$/, '').replace(/\s+/g, ' ').trim();
  const seen = new Map();
  for (const item of list) {
    const key = norm(item.name);
    const display = item.name.replace(/\s+v?\d+(\.\d+)*$/, '').trim() || item.name;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, { ...item, name: display });
      continue;
    }
    if (!prev.version && item.version) prev.version = item.version;
    if (!prev.location && item.location) prev.location = item.location;
    if (!prev.publisher && item.publisher) prev.publisher = item.publisher;
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function scanAll({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < 30000) return cache;

  const apps = [];
  for (const app of Object.values(CLI)) {
    const configFiles = [app.settings, ...(app.altSettings || [])].filter(Boolean);
    const dirs = [app.dir, ...(app.altDirs || [])].filter(Boolean);
    const configPath = configFiles.find((file) => fs.existsSync(file)) || app.settings;
    const configExists = configFiles.some((file) => fs.existsSync(file));
    const dirExists = dirs.some((dir) => fs.existsSync(dir));
    const binPath = await which(app.bin);
    const installed = dirExists || configExists || Boolean(binPath);
    let active = null;
    if (installed) {
      try {
        active = readActiveProvider(app.key);
      } catch {
        active = null;
      }
    }
    const activeBase = active?.baseUrl || '';
    const defaultOnly =
      !active?.apiKey &&
      /^https:\/\/(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com)(\/|$)/i.test(activeBase);
    apps.push({
      key: app.key,
      label: app.label,
      installed,
      binPath: binPath || '',
      configPath,
      hasConfig: configExists,
      readOnly: Boolean(app.readOnly),
      active,
      candidate:
        active && (active.apiKey || activeBase) && !defaultOnly
          ? {
              app: app.key,
              name: active.name,
              protocol: active.protocol,
              baseUrl: activeBase,
              apiKey: active.apiKey || '',
              model: active.model || '',
              source: active.source,
            }
          : null,
    });
  }

  const unsupported = [];
  for (const bin of EXTRA_BINS) {
    if (CLI[bin]) continue;
    const binPath = await which(bin);
    if (binPath) {
      const known = EXTRA_SESSION_ROOTS.find((r) => r.app === bin.replace(/-agent$/, ''));
      unsupported.push({ name: known?.label || bin, binPath });
    }
  }
  for (const root of EXTRA_SESSION_ROOTS) {
    if (CLI[root.app]) continue;
    if (fs.existsSync(root.dir)) {
      const binPath = unsupported.find((u) => u.name === root.label)?.binPath || '';
      if (!unsupported.some((u) => u.name === root.label)) unsupported.push({ name: root.label, binPath });
    }
  }

  const desktop = dedupeDesktop([...(await scanRegistry()), ...scanStartMenu()]);

  cache = {
    scannedAt: new Date().toISOString(),
    apps,
    candidates: apps.filter((a) => a.candidate).map((a) => a.candidate),
    unsupported,
    desktop,
    summary: {
      installed: apps.filter((a) => a.installed).length,
      withConfig: apps.filter((a) => a.hasConfig).length,
      importable: apps.filter((a) => a.candidate).length,
      desktop: desktop.length,
      unsupported: unsupported.length,
    },
  };
  cachedAt = Date.now();
  return cache;
}

export function clearScanCache() {
  cache = null;
  cachedAt = 0;
}
