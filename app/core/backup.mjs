import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CLI, FILES, timestamp } from './paths.mjs';
import { getState } from './store.mjs';

const TARGETS = [
  { name: 'config.json', file: FILES.config, kind: 'app' },
  { name: 'claude-settings.json', file: CLI.claude.settings, kind: 'cli' },
  { name: 'codex-config.toml', file: CLI.codex.settings, kind: 'cli' },
  { name: 'codex-auth.json', file: CLI.codex.auth, kind: 'cli' },
  { name: 'gemini-env', file: CLI.gemini.env, kind: 'cli' },
  { name: 'gemini-settings.json', file: CLI.gemini.settings, kind: 'cli' },
  { name: 'qwen-env', file: CLI.qwen.env, kind: 'cli' },
  { name: 'qwen-settings.json', file: CLI.qwen.settings, kind: 'cli' },
  { name: 'kimi-config.toml', file: CLI.kimi.settings, kind: 'cli' },
  { name: 'opencode.json', file: CLI.opencode.settings, kind: 'cli' },
  { name: 'grok-config.toml', file: CLI.grok.settings, kind: 'cli' },
  { name: 'pi-models.json', file: CLI.pi.settings, kind: 'cli' },
  { name: 'pi-settings.json', file: CLI.pi.extra?.[0], kind: 'cli' },
  { name: 'omp-models.yml', file: CLI.omp.settings, kind: 'cli' },
  { name: 'dsh-cordis.patch.yml', file: CLI.dsh.dshPatch || CLI.dsh.settings, kind: 'cli' },
  { name: 'dsh-credentials.yaml', file: CLI.dsh.credentials, kind: 'cli' },
].filter((target) => target.file);

function backupId() {
  return `bk-${timestamp()}-${crypto.randomBytes(3).toString('hex')}`;
}

function normalizePath(file) {
  return path.resolve(file).toLowerCase();
}

const ALLOWED_RESTORE = new Set(TARGETS.map((target) => normalizePath(target.file)));

function preRestoreName(target) {
  const hash = crypto.createHash('sha1').update(normalizePath(target)).digest('hex').slice(0, 8);
  return `${hash}-${path.basename(target)}`;
}

const AUTO_TARGETS = {
  claude: CLI.claude.settings,
  'claude-mcp': CLI.claude.settings,
  codex: CLI.codex.settings,
  'codex-auth': CLI.codex.auth,
  'codex-mcp': CLI.codex.settings,
  gemini: CLI.gemini.env,
  'gemini-mcp': CLI.gemini.settings,
  qwen: CLI.qwen.env,
  'qwen-mcp': CLI.qwen.settings,
  kimi: CLI.kimi.settings,
  opencode: CLI.opencode.settings,
  grok: CLI.grok.settings,
  dsh: CLI.dsh.dshPatch || CLI.dsh.settings,
  'dsh-creds': CLI.dsh.credentials,
  pi: CLI.pi.settings,
  'pi-settings': CLI.pi.extra?.[0],
  omp: CLI.omp.settings,
};

function autoTargetFromName(name) {
  if (!/\.bak$/i.test(name)) return null;
  let base = name.replace(/\.bak$/i, '');
  base = base.replace(/\.(json|toml|ya?ml|env)$/i, '');
  base = base.replace(/-\d{8}-\d{6}$/, '');
  return AUTO_TARGETS[base] || null;
}

export function createBackup(label = 'manual', includeConfig = true) {
  const files = [];
  for (const t of TARGETS) {
    if (!includeConfig && t.kind === 'app') continue;
    let content = null;
    try {
      content = fs.readFileSync(t.file, 'utf8');
    } catch {
      content = null;
    }
    files.push({ name: t.name, path: t.file, content });
  }
  const record = {
    id: backupId(),
    label,
    createdAt: new Date().toISOString(),
    app: '迅龙AI管家',
    version: getState().version || 1,
    files,
  };
  fs.mkdirSync(FILES.backups, { recursive: true });
  const dest = path.join(FILES.backups, `${record.id}.json`);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
  try {
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600);
  } catch {}
  fs.renameSync(tmp, dest);
  cleanup();
  return {
    id: record.id,
    createdAt: record.createdAt,
    label,
    size: fs.statSync(dest).size,
    files: files.filter((f) => f.content).length,
  };
}

function backupKeep() {
  const value = Number(getState().settings.backupKeep);
  return Number.isFinite(value) ? Math.max(1, Math.min(100, value)) : 20;
}

function cleanup() {
  const all = fs
    .readdirSync(FILES.backups)
    .filter((f) => f.startsWith('bk-') && f.endsWith('.json'))
    .sort();
  for (const old of all.slice(0, Math.max(0, all.length - backupKeep()))) {
    try {
      fs.unlinkSync(path.join(FILES.backups, old));
    } catch {}
  }
}

export function listBackups() {
  if (!fs.existsSync(FILES.backups)) return [];
  const names = fs
    .readdirSync(FILES.backups)
    .filter((f) => (f.startsWith('bk-') && f.endsWith('.json')) || (f.endsWith('.bak') && !f.startsWith('mirror-')));

  const items = names.map((f) => {
    try {
      const full = path.join(FILES.backups, f);
      const stat = fs.statSync(full);
      if (f.endsWith('.bak')) {
        const target = autoTargetFromName(f);
        return {
          id: f,
          kind: 'auto',
          label: target ? '切换前自动备份' : '自动备份（无法定位目标）',
          createdAt: stat.mtime.toISOString(),
          size: stat.size,
          files: 1,
          target: target || '',
          restorable: Boolean(target),
        };
      }
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      return {
        id: data.id || f.replace(/\.json$/i, ''),
        kind: 'manual',
        label: data.label,
        createdAt: data.createdAt,
        size: stat.size,
        files: (data.files || []).filter((x) => x.content).length,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
}

export function deleteBackup(id) {
  const name = String(id || '');
  const isAuto = /^[A-Za-z0-9._-]+\.bak$/i.test(name);
  const isManual = /^bk-[A-Za-z0-9-]+$/.test(name);
  if (!isAuto && !isManual) throw Object.assign(new Error('备份 ID 无效'), { status: 400 });
  const file = path.join(FILES.backups, isAuto ? name : `${name}.json`);
  if (!fs.existsSync(file)) throw Object.assign(new Error('备份不存在'), { status: 404 });
  fs.unlinkSync(file);
  return { ok: true, id: name };
}

export function clearBackups() {
  if (!fs.existsSync(FILES.backups)) return { ok: true, removed: 0 };
  const names = fs
    .readdirSync(FILES.backups)
    .filter((f) => (f.startsWith('bk-') && f.endsWith('.json')) || (f.endsWith('.bak') && !f.startsWith('mirror-')));
  let removed = 0;
  for (const f of names) {
    try {
      fs.unlinkSync(path.join(FILES.backups, f));
      removed += 1;
    } catch {}
  }
  return { ok: true, removed };
}

export function restoreBackup(id) {
  if (/^[A-Za-z0-9._-]+\.bak$/i.test(String(id || ''))) return restoreAutoBackup(id);
  if (!/^bk-[A-Za-z0-9-]+$/.test(String(id || ''))) throw new Error('备份 ID 无效');
  const file = path.join(FILES.backups, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error('备份不存在');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const restored = [];
  const errors = [];
  const pre = path.join(FILES.backups, `pre-restore-${timestamp()}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(pre, { recursive: true });

  for (const item of data.files || []) {
    if (!item.path) continue;
    const target = path.resolve(item.path);
    if (!ALLOWED_RESTORE.has(normalizePath(target))) {
      restored.push(`${item.name || target}: 已跳过（不是本工具管理的配置）`);
      continue;
    }
    try {
      if (fs.existsSync(target)) {
        fs.copyFileSync(target, path.join(pre, preRestoreName(target)));
      }
      if (item.content === null) {
        restored.push(`${item.name}: 备份时文件不存在，已跳过`);
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const tmp = `${target}.${process.pid}.restore.tmp`;
        fs.writeFileSync(tmp, item.content, 'utf8');
        fs.renameSync(tmp, target);
      }
      restored.push(item.name);
    } catch (err) {
      errors.push(`${item.name}: ${err.message}`);
      restored.push(`${item.name}: ${err.message}`);
    }
  }
  return { restored, errors, preRestoreDir: pre };
}

function restoreAutoBackup(name) {
  const safe = path.basename(String(name || ''));
  if (safe !== name || !/\.bak$/i.test(safe)) throw new Error('自动备份名称无效');
  const target = autoTargetFromName(safe);
  if (!target || !ALLOWED_RESTORE.has(normalizePath(target))) throw new Error('无法定位该自动备份的目标配置');
  const source = path.join(FILES.backups, safe);
  if (!fs.existsSync(source)) throw new Error('自动备份不存在');
  const pre = path.join(FILES.backups, `pre-restore-${timestamp()}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(pre, { recursive: true });
  try {
    if (fs.existsSync(target)) fs.copyFileSync(target, path.join(pre, path.basename(target)));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  } catch (err) {
    throw new Error(`恢复自动备份失败：${err.message}`);
  }
  return { restored: [safe], target, preRestoreDir: pre };
}
