import fs from 'node:fs';
import path from 'node:path';
import { CLI, FILES, APP_ORDER, readJson, readJsonStrict, timestamp } from './paths.mjs';
import { parseJson5, parseToml, parseTomlHeaderPath, parseYaml } from './config-parse.mjs';

const TOOL_BEGIN = '# >>> xunlong-ai-manager >>>';
const TOOL_END = '# <<< xunlong-ai-manager <<<';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function backupFile(file, app) {
  if (!fs.existsSync(file)) return null;
  ensureDir(FILES.backups);
  const ext = path.extname(file) || '.bak';
  const dest = path.join(FILES.backups, `${app}-${timestamp()}${ext}.bak`);
  fs.copyFileSync(file, dest);
  // 只保留最近 30 份
  const all = fs
    .readdirSync(FILES.backups)
    .filter((f) => f.startsWith(`${app}-`))
    .sort();
  for (const old of all.slice(0, Math.max(0, all.length - 30))) {
    try {
      fs.unlinkSync(path.join(FILES.backups, old));
    } catch {}
  }
  return dest;
}

function writeText(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600);
  } catch {}
  fs.renameSync(tmp, file);
}

/** 读取文本并去掉 BOM（Windows 记事本/PowerShell 常见） */
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

function stripBlock(text, begin = TOOL_BEGIN, end = TOOL_END) {
  const i = text.indexOf(begin);
  if (i === -1) return text;
  const j = text.indexOf(end, i);
  if (j === -1) throw new Error('配置里的托管区块不完整（缺少结束标记），已中止写入，请先修复');
  return (text.slice(0, i) + text.slice(j + end.length)).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** 删除 TOML 中指定前缀的表（含子表），用于清理没有托管标记的旧表。 */
function removeTomlSections(text, shouldRemove) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let skip = false;
  for (const line of lines) {
    const m = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
    if (m) {
      let path = [];
      try {
        path = parseTomlHeaderPath(m[1]);
      } catch {}
      skip = path.length > 0 && shouldRemove(path);
      if (skip) continue;
    }
    if (!skip) out.push(line);
  }
  return out.join('\n');
}

function removeKimiManagedSections(text) {
  return removeTomlSections(
    text,
    (path) =>
      (path[0] === 'providers' && path[1] === 'xunlong') ||
      (path[0] === 'models' && typeof path[1] === 'string' && path[1].startsWith('xunlong/')),
  );
}

/** 将不同应用的 API 类型统一成面板里的三种协议。 */
function protocolFromApi(api) {
  const value = String(api || '').toLowerCase();
  if (/anthropic|claude/.test(value)) return 'anthropic';
  if (/google|gemini|vertex/.test(value)) return 'gemini';
  return 'openai';
}

function hostIs(baseUrl, hostname) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === hostname;
  } catch {
    return false;
  }
}

function safeJson5(text) {
  try {
    return parseJson5(text) || {};
  } catch {
    return {};
  }
}

function safeYaml(text) {
  try {
    return parseYaml(text) || {};
  } catch {
    return {};
  }
}

/** 某些应用允许配置文件放在多个位置（例如 Claude Desktop 的 3p 模式）。 */
function appConfigCandidates(app) {
  return [app?.settings, ...(app?.altSettings || [])].filter(Boolean);
}

function firstExisting(files) {
  return files.find((file) => fs.existsSync(file)) || files[0] || '';
}

function appDirCandidates(app) {
  return [app?.dir, ...(app?.altDirs || [])].filter(Boolean);
}

/* ---------------- Claude Code ---------------- */

function readClaude() {
  return readJsonStrict(CLI.claude.settings) || {};
}

function writeClaude(settings) {
  writeText(CLI.claude.settings, JSON.stringify(settings, null, 2));
}

export function currentClaude() {
  const s = readClaude();
  const env = s.env || {};
  return {
    baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    model: env.ANTHROPIC_MODEL || s.model || '',
    keyTail: env.ANTHROPIC_AUTH_TOKEN ? String(env.ANTHROPIC_AUTH_TOKEN).slice(-4) : '',
    source: '~/.claude/settings.json',
  };
}

export function applyClaude(provider) {
  backupFile(CLI.claude.settings, 'claude');
  const s = readClaude();
  const env = { ...(s.env || {}) };
  const official = !provider.baseUrl || hostIs(provider.baseUrl, 'api.anthropic.com');
  if (official) {
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_MODEL;
    delete env.ANTHROPIC_SMALL_FAST_MODEL;
  } else {
    env.ANTHROPIC_BASE_URL = provider.baseUrl.replace(/\/+$/, '');
    env.ANTHROPIC_AUTH_TOKEN = provider.apiKey || '';
    if (provider.model) env.ANTHROPIC_MODEL = provider.model;
    else delete env.ANTHROPIC_MODEL;
    const small = (provider.models || []).find((m) => /haiku|flash|air|small/i.test(m) && !/minimax/i.test(m));
    if (small) env.ANTHROPIC_SMALL_FAST_MODEL = small;
    else delete env.ANTHROPIC_SMALL_FAST_MODEL;
  }
  s.env = env;
  writeClaude(s);
  return { file: CLI.claude.settings, official };
}

/* ---------------- Codex CLI ---------------- */

function readCodexToml() {
  return readText(CLI.codex.settings);
}

export function currentCodex() {
  const toml = readCodexToml();
  const get = (re) => (toml.match(re) || [])[1] || '';
  return {
    baseUrl: get(/^\s*base_url\s*=\s*"([^"]+)"/m),
    model: get(/^\s*model\s*=\s*"([^"]+)"/m),
    keyTail: '',
    source: '~/.codex/config.toml',
  };
}

export function applyCodex(provider) {
  const previous = stripBlock(readCodexToml());
  const auth = readJsonStrict(CLI.codex.auth) || {};
  const lineStart = previous.search(/^\s*\[/m);
  const preamble = (lineStart === -1 ? previous : previous.slice(0, lineStart))
    .split(/\r?\n/)
    .filter((line) => !/^\s*(model_provider|model)\s*=/.test(line))
    .join('\n')
    .trimEnd();
  const tables = lineStart === -1 ? '' : previous.slice(lineStart).trimStart();

  backupFile(CLI.codex.settings, 'codex');
  backupFile(CLI.codex.auth, 'codex-auth');

  const block = [
    TOOL_BEGIN,
    'model_provider = "xunlong"',
    provider.model ? `model = ${JSON.stringify(provider.model)}` : '',
    '',
    '[model_providers.xunlong]',
    `name = ${JSON.stringify(provider.name || 'Xunlong')}`,
    `base_url = ${JSON.stringify((provider.baseUrl || '').replace(/\/+$/, ''))}`,
    'wire_api = "chat"',
    'env_key = "OPENAI_API_KEY"',
    TOOL_END,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const next = [preamble, block, tables].filter(Boolean).join('\n\n') + '\n';
  auth.OPENAI_API_KEY = provider.apiKey || '';
  writeText(CLI.codex.auth, JSON.stringify(auth, null, 2));
  writeText(CLI.codex.settings, next);
  return { file: CLI.codex.settings, auth: CLI.codex.auth };
}

/* ---------------- Gemini CLI ---------------- */

export function currentGemini() {
  let text = readText(CLI.gemini.env);
  const get = (k) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
  return {
    baseUrl: get('GOOGLE_GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com',
    model: get('GEMINI_MODEL') || '',
    keyTail: (get('GEMINI_API_KEY') || '').slice(-4),
    source: '~/.gemini/.env',
  };
}

export function applyGemini(provider) {
  backupFile(CLI.gemini.env, 'gemini');
  let text = readText(CLI.gemini.env);
  text = stripBlock(text);
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l && !/^(GEMINI_API_KEY|GOOGLE_GEMINI_BASE_URL|GEMINI_MODEL)=/.test(l));
  const official = !provider.baseUrl || hostIs(provider.baseUrl, 'generativelanguage.googleapis.com');
  const block = [
    TOOL_BEGIN,
    `GEMINI_API_KEY=${provider.apiKey || ''}`,
    official ? '' : `GOOGLE_GEMINI_BASE_URL=${provider.baseUrl.replace(/\/+$/, '')}`,
    provider.model ? `GEMINI_MODEL=${provider.model}` : '',
    TOOL_END,
  ]
    .filter(Boolean)
    .join('\n');
  writeText(CLI.gemini.env, [...lines, block, ''].join('\n'));
  return { file: CLI.gemini.env };
}

/* ---------------- OpenCode ---------------- */

export function currentOpencode() {
  const cfg = readJson(CLI.opencode.settings, {}) || {};
  const model = typeof cfg.model === 'string' ? cfg.model : '';
  const prov = cfg.provider?.xunlong || {};
  return {
    baseUrl: prov?.options?.baseURL || '',
    model: model.includes('/') ? model.split('/').slice(1).join('/') : model,
    keyTail: '',
    source: '~/.config/opencode/opencode.json',
  };
}

export function applyOpencode(provider) {
  const cfg = readJsonStrict(CLI.opencode.settings) || {};
  backupFile(CLI.opencode.settings, 'opencode');
  cfg.$schema = cfg.$schema || 'https://opencode.ai/config.json';
  cfg.provider = cfg.provider || {};
  const models = {};
  for (const m of provider.models?.length ? provider.models : [provider.model].filter(Boolean)) {
    models[m] = { name: m };
  }
  cfg.provider.xunlong = {
    npm: '@ai-sdk/openai-compatible',
    name: provider.name || 'Xunlong',
    options: {
      baseURL: (provider.baseUrl || '').replace(/\/+$/, ''),
      apiKey: provider.apiKey || '',
    },
    models,
  };
  if (provider.model) cfg.model = `xunlong/${provider.model}`;
  writeText(CLI.opencode.settings, JSON.stringify(cfg, null, 2));
  return { file: CLI.opencode.settings };
}

/* ---------------- Qwen Code（OpenAI 兼容 .env） ---------------- */

export function currentQwen() {
  let text = readText(CLI.qwen.env);
  const get = (k) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
  return {
    baseUrl: get('OPENAI_BASE_URL') || '',
    model: get('OPENAI_MODEL') || '',
    keyTail: (get('OPENAI_API_KEY') || '').slice(-4),
    source: '~/.qwen/.env',
  };
}

export function applyQwen(provider) {
  backupFile(CLI.qwen.env, 'qwen');
  let text = readText(CLI.qwen.env);
  text = stripBlock(text);
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l && !/^(OPENAI_API_KEY|OPENAI_BASE_URL|OPENAI_MODEL)=/.test(l));
  const block = [
    TOOL_BEGIN,
    `OPENAI_API_KEY=${provider.apiKey || ''}`,
    `OPENAI_BASE_URL=${(provider.baseUrl || '').replace(/\/+$/, '')}`,
    provider.model ? `OPENAI_MODEL=${provider.model}` : '',
    TOOL_END,
  ]
    .filter(Boolean)
    .join('\n');
  writeText(CLI.qwen.env, [...lines, block, ''].join('\n'));
  return { file: CLI.qwen.env };
}

/* ---------------- Kimi Code（config.toml） ---------------- */

function findTomlSection(parsed, pathParts) {
  return parsed.sections.find(
    (section) =>
      section.path.length === pathParts.length && section.path.every((part, index) => part === pathParts[index]),
  );
}

function readKimiConfig() {
  const text = readText(CLI.kimi.settings);
  const parsed = parseToml(text);
  const alias = String(parsed.top.default_model || '').trim();
  const modelSection = parsed.sections.find(
    (section) => section.path[0] === 'models' && section.path.length === 2 && section.path[1] === alias,
  );
  let providerId = String(modelSection?.values.provider || '');
  if (!providerId && alias.includes('/')) providerId = alias.split('/')[0];
  const providerSection = providerId ? findTomlSection(parsed, ['providers', providerId]) : null;
  const envSection = providerId ? findTomlSection(parsed, ['providers', providerId, 'env']) : null;
  const envKeyName = String(providerSection?.values.api_key_env || '');
  let apiKey = String(providerSection?.values.api_key || '');
  if (!apiKey && envKeyName) apiKey = String(process.env[envKeyName] || '');
  if (!apiKey && envSection) {
    apiKey = String(envSection.values.KIMI_API_KEY || envSection.values.OPENAI_API_KEY || '');
  }
  const model = String(
    modelSection?.values.model || (alias.includes('/') ? alias.split('/').slice(1).join('/') : alias),
  );
  return {
    alias,
    providerId,
    providerName: providerId || 'Kimi Code',
    model,
    baseUrl: String(providerSection?.values.base_url || modelSection?.values.base_url || ''),
    apiKey,
    type: String(providerSection?.values.type || 'openai'),
    source: CLI.kimi.settings,
  };
}

export function currentKimi() {
  const kimi = readKimiConfig();
  return {
    baseUrl: kimi.baseUrl,
    model: kimi.model,
    keyTail: kimi.apiKey ? kimi.apiKey.slice(-4) : '',
    provider: kimi.providerId,
    type: kimi.type,
    source: kimi.source,
  };
}

function setTomlTopLevel(text, key, value) {
  const line = `${key} = ${JSON.stringify(value)}`;
  const firstTable = text.search(/^\s*\[/m);
  const head = firstTable === -1 ? text : text.slice(0, firstTable);
  const tail = firstTable === -1 ? '' : text.slice(firstTable);
  const existing = new RegExp(`^${key}\\s*=.*$`, 'm');
  if (existing.test(head)) return `${head.replace(existing, line)}${tail}`;
  if (firstTable === -1) return `${line}\n${text}`;
  return `${head}${line}\n\n${tail}`;
}

export function applyKimi(provider) {
  const model = String(provider.model || provider.name || '').trim();
  if (!model) throw new Error('Kimi Code 需要填写模型名称');
  const models = [...new Set((provider.models?.length ? provider.models : [model]).filter(Boolean).map(String))];
  if (!models.includes(model)) models.unshift(model);

  backupFile(CLI.kimi.settings, 'kimi');
  let text = stripBlock(readText(CLI.kimi.settings));
  text = removeKimiManagedSections(text);
  const alias = `xunlong/${model}`;
  text = setTomlTopLevel(text, 'default_model', alias);

  const type =
    provider.protocol === 'anthropic' ? 'anthropic' : provider.protocol === 'gemini' ? 'google-genai' : 'openai';
  const providerBlock = [
    TOOL_BEGIN,
    '[providers."xunlong"]',
    `type = ${JSON.stringify(type)}`,
    `base_url = ${JSON.stringify((provider.baseUrl || '').replace(/\/+$/, ''))}`,
    `api_key = ${JSON.stringify(provider.apiKey || '')}`,
    '',
  ];
  const modelBlocks = models.flatMap((item) => [
    `[models.${JSON.stringify(`xunlong/${item}`)}]`,
    'provider = "xunlong"',
    `model = ${JSON.stringify(item)}`,
    'max_context_size = 262144',
    'capabilities = ["tool_use"]',
    '',
  ]);
  const block = [...providerBlock, ...modelBlocks, TOOL_END].join('\n');
  writeText(CLI.kimi.settings, `${text.trimEnd()}\n\n${block}\n`.replace(/^\n+/, ''));
  return { file: CLI.kimi.settings, alias, model, models };
}

/* ---------------- Grok Build（config.toml） ---------------- */

function tomlSetKeyInSection(text, section, key, value) {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((line) => line.replace(/\s*#.*$/, '').trim() === section);
  if (headerIdx === -1) {
    const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
    const insertAt = firstTable === -1 ? lines.length : firstTable;
    lines.splice(insertAt, 0, section, `${key} = ${JSON.stringify(value)}`, '');
    return lines.join('\n');
  }
  let end = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let replaced = false;
  for (let i = headerIdx + 1; i < end; i++) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[i])) {
      lines[i] = `${key} = ${JSON.stringify(value)}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) lines.splice(headerIdx + 1, 0, `${key} = ${JSON.stringify(value)}`);
  return lines.join('\n');
}

function tomlRemoveTable(text, header) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.replace(/\s*#.*$/, '').trim() === header);
  if (start === -1) return text;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  lines.splice(start, end - start);
  return lines.join('\n');
}

export function currentGrok() {
  const text = readText(CLI.grok.settings);
  const parsed = parseToml(text);
  const modelsSection = parsed.sections.find((s) => s.path.length === 1 && s.path[0] === 'models');
  const alias = String(modelsSection?.values.default || '');
  let baseUrl = '';
  let model = alias;
  if (alias) {
    const section = parsed.sections.find((s) => s.path.length === 2 && s.path[0] === 'model' && s.path[1] === alias);
    if (section) {
      baseUrl = String(section.values.base_url || '');
      model = String(section.values.model || alias);
    }
  }
  return { baseUrl, model, keyTail: '', source: '~/.grok/config.toml' };
}

export function applyGrok(provider) {
  backupFile(CLI.grok.settings, 'grok');
  let text = stripBlock(readText(CLI.grok.settings));
  const model = provider.model || provider.name || 'xunlong';
  const alias = 'xunlong';
  text = tomlRemoveTable(text, `[model.${JSON.stringify(alias)}]`);
  text = tomlSetKeyInSection(text, '[models]', 'default', alias);
  text = tomlSetKeyInSection(text, '[models]', 'session_summary', alias);
  const block = [
    TOOL_BEGIN,
    `[model.${JSON.stringify(alias)}]`,
    `model = ${JSON.stringify(model)}`,
    `base_url = ${JSON.stringify((provider.baseUrl || '').replace(/\/+$/, ''))}`,
    `name = ${JSON.stringify(provider.name || 'Xunlong')}`,
    'api_backend = "chat"',
    'context_window = 500000',
    `api_key = ${JSON.stringify(provider.apiKey || '')}`,
    TOOL_END,
  ].join('\n');
  writeText(CLI.grok.settings, `${text.trimEnd()}\n\n${block}\n`);
  return { file: CLI.grok.settings, alias, model };
}

/* ---------------- Pi（models.json + settings.json） ---------------- */

export function currentPi() {
  const models = readJson(CLI.pi.settings, {}) || {};
  const settings = readJson(CLI.pi.extra?.[0], {}) || {};
  const providerId = settings.defaultProvider || 'xunlong';
  const prov = models.providers?.[providerId] || {};
  return {
    baseUrl: prov.baseUrl || '',
    model: settings.defaultModel || '',
    keyTail: String(prov.apiKey || '').slice(-4),
    source: '~/.pi/agent/models.json',
  };
}

export function applyPi(provider) {
  const settingsFile = CLI.pi.extra?.[0];
  const settings = settingsFile && fs.existsSync(settingsFile) ? readJsonStrict(settingsFile) || {} : {};
  backupFile(CLI.pi.settings, 'pi');
  const models = readJsonStrict(CLI.pi.settings) || {};
  models.providers = models.providers || {};
  const model = provider.model || provider.name;
  const list = provider.models?.length ? provider.models : [model].filter(Boolean);
  models.providers.xunlong = {
    name: provider.name || 'Xunlong',
    baseUrl: (provider.baseUrl || '').replace(/\/+$/, ''),
    api: 'openai-completions',
    apiKey: provider.apiKey || '',
    models: list.map((m) => ({ id: m, name: m })),
  };
  writeText(CLI.pi.settings, JSON.stringify(models, null, 2));

  if (settingsFile) {
    backupFile(settingsFile, 'pi-settings');
    settings.defaultProvider = 'xunlong';
    if (model) settings.defaultModel = model;
    writeText(settingsFile, JSON.stringify(settings, null, 2));
  }
  return { file: CLI.pi.settings, settings: settingsFile };
}

/* ---------------- OMP（models.yml，极简 YAML 子集） ---------------- */

function yamlScalar(value) {
  if (typeof value !== 'string') return JSON.stringify(String(value ?? ''));
  const s = value;
  if (!s) return '""';
  if (/^(true|false|null|~|[-+]?\d+(\.\d+)?)$/i.test(s)) return JSON.stringify(s);
  if (/^[A-Za-z0-9_./@+()\-\u4e00-\u9fff ]+$/.test(s) && !/^\s/.test(s) && !s.includes(': ')) return s;
  return JSON.stringify(s);
}

function yamlUnquote(s) {
  const t = String(s || '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    try {
      return t.startsWith('"') ? JSON.parse(t) : t.slice(1, -1);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

function parseOmpProviders(text) {
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((line) => /^\s*providers:\s*$/.test(line));
  if (idx === -1) return null;
  const baseIndent = (lines[idx].match(/^(\s*)/) || ['', ''])[1];
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i += 1) {
    if (lines[i].trim() && (lines[i].match(/^(\s*)/) || ['', ''])[1].length <= baseIndent.length) {
      end = i;
      break;
    }
  }
  const body = lines.slice(idx + 1, end);
  const first = body.find((line) => line.trim());
  if (!first) return { providers: {}, before: lines.slice(0, idx).join('\n'), after: lines.slice(end).join('\n') };
  const childIndent = (first.match(/^(\s*)/) || ['', ''])[1];
  const fieldIndent = `${childIndent}  `;
  const providers = {};
  let cur = null;
  for (const line of body) {
    if (!line.trim()) continue;
    const indent = (line.match(/^(\s*)/) || ['', ''])[1];
    if (indent === childIndent) {
      const m = line.trim().match(/^(.+?):\s*$/);
      if (!m) return { unsupported: true };
      const id = yamlUnquote(m[1]);
      cur = { fields: {}, models: [] };
      providers[id] = cur;
      continue;
    }
    if (!cur) return { unsupported: true };
    if (indent === fieldIndent) {
      const model = line.trim().match(/^-\s*id:\s*(.*)$/);
      if (model) {
        cur.models.push({ id: yamlUnquote(model[1]) });
        continue;
      }
      const kv = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!kv) return { unsupported: true };
      if (kv[1] === 'models' && !kv[2]) continue;
      cur.fields[kv[1]] = yamlUnquote(kv[2]);
      continue;
    }
    if (indent === `${fieldIndent}  `) {
      const kv = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!kv) return { unsupported: true };
      const last = cur.models[cur.models.length - 1];
      if (!last) return { unsupported: true };
      last[kv[1]] = yamlUnquote(kv[2]);
      continue;
    }
    return { unsupported: true };
  }
  return { providers, before: lines.slice(0, idx).join('\n'), after: lines.slice(end).join('\n') };
}

function serializeOmpProviders(providers) {
  const out = ['providers:'];
  for (const [id, prov] of Object.entries(providers)) {
    out.push(`  ${yamlScalar(id)}:`);
    const fields = prov.fields || {};
    for (const [key, value] of Object.entries(fields)) {
      if (key !== 'models') out.push(`    ${key}: ${yamlScalar(value)}`);
    }
    const models = prov.models || [];
    if (models.length) {
      out.push('    models:');
      for (const m of models) {
        out.push(`    - id: ${yamlScalar(m.id)}`);
        for (const [key, value] of Object.entries(m)) {
          if (key !== 'id') out.push(`      ${key}: ${yamlScalar(value)}`);
        }
      }
    }
  }
  return out.join('\n');
}

export function currentOmp() {
  let text = readText(CLI.omp.settings);
  const parsed = parseOmpProviders(text);
  if (!parsed || parsed.unsupported) {
    return { baseUrl: '', model: '', keyTail: '', source: '~/.omp/agent/models.yml' };
  }
  const prov = parsed.providers.xunlong || Object.values(parsed.providers)[0] || {};
  return {
    baseUrl: prov.fields?.baseUrl || '',
    model: prov.models?.[0]?.id || '',
    keyTail: String(prov.fields?.apiKey || '').slice(-4),
    source: '~/.omp/agent/models.yml',
  };
}

export function applyOmp(provider) {
  backupFile(CLI.omp.settings, 'omp');
  let text = readText(CLI.omp.settings);

  const model = provider.model || provider.name;
  const list = provider.models?.length ? provider.models : [model].filter(Boolean);
  const entry = {
    fields: {
      baseUrl: (provider.baseUrl || '').replace(/\/+$/, ''),
      api: 'openai-completions',
      apiKey: provider.apiKey || '',
    },
    models: list.map((m) => ({ id: m, name: m })),
  };

  const parsed = parseOmpProviders(text);
  if (parsed?.unsupported) {
    throw new Error('OMP 的 models.yml 含暂不支持的嵌套/缩进结构，已中止写入以避免丢失配置');
  }
  if (parsed) {
    parsed.providers.xunlong = entry;
    const body = serializeOmpProviders(parsed.providers);
    const before = parsed.before.trim();
    const after = parsed.after.trim();
    writeText(CLI.omp.settings, [before, body, after].filter(Boolean).join('\n') + '\n');
  } else {
    if (/^\s*providers:\s*\{\s*\}\s*$/m.test(text)) {
      throw new Error('OMP 的 models.yml 使用内联 providers 结构，已中止写入以避免重复键');
    }
    writeText(CLI.omp.settings, `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${serializeOmpProviders({ xunlong: entry })}\n`);
  }
  return { file: CLI.omp.settings };
}

/* ---------------- 只读应用：OpenClaw / Hermes / MiniMax / Claude Desktop ---------------- */

function resolveSecret(value, envName) {
  const direct = typeof value === 'string' ? value : '';
  if (direct) {
    const ref = direct.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}$/);
    if (ref) return String(process.env[ref[1]] || ref[2] || '');
    if (/^[A-Z_][A-Z0-9_]{2,}$/.test(direct) && process.env[direct]) return String(process.env[direct]);
    return direct;
  }
  if (envName) return String(process.env[String(envName)] || '');
  return '';
}

function readDesktopConfig() {
  for (const file of appConfigCandidates(CLI.claudeDesktop)) {
    if (!fs.existsSync(file)) continue;
    try {
      const value = readJsonStrict(file);
      if (value && typeof value === 'object') return { value, file };
    } catch {
      // 配置损坏时继续尝试其它候选路径；读取失败不应影响应用探测。
    }
  }
  return { value: {}, file: firstExisting(appConfigCandidates(CLI.claudeDesktop)) };
}

export function currentClaudeDesktop() {
  const { value, file } = readDesktopConfig();
  const hasAccount =
    Boolean(value && typeof value === 'object') &&
    ['account', 'oauth', 'user', 'model', 'apiKey'].some((key) => key in value);
  return {
    baseUrl: '',
    model: '',
    provider: hasAccount ? 'Claude 账号' : '',
    keyTail: '',
    source: file,
  };
}

function readOpenClawConfig() {
  return safeJson5(readText(firstExisting(appConfigCandidates(CLI.openclaw))));
}

export function activeOpenClaw() {
  const cfg = readOpenClawConfig();
  const providers = cfg?.models?.providers && typeof cfg.models.providers === 'object' ? cfg.models.providers : {};
  const primary = cfg?.agents?.defaults?.model?.primary || cfg?.agents?.defaults?.model || '';
  const primaryText = typeof primary === 'string' ? primary : '';
  const splitAt = primaryText.indexOf('/');
  let providerId = splitAt > 0 ? primaryText.slice(0, splitAt) : '';
  let model = splitAt > 0 ? primaryText.slice(splitAt + 1) : '';
  if (!providerId && primary && typeof primary === 'object') {
    providerId = String(primary.provider || '');
    model = String(primary.model || primary.name || '');
  }
  if (!providerId) providerId = Object.keys(providers)[0] || '';
  const provider = providers[providerId] || {};
  if (!model) {
    const firstModel = Array.isArray(provider.models) ? provider.models[0] : null;
    model = String(firstModel?.id || firstModel?.name || '');
  }
  if (!providerId) return null;
  return {
    providerId,
    providerName: String(provider.name || providerId),
    baseUrl: String(provider.baseUrl || provider.base_url || ''),
    apiKey: resolveSecret(provider.apiKey || provider.api_key, provider.api_key_env),
    protocol: protocolFromApi(provider.api),
    model,
    source: firstExisting(appConfigCandidates(CLI.openclaw)),
  };
}

export function currentOpenClaw() {
  const active = activeOpenClaw();
  if (!active) return null;
  return {
    baseUrl: active.baseUrl,
    model: active.model,
    keyTail: active.apiKey ? active.apiKey.slice(-4) : '',
    provider: active.providerName,
    source: active.source,
  };
}

function readHermesConfig() {
  return safeYaml(readText(firstExisting(appConfigCandidates(CLI.hermes))));
}

export function activeHermes() {
  const cfg = readHermesConfig();
  const scalarModel = typeof cfg?.model === 'string' ? cfg.model : '';
  const modelCfg = cfg?.model && typeof cfg.model === 'object' ? cfg.model : {};
  let providerId = String(modelCfg.provider || '');
  let provider = null;
  if (cfg?.providers && typeof cfg.providers === 'object' && providerId) {
    provider = cfg.providers[providerId] || null;
  }
  if (!provider && Array.isArray(cfg?.custom_providers)) {
    provider =
      cfg.custom_providers.find((item) => [item?.name, item?.id, item?.provider].includes(providerId)) ||
      (providerId ? null : cfg.custom_providers[0] || null);
    if (!providerId && provider) providerId = String(provider.name || provider.id || 'custom');
  }
  if (!providerId && scalarModel) {
    providerId = 'custom';
    provider = Array.isArray(cfg?.custom_providers) ? cfg.custom_providers[0] || null : null;
  }
  if (!providerId) return null;
  const apiValue = String(provider?.api || '');
  const baseUrl =
    String(provider?.base_url || provider?.baseUrl || (apiValue.startsWith('http') ? apiValue : '') || modelCfg.base_url || '');
  const apiKey = resolveSecret(provider?.api_key || provider?.apiKey, provider?.key_env);
  return {
    providerId,
    providerName: String(provider?.name || providerId),
    baseUrl,
    apiKey,
    protocol: protocolFromApi(provider?.api_mode || modelCfg.api_mode || (apiValue.startsWith('http') ? '' : apiValue)),
    model: String(scalarModel || modelCfg.default || modelCfg.model || ''),
    source: firstExisting(appConfigCandidates(CLI.hermes)),
  };
}

export function currentHermes() {
  const active = activeHermes();
  if (!active) return null;
  return {
    baseUrl: active.baseUrl,
    model: active.model,
    keyTail: active.apiKey ? active.apiKey.slice(-4) : '',
    provider: active.providerName,
    source: active.source,
  };
}

function readMinimaxConfig() {
  return safeYaml(readText(firstExisting(appConfigCandidates(CLI.minimax))));
}

export function activeMinimax() {
  const cfg = readMinimaxConfig();
  const providers = cfg?.custom_provider && typeof cfg.custom_provider === 'object' ? cfg.custom_provider : {};
  const selected = String(cfg?.defaultModel || '');
  let providerId = '';
  let model = '';
  if (selected.startsWith('custom_provider:')) {
    const rest = selected.slice('custom_provider:'.length);
    const splitAt = rest.indexOf('/');
    providerId = splitAt >= 0 ? rest.slice(0, splitAt) : rest;
    model = splitAt >= 0 ? rest.slice(splitAt + 1) : '';
  } else if (selected.includes('/')) {
    const splitAt = selected.indexOf('/');
    providerId = selected.slice(0, splitAt);
    model = selected.slice(splitAt + 1);
  }
  if (!providerId) providerId = Object.keys(providers)[0] || '';
  const provider = providers[providerId] || {};
  if (!providerId) return null;
  if (!model) {
    const models = provider.models;
    if (Array.isArray(models)) model = String(models[0]?.id || models[0]?.name || models[0] || '');
    else model = String(Object.keys(models || {})[0] || '');
  }
  return {
    providerId,
    providerName: String(provider.name || providerId),
    baseUrl: String(provider.options?.baseURL || provider.options?.baseUrl || provider.baseUrl || ''),
    apiKey: resolveSecret(provider.options?.apiKey || provider.apiKey),
    protocol: protocolFromApi(provider.api),
    model,
    source: firstExisting(appConfigCandidates(CLI.minimax)),
  };
}

export function currentMinimax() {
  const active = activeMinimax();
  if (!active) return null;
  return {
    baseUrl: active.baseUrl,
    model: active.model,
    keyTail: active.apiKey ? active.apiKey.slice(-4) : '',
    provider: active.providerName,
    source: active.source,
  };
}

/* ---------------- DeepSeek Harness（cordis.patch.yml） ---------------- */

const DSH_PATCH = CLI.dsh.dshPatch;
const DSH_CRED = CLI.dsh.credentials;

function dshSegment(text, id) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `- id: ${id}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^- id: /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end, lines };
}

export function currentDsh() {
  const text = readText(DSH_PATCH);
  const seg = dshSegment(text, 'agent-default-model');
  let provider = '';
  let model = '';
  if (seg) {
    const body = seg.lines.slice(seg.start, seg.end).join('\n');
    provider = (body.match(/^\s+provider:\s*(.+)$/m) || [])[1]?.trim() || '';
    model = (body.match(/^\s+model:\s*(.+)$/m) || [])[1]?.trim() || '';
  }
  let baseUrl = '';
  if (provider) {
    const lines = text.split(/\r?\n/);
    const pIdx = lines.findIndex((l) => new RegExp('^      ' + provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*$').test(l));
    if (pIdx >= 0) {
      for (let i = pIdx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^      \S/.test(l) || /^- /.test(l)) break;
        const m = l.match(/^        baseURL:\s*"?([^"\n]+)"?\s*$/);
        if (m) {
          baseUrl = m[1].trim();
          break;
        }
      }
    }
  }
  return { baseUrl, model, provider, keyTail: '', source: '~/.dsh/profiles/desktop/cordis.patch.yml' };
}

export function applyDsh(provider) {
  backupFile(DSH_PATCH, 'dsh');
  backupFile(DSH_CRED, 'dsh-creds');
  let text = readText(DSH_PATCH);
  if (!text) throw new Error('未找到 DSH 的 cordis.patch.yml');

  const seg = dshSegment(text, 'agent-default-model');
  if (!seg) throw new Error('未找到 agent-default-model 配置段，已中止');

  const model = provider.model || provider.name;
  for (let i = seg.start; i < seg.end; i++) {
    const line = seg.lines[i];
    if (/^(\s+)provider:\s*/.test(line)) seg.lines[i] = line.replace(/^(\s+)provider:.*$/, '$1provider: xunlong');
    else if (/^(\s+)model:\s*/.test(line)) seg.lines[i] = line.replace(/^(\s+)model:.*$/, `$1model: ${JSON.stringify(model)}`);
  }
  text = seg.lines.join('\n');

  const modelList = (provider.models?.length ? provider.models : [model]).filter(Boolean);
  const lines = text.split(/\r?\n/);
  const providersLine = lines.findIndex((line) => /^\s*providers:\s*$/.test(line));
  const existingStart = lines.findIndex((line) => /^(\s+)xunlong:\s*$/.test(line));
  const providerIndent = existingStart >= 0
    ? (lines[existingStart].match(/^(\s+)/) || [])[1]
    : providersLine >= 0
      ? `${(lines[providersLine].match(/^(\s*)/) || [])[1]}  `
      : '';
  if (!providerIndent) throw new Error('未找到 DSH providers 配置段，无法安全写入 xunlong 供应商');
  const childIndent = `${providerIndent}  `;
  const blockLines = [
    `${providerIndent}xunlong:`,
    `${childIndent}api: ${provider.protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions'}`,
    `${childIndent}models:`,
    ...modelList.flatMap((m) => [
      `${childIndent}- id: ${JSON.stringify(m)}`,
      `${childIndent}  input:`,
      `${childIndent}  - text`,
    ]),
    `${childIndent}displayName: ${JSON.stringify(provider.name || 'Xunlong')}`,
    `${childIndent}baseURL: ${JSON.stringify((provider.baseUrl || '').replace(/\/+$/, ''))}`,
    `${childIndent}apiKeyEnv: XUNLONG_DSH_KEY`,
    `${childIndent}headers: {}`,
  ];
  if (existingStart >= 0) {
    let end = existingStart + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim() && (line.match(/^\s*/) || [''])[0].length <= providerIndent.length) break;
      end += 1;
    }
    lines.splice(existingStart, end - existingStart, ...blockLines);
  } else {
    let insertAt = providersLine + 1;
    while (insertAt < lines.length) {
      const line = lines[insertAt];
      if (line.trim() && (line.match(/^\s*/) || [''])[0].length <= (lines[providersLine].match(/^(\s*)/) || ['', ''])[1].length) break;
      insertAt += 1;
    }
    lines.splice(insertAt, 0, ...blockLines);
  }
  text = lines.join('\n');
  writeText(DSH_PATCH, text);

  const key = provider.apiKey || '';
  let creds = readText(DSH_CRED);
  if (!creds) creds = 'version: 1\nrefs:\n';
  const keyLine = `${yamlScalar(key)}`;
  if (/^\s*XUNLONG_DSH_KEY:/m.test(creds)) {
    creds = creds.replace(/^(\s*XUNLONG_DSH_KEY:).*$/m, `$1 ${keyLine}`);
  } else if (/^refs:\s*$/m.test(creds)) {
    creds = creds.replace(/^refs:\s*$/m, `refs:\n  XUNLONG_DSH_KEY: ${keyLine}`);
  } else if (/^refs:\s*\{\s*\}\s*$/m.test(creds)) {
    creds = creds.replace(/^refs:\s*\{\s*\}\s*$/m, `refs:\n  XUNLONG_DSH_KEY: ${keyLine}`);
  } else {
    creds = `${creds.trimEnd()}\nrefs:\n  XUNLONG_DSH_KEY: ${keyLine}\n`;
  }
  writeText(DSH_CRED, creds);

  return { file: DSH_PATCH, credentials: DSH_CRED, model };
}

/* ---------------- 统一入口 ---------------- */


const APPLIERS = {
  claude: applyClaude,
  codex: applyCodex,
  gemini: applyGemini,
  qwen: applyQwen,
  kimi: applyKimi,
  opencode: applyOpencode,
  grok: applyGrok,
  dsh: applyDsh,
  pi: applyPi,
  omp: applyOmp,
};

const CURRENTS = {
  claude: currentClaude,
  codex: currentCodex,
  gemini: currentGemini,
  qwen: currentQwen,
  kimi: currentKimi,
  opencode: currentOpencode,
  grok: currentGrok,
  dsh: currentDsh,
  pi: currentPi,
  omp: currentOmp,
  claudeDesktop: currentClaudeDesktop,
  openclaw: currentOpenClaw,
  hermes: currentHermes,
  minimax: currentMinimax,
};

export function applyProvider(provider) {
  const fn = APPLIERS[provider.app];
  if (!fn) throw new Error(`不支持的应用：${provider.app}`);
  if (['opencode', 'pi', 'omp', 'grok'].includes(provider.app) && provider.protocol !== 'openai') {
    throw new Error(`${CLI[provider.app].label} 当前适配器只支持 OpenAI 兼容协议，请把协议改为 OpenAI`);
  }
  return fn(provider);
}

export function readCurrent(app) {
  const fn = CURRENTS[app];
  if (!fn) return null;
  try {
    return fn();
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

/** 探测本机 CLI 安装与当前配置 */
export function detectApps() {
  return APP_ORDER.map((k) => CLI[k]).filter(Boolean).map((app) => {
    const configs = appConfigCandidates(app);
    const dirs = appDirCandidates(app);
    const configPath = firstExisting(configs);
    const configExists = configs.some((file) => fs.existsSync(file));
    const dirExists = dirs.some((dir) => fs.existsSync(dir));
    return {
      key: app.key,
      label: app.label,
      installed: configExists || dirExists,
      readOnly: Boolean(app.readOnly),
      configPath,
      protocol: app.protocol,
      strategy: app.strategy,
      current: readCurrent(app.key),
      docs: app.docs,
    };
  });
}

/* ---------------- 读取当前生效的供应商（用于扫描导入） ---------------- */

export function readActiveProvider(appKey) {
  const app = CLI[appKey];
  if (!app) return null;
  try {
    if (appKey === 'claude') {
      const s = readJsonStrict(CLI.claude.settings) || {};
      const env = s.env || {};
      return {
        app: 'claude',
        protocol: 'anthropic',
        name: 'Claude Code · 当前配置',
        baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
        apiKey: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '',
        model: env.ANTHROPIC_MODEL || s.model || '',
        source: CLI.claude.settings,
      };
    }
    if (appKey === 'codex') {
      if (!fs.existsSync(CLI.codex.settings)) return null;
      let toml = '';
      try {
        toml = fs.readFileSync(CLI.codex.settings, 'utf8');
      } catch {}
      const get = (re) => (toml.match(re) || [])[1] || '';
      const auth = readJson(CLI.codex.auth, {}) || {};
      return {
        app: 'codex',
        protocol: 'openai',
        name: 'Codex CLI · 当前配置',
        baseUrl: get(/^\s*base_url\s*=\s*"([^"]+)"/m) || 'https://api.openai.com/v1',
        apiKey: auth.OPENAI_API_KEY || '',
        model: get(/^\s*model\s*=\s*"([^"]+)"/m),
        source: CLI.codex.settings,
      };
    }
    if (appKey === 'gemini' || appKey === 'qwen') {
      const envFile = app.env;
      if (!fs.existsSync(envFile)) return null;
      let text = '';
      try {
        text = fs.readFileSync(envFile, 'utf8');
      } catch {}
      const get = (k) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
      if (appKey === 'gemini') {
        return {
          app: 'gemini',
          protocol: 'gemini',
          name: 'Gemini CLI · 当前配置',
          baseUrl: get('GOOGLE_GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com',
          apiKey: get('GEMINI_API_KEY'),
          model: get('GEMINI_MODEL'),
          source: envFile,
        };
      }
      return {
        app: 'qwen',
        protocol: 'openai',
        name: 'Qwen Code · 当前配置',
        baseUrl: get('OPENAI_BASE_URL'),
        apiKey: get('OPENAI_API_KEY'),
        model: get('OPENAI_MODEL'),
        source: envFile,
      };
    }
    if (appKey === 'opencode') {
      const cfg = readJson(CLI.opencode.settings, {}) || {};
      const active = String(cfg.model || '');
      const [provId, ...rest] = active.split('/');
      const prov = cfg.provider?.[provId] || cfg.provider?.xunlong || {};
      return {
        app: 'opencode',
        protocol: 'openai',
        name: `OpenCode · ${prov.name || provId || '当前配置'}`,
        baseUrl: prov.options?.baseURL || '',
        apiKey: prov.options?.apiKey || '',
        model: rest.join('/') || '',
        source: CLI.opencode.settings,
      };
    }
    if (appKey === 'grok') {
      let text = '';
      try {
        text = fs.readFileSync(CLI.grok.settings, 'utf8');
      } catch {}
      const model = (text.match(/\[models\][\s\S]*?^\s*default\s*=\s*"([^"]*)"/m) || [])[1] || '';
      let section = '';
      if (model) {
        const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        section = (text.match(new RegExp(`\\[model\\."${escaped}"\\]([\\s\\S]*?)(?=\\n\\[|$)`)) || [])[1] || '';
      }
      return {
        app: 'grok',
        protocol: 'openai',
        name: 'Grok Build · 当前配置',
        baseUrl: (section.match(/base_url\s*=\s*"([^"]*)"/) || [])[1] || '',
        apiKey: (section.match(/api_key\s*=\s*"([^"]*)"/) || [])[1] || '',
        model,
        source: CLI.grok.settings,
      };
    }
    if (appKey === 'pi') {
      const models = readJson(CLI.pi.settings, {}) || {};
      const settings = readJson(CLI.pi.extra?.[0], {}) || {};
      const prov = models.providers?.[settings.defaultProvider] || {};
      return {
        app: 'pi',
        protocol: 'openai',
        name: `Pi · ${prov.name || '当前配置'}`,
        baseUrl: prov.baseUrl || '',
        apiKey: prov.apiKey || '',
        model: settings.defaultModel || '',
        source: CLI.pi.settings,
      };
    }
    if (appKey === 'omp') {
      let text = '';
      try {
        text = fs.readFileSync(CLI.omp.settings, 'utf8');
      } catch {}
      const parsed = parseOmpProviders(text);
      if (!parsed || parsed.unsupported) return null;
      const prov = parsed.providers?.xunlong || Object.values(parsed.providers || {})[0] || {};
      return {
        app: 'omp',
        protocol: 'openai',
        name: `OMP · 当前配置`,
        baseUrl: prov.fields?.baseUrl || '',
        apiKey: prov.fields?.apiKey || '',
        model: prov.models?.[0]?.id || '',
        source: CLI.omp.settings,
      };
    }
    if (appKey === 'dsh') {
      const current = currentDsh();
      if (!current.provider && !current.baseUrl) return null;
      const creds = readText(DSH_CRED);
      const key = (creds.match(/^\s*XUNLONG_DSH_KEY:\s*(.*)$/m) || [])[1] || '';
      return {
        app: 'dsh',
        protocol: 'openai',
        name: `DSH · ${current.provider || '当前配置'}`,
        baseUrl: current.baseUrl,
        apiKey: yamlUnquote(key),
        model: current.model,
        source: DSH_PATCH,
      };
    }
    if (appKey === 'kimi') {
      const kimi = readKimiConfig();
      if (!kimi.model && !kimi.baseUrl && !kimi.apiKey) return null;
      return {
        app: 'kimi',
        protocol: kimi.type === 'anthropic' ? 'anthropic' : kimi.type === 'google-genai' ? 'gemini' : 'openai',
        name: `Kimi Code · ${kimi.providerId || '当前配置'}`,
        baseUrl: kimi.baseUrl,
        apiKey: kimi.apiKey,
        model: kimi.model,
        source: kimi.source,
      };
    }
    if (appKey === 'openclaw' || appKey === 'hermes' || appKey === 'minimax') {
      const active =
        appKey === 'openclaw' ? activeOpenClaw() : appKey === 'hermes' ? activeHermes() : activeMinimax();
      if (!active) return null;
      return {
        app: appKey,
        protocol: active.protocol,
        name: `${CLI[appKey].label} · ${active.providerName}`,
        baseUrl: active.baseUrl,
        apiKey: active.apiKey,
        model: active.model,
        source: active.source,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/* ---------------- 连通性 / 模型探测 ---------------- */

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

export async function fetchModels(provider, timeoutMs = 15000) {
  const { signal, done } = withTimeout(timeoutMs);
  const base = (provider.baseUrl || '').replace(/\/+$/, '');
  const withVersion = (suffix) => `${base}${new RegExp(`/${suffix}$`, 'i').test(base) ? '' : `/${suffix}`}`;
  try {
    if (provider.protocol === 'anthropic') {
      const res = await fetch(`${withVersion('v1')}/models`, {
        headers: {
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.data || []).map((m) => m.id);
    }
    if (provider.protocol === 'gemini') {
      const res = await fetch(`${withVersion('v1beta')}/models`, {
        headers: { 'x-goog-api-key': provider.apiKey },
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.models || []).map((m) => m.name.replace(/^models\//, ''));
    }
    const res = await fetch(`${withVersion('v1')}/models`, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.data || data.models || []).map((m) => m.id || m.name);
  } finally {
    done();
  }
}

export async function testProvider(provider) {
  const started = Date.now();
  try {
    const models = await fetchModels(provider, 20000);
    return {
      ok: true,
      latency: Date.now() - started,
      models: models.slice(0, 200),
      count: models.length,
    };
  } catch (err) {
    return { ok: false, latency: Date.now() - started, error: String(err.message || err) };
  }
}


