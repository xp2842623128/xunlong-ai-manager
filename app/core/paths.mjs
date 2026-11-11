import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const HOME = os.homedir();
export const APP_NAME = '迅龙AI管家';
export const APP_ID = 'cn.xunlong.aimanager';

/** 数据目录：优先环境变量，其次 %APPDATA%\XunlongAIManager */
export const DATA_DIR =
  process.env.XUNLONG_DATA_DIR ||
  path.join(process.env.APPDATA || path.join(HOME, '.config'), 'XunlongAIManager');

export const FILES = {
  config: path.join(DATA_DIR, 'config.json'),
  stats: path.join(DATA_DIR, 'stats.json'),
  runtime: path.join(DATA_DIR, 'runtime.json'),
  backups: path.join(DATA_DIR, 'backups'),
  skills: path.join(DATA_DIR, 'skills'),
  logs: path.join(DATA_DIR, 'logs'),
};

const p = (...parts) => path.join(HOME, ...parts);

/** Windows 的应用数据目录；非 Windows 也给出可用的兜底路径。 */
const APPDATA = process.env.APPDATA || p('.config');
const LOCALAPPDATA = process.env.LOCALAPPDATA || p('.local', 'share');

/** 各应用允许通过环境变量迁移数据目录。 */
const KIMI_HOME = process.env.KIMI_CODE_HOME || p('.kimi-code');
const HERMES_HOME =
  process.env.HERMES_HOME || (process.platform === 'win32' ? path.join(LOCALAPPDATA, 'hermes') : p('.hermes'));
const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || p('.claude');
const CODEX_HOME = process.env.CODEX_HOME || p('.codex');
const DSH_HOME = process.env.DSH_HOME || p('.dsh');

/**
 * 各 CLI 的配置位置与写入策略（跨平台）。
 * strategy 决定适配器如何读写；sessions 是会话扫描根目录。
 */
export const CLI = {
  claude: {
    key: 'claude',
    label: 'Claude Code',
    dir: CLAUDE_HOME,
    settings: path.join(CLAUDE_HOME, 'settings.json'),
    strategy: 'claude-json',
    protocol: 'anthropic',
    bin: 'claude',
    sessions: [path.join(CLAUDE_HOME, 'projects')],
    docs: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  codex: {
    key: 'codex',
    label: 'Codex CLI',
    dir: CODEX_HOME,
    settings: path.join(CODEX_HOME, 'config.toml'),
    auth: path.join(CODEX_HOME, 'auth.json'),
    strategy: 'codex-toml',
    protocol: 'openai',
    bin: 'codex',
    sessions: [path.join(CODEX_HOME, 'sessions')],
    docs: 'https://github.com/openai/codex',
  },
  gemini: {
    key: 'gemini',
    label: 'Gemini CLI',
    dir: p('.gemini'),
    settings: p('.gemini', 'settings.json'),
    env: p('.gemini', '.env'),
    strategy: 'dotenv-gemini',
    protocol: 'gemini',
    bin: 'gemini',
    sessions: [p('.gemini', 'tmp')],
    docs: 'https://github.com/google-gemini/gemini-cli',
  },
  qwen: {
    key: 'qwen',
    label: 'Qwen Code',
    dir: p('.qwen'),
    settings: p('.qwen', 'settings.json'),
    env: p('.qwen', '.env'),
    strategy: 'dotenv-openai',
    protocol: 'openai',
    bin: 'qwen',
    sessions: [p('.qwen', 'tmp')],
    docs: 'https://github.com/QwenLM/qwen-code',
  },

  claudeDesktop: {
    key: 'claudeDesktop',
    label: 'Claude Desktop',
    dir: path.join(APPDATA, 'Claude'),
    settings: path.join(APPDATA, 'Claude', 'claude_desktop_config.json'),
    altDirs: [path.join(LOCALAPPDATA, 'Claude')],
    altSettings: [path.join(LOCALAPPDATA, 'Claude', 'claude_desktop_config.json')],
    strategy: 'desktop',
    protocol: 'anthropic',
    bin: 'claude',
    readOnly: true,
    sessions: [],
    docs: 'https://claude.ai/download',
  },
  kimi: {
    key: 'kimi',
    label: 'Kimi Code',
    dir: KIMI_HOME,
    settings: path.join(KIMI_HOME, 'config.toml'),
    strategy: 'kimi-toml',
    protocol: 'openai',
    bin: 'kimi',
    readOnly: false,
    sessions: [KIMI_HOME, p('.kimi')],
    docs: 'https://www.kimi.com/code/docs/kimi-code-cli/',
  },
  dsh: {
    key: 'dsh',
    label: 'DeepSeek Harness',
    dir: DSH_HOME,
    settings: path.join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml'),
    credentials: path.join(DSH_HOME, '.credentials.yaml'),
    dshPatch: path.join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml'),
    strategy: 'dsh',
    protocol: 'openai',
    bin: 'dsh',
    readOnly: false,
    sessions: [path.join(DSH_HOME, 'sessions')],
    docs: 'https://deepseek.com',
  },
  openclaw: {
    key: 'openclaw',
    label: 'OpenClaw',
    dir: p('.openclaw'),
    settings: p('.openclaw', 'openclaw.json'),
    strategy: 'openclaw',
    protocol: 'openai',
    bin: 'openclaw',
    readOnly: true,
    sessions: [p('.openclaw')],
    docs: 'https://openclaw.ai',
  },
  hermes: {
    key: 'hermes',
    label: 'Hermes',
    dir: HERMES_HOME,
    settings: path.join(HERMES_HOME, 'config.yaml'),
    strategy: 'hermes',
    protocol: 'openai',
    bin: 'hermes',
    readOnly: true,
    sessions: [path.join(HERMES_HOME, 'sessions')],
    docs: 'https://hermes-agent.nousresearch.com/docs/',
  },
  minimax: {
    key: 'minimax',
    label: 'MiniMax Code',
    dir: p('.minimax'),
    settings: p('.minimax', 'config.yaml'),
    strategy: 'minimax',
    protocol: 'openai',
    bin: 'minimax',
    readOnly: true,
    sessions: [p('.minimax')],
    docs: 'https://platform.minimaxi.com',
  },

  opencode: {
    key: 'opencode',
    label: 'OpenCode',
    dir: p('.config', 'opencode'),
    settings: p('.config', 'opencode', 'opencode.json'),
    strategy: 'opencode-json',
    protocol: 'openai',
    bin: 'opencode',
    sessions: [p('.local', 'share', 'opencode', 'storage')],
    docs: 'https://opencode.ai/docs',
  },
  grok: {
    key: 'grok',
    label: 'Grok Build',
    dir: p('.grok'),
    settings: p('.grok', 'config.toml'),
    strategy: 'grok-toml',
    protocol: 'openai',
    bin: 'grok',
    sessions: [p('.grok', 'sessions')],
    docs: 'https://x.ai',
  },
  pi: {
    key: 'pi',
    label: 'Pi',
    dir: p('.pi', 'agent'),
    settings: p('.pi', 'agent', 'models.json'),
    extra: [p('.pi', 'agent', 'settings.json')],
    strategy: 'pi-json',
    protocol: 'openai',
    bin: 'pi',
    sessions: [p('.pi', 'agent', 'sessions')],
    docs: 'https://pi.dev',
  },
  omp: {
    key: 'omp',
    label: 'OMP',
    dir: p('.omp', 'agent'),
    settings: p('.omp', 'agent', 'models.yml'),
    strategy: 'omp-yaml',
    protocol: 'openai',
    bin: 'omp',
    sessions: [p('.omp', 'sessions')],
    docs: 'https://github.com/oh-my-pi',
  },
};

export const APP_ORDER = ['claude','codex','gemini','qwen','opencode','grok','pi','omp','kimi','dsh','claudeDesktop','openclaw','hermes','minimax'];

/** 额外扫描但不支持写入的会话目录（用户装了就有） */
export const EXTRA_SESSION_ROOTS = [
  { app: 'kimi', label: 'Kimi Code', dir: p('.kimi') },
  { app: 'codebuddy', label: 'CodeBuddy', dir: p('.codebuddy') },
  { app: 'copilot', label: 'Copilot CLI', dir: p('.copilot') },
  { app: 'iflow', label: 'iFlow CLI', dir: p('.iflow') },
];

export function ensureDirs() {
  for (const dir of [DATA_DIR, FILES.backups, FILES.skills, FILES.logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readJson(file, fallback = null) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** 读取 JSON，解析失败时抛出（用于写回前的安全校验，避免覆盖用户配置） */
export function readJsonStrict(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} 不是合法 JSON，已中止写入以避免覆盖：${err.message}`);
  }
}

export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600);
  } catch {}
  fs.renameSync(tmp, file);
}

export function exists(x) {
  try {
    fs.accessSync(x);
    return true;
  } catch {
    return false;
  }
}

export function timestamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}
