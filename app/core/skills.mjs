import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CLI, FILES, timestamp, writeJsonAtomic } from './paths.mjs';

const INSTALL_DIR = FILES.skills;
const META_FILE = 'meta.json';

function target(app, label) {
  const root = CLI[app].dir;
  return { app, label, root, dir: path.join(root, 'skills') };
}

/** 支持 Skill 的应用。DSH 也使用 ~/.dsh/skills，纳入统一管理。 */
const APP_DIRS = [
  target('claude', 'Claude Code'),
  target('codex', 'Codex'),
  target('gemini', 'Gemini CLI'),
  target('qwen', 'Qwen Code'),
  target('opencode', 'OpenCode'),
  target('grok', 'Grok Build'),
  target('pi', 'Pi'),
  target('omp', 'OMP'),
  target('kimi', 'Kimi Code'),
  target('dsh', 'DeepSeek Harness'),
];

const APP_KEYS = APP_DIRS.map((a) => a.app);

function parseFrontmatter(text) {
  const meta = {};
  if (!text.startsWith('---')) return meta;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return meta;
  for (const line of text.slice(3, end).trim().split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return meta;
}

function readSkillDir(dir) {
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  let meta = {};
  try {
    meta = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  } catch {}
  return {
    name: meta.name || path.basename(dir),
    description: meta.description || '',
    version: meta.version || '',
    path: dir,
  };
}

function safeSkillName(raw) {
  const name = String(raw || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);
  if (name === '.' || name === '..') return '';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) ? `${name}_skill` : name;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function centralDir(folder) {
  return path.join(INSTALL_DIR, folder);
}

function requireFolder(raw) {
  const folder = String(raw || '');
  if (!folder || safeSkillName(folder) !== folder) {
    throw Object.assign(new Error('技能名称无效'), { status: 400 });
  }
  const dir = centralDir(folder);
  if (!isInside(INSTALL_DIR, dir)) throw Object.assign(new Error('技能目录无效'), { status: 400 });
  if (!fs.existsSync(dir)) throw Object.assign(new Error('技能不存在'), { status: 404 });
  return folder;
}

function readMeta(folder) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(centralDir(folder), META_FILE), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeMeta(folder, meta) {
  writeJsonAtomic(path.join(centralDir(folder), META_FILE), meta);
}

function hashDir(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (d, rel = '') => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === META_FILE || entry.name === '.git') continue;
      const abs = path.join(d, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else if (entry.isFile()) {
        try {
          hash.update('file\0');
          hash.update(relPath);
          hash.update('\0');
          hash.update(fs.readFileSync(abs));
        } catch {}
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function sameContent(a, b) {
  try {
    return hashDir(a) === hashDir(b);
  } catch {
    return false;
  }
}

function copyDir(src, dest, state = { files: 0, bytes: 0, depth: 0 }, skipMeta = false) {
  if (state.depth > 8 || state.files > 2000 || state.bytes > 50 * 1024 * 1024) {
    throw new Error('技能目录过大（上限 2000 文件 / 50MB / 8 层）');
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (skipMeta && entry.name === META_FILE) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      state.depth += 1;
      copyDir(s, d, state, skipMeta);
      state.depth -= 1;
    } else if (entry.isFile()) {
      const size = fs.statSync(s).size;
      state.files += 1;
      state.bytes += size;
      if (state.files > 2000 || state.bytes > 50 * 1024 * 1024) throw new Error('技能目录过大（上限 2000 文件 / 50MB）');
      fs.copyFileSync(s, d);
    }
  }
}

function backupRoot() {
  const dir = path.join(FILES.backups, 'skills');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function backupSkill(src, label) {
  const safe = safeSkillName(label) || 'skill';
  const dest = path.join(backupRoot(), `${safe}-${timestamp()}-${crypto.randomBytes(3).toString('hex')}`);
  copyDir(src, dest);
  return dest;
}

function targetState(t, folder, central) {
  const dest = path.join(t.dir, folder);
  let st;
  try {
    st = fs.lstatSync(dest);
  } catch {
    return 'missing';
  }
  if (st.isSymbolicLink()) {
    try {
      return fs.realpathSync.native(dest) === fs.realpathSync.native(central) ? 'link' : 'other-link';
    } catch {
      return 'broken-link';
    }
  }
  if (st.isDirectory()) return 'copy';
  return 'other';
}

function centralReal(central) {
  try {
    return fs.realpathSync.native(central);
  } catch {
    return '';
  }
}

function samePath(a, b) {
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

function createLink(central, dest) {
  try {
    fs.symlinkSync(central, dest, process.platform === 'win32' ? 'junction' : 'dir');
    return 'link';
  } catch {
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {}
    copyDir(central, dest, undefined, true);
    return 'copy';
  }
}

/**
 * 让一个应用目录指向管家目录。
 * same -> 原地换成链接；modified -> 仅在 replace 时备份后替换；
 * 其他链接/文件一律保留，避免误删用户自己的目录。
 */
function ensureTarget(t, folder, central, { replace = false } = {}) {
  if (!fs.existsSync(t.root)) return { status: 'missing-app' };
  fs.mkdirSync(t.dir, { recursive: true });
  const dest = path.join(t.dir, folder);
  let st;
  try {
    st = fs.lstatSync(dest);
  } catch {
    const mode = createLink(central, dest);
    return { status: mode === 'link' ? 'linked' : 'copied', mode };
  }

  const real = centralReal(central);
  if (st.isSymbolicLink()) {
    let linked = '';
    try {
      linked = fs.realpathSync.native(dest);
    } catch {}
    if (linked && samePath(linked, real)) return { status: 'linked', mode: 'link' };
    return { status: 'conflict', reason: 'other-link' };
  }

  if (!st.isDirectory()) return { status: 'conflict', reason: 'file' };

  const same = sameContent(dest, central);
  if (same) {
    fs.rmSync(dest, { recursive: true, force: true });
    const mode = createLink(central, dest);
    return { status: mode === 'link' ? 'linked' : 'copied', mode };
  }

  if (!replace) return { status: 'conflict', reason: 'modified' };

  const backup = backupSkill(dest, `${folder}-${t.app}`);
  fs.rmSync(dest, { recursive: true, force: true });
  const mode = createLink(central, dest);
  return { status: mode === 'link' ? 'replaced' : 'replaced-copy', mode, backup };
}

/** 只移除指向管家目录的链接，或与管家目录完全相同的副本；手动改过的目录保留。 */
function removeManagedTarget(t, folder, central) {
  const dest = path.join(t.dir, folder);
  let st;
  try {
    st = fs.lstatSync(dest);
  } catch {
    return 'missing';
  }
  if (st.isSymbolicLink()) {
    let linked = '';
    try {
      linked = fs.realpathSync.native(dest);
    } catch {}
    if (linked && samePath(linked, centralReal(central))) {
      fs.unlinkSync(dest);
      return 'removed-link';
    }
    return 'kept-other-link';
  }
  if (st.isDirectory()) {
    if (!sameContent(dest, central)) return 'kept-modified';
    fs.rmSync(dest, { recursive: true, force: true });
    return 'removed-copy';
  }
  return 'kept-file';
}

function applyApps(folder, apps, { replace = false, removeApps = [] } = {}) {
  const central = centralDir(folder);
  const selected = [...new Set(Array.isArray(apps) ? apps : [])].filter((app) => APP_KEYS.includes(app));
  const remove = new Set(Array.isArray(removeApps) ? removeApps : []);
  const results = {};
  const targets = {};
  for (const t of APP_DIRS) {
    if (selected.includes(t.app)) {
      const r = ensureTarget(t, folder, central, { replace });
      results[t.app] = r.status + (r.reason ? `:${r.reason}` : '');
      if (r.mode) targets[t.app] = { mode: r.mode, status: r.status, at: new Date().toISOString() };
      if (r.backup) results[t.app] += `:backup:${r.backup}`;
    } else if (remove.has(t.app)) {
      results[t.app] = removeManagedTarget(t, folder, central);
    }
  }
  const meta = readMeta(folder);
  meta.apps = selected;
  meta.targets = targets;
  meta.updatedAt = new Date().toISOString();
  writeMeta(folder, meta);
  return results;
}

/** 已导入到管家的技能 */
export function listInstalledSkills() {
  if (!fs.existsSync(INSTALL_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(INSTALL_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(INSTALL_DIR, entry.name);
    const info = readSkillDir(dir);
    if (!info) continue;
    const meta = readMeta(entry.name);
    const targets = {};
    for (const t of APP_DIRS) targets[t.app] = targetState(t, entry.name, dir);
    const states = Object.values(targets);
    const mode = states.includes('link')
      ? states.includes('copy') ? 'mixed' : 'link'
      : states.includes('copy') ? 'copy' : 'none';
    out.push({
      id: `installed:${entry.name}`,
      folder: entry.name,
      ...info,
      apps: Array.isArray(meta.apps) ? meta.apps.filter((app) => APP_KEYS.includes(app)) : [],
      category: meta.category || '',
      categoryManual: !!meta.category,
      targets,
      mode,
      importedAt: meta.importedAt || '',
      updatedAt: meta.updatedAt || meta.importedAt || '',
      origin: meta.origin || '',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 本机各 CLI 已有、但尚未导入的技能（按名称去重，记录来源） */
export function listAvailableSkills() {
  const installed = new Set(listInstalledSkills().map((s) => s.name));
  const map = new Map();
  for (const target of APP_DIRS) {
    if (!fs.existsSync(target.dir)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(target.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const info = readSkillDir(path.join(target.dir, entry.name));
      if (!info || installed.has(info.name)) continue;
      const key = info.name;
      if (!map.has(key)) {
        map.set(key, { id: `available:${key}`, ...info, foundIn: [target.label], sources: [target.dir] });
      } else {
        const item = map.get(key);
        if (!item.foundIn.includes(target.label)) item.foundIn.push(target.label);
        item.sources.push(target.dir);
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function importOne(item, appList, { update = false, origin = '', sourceRoots = [] } = {}) {
  const rawSrc = String(item?.path || '');
  const src = path.resolve(rawSrc);
  let realSrc = '';
  try {
    realSrc = fs.realpathSync.native(src);
    if (!fs.statSync(realSrc).isDirectory()) throw new Error('not a dir');
  } catch {
    return { status: 'skipped', reason: 'source-missing' };
  }

  const allowedRoots = [
    ...APP_DIRS.map((a) => a.dir),
    path.resolve(INSTALL_DIR),
    ...(Array.isArray(sourceRoots) ? sourceRoots.map((r) => path.resolve(r)) : []),
  ];
  const sourceAllowed = allowedRoots.some((root) => {
    try {
      return isInside(fs.realpathSync.native(root), realSrc);
    } catch {
      return isInside(root, realSrc);
    }
  });
  if (!sourceAllowed) return { status: 'skipped', reason: 'source-not-allowed' };

  const folder = safeSkillName(item.name || path.basename(realSrc));
  if (!folder) return { status: 'skipped', reason: 'invalid-name' };

  const central = centralDir(folder);
  const existed = fs.existsSync(central);
  if (existed && !update) return { status: 'skipped', reason: 'exists', name: folder };

  const stage = path.join(INSTALL_DIR, `.incoming-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
  let backup = '';
  try {
    copyDir(realSrc, stage);
    const info = readSkillDir(stage);
    if (!info) throw Object.assign(new Error('目录内没有 SKILL.md，不是有效技能'), { status: 400 });

    if (existed) {
      backup = backupSkill(central, folder);
      fs.rmSync(central, { recursive: true, force: true });
    }
    fs.renameSync(stage, central);

    const previous = existed ? readMeta(folder) : {};
    const requested = Array.isArray(appList) && appList.length
      ? appList
      : (existed ? previous.apps || [] : []);
    const selected = [...new Set(requested)].filter((app) => APP_KEYS.includes(app));
    const now = new Date().toISOString();
    const meta = {
      name: info.name || folder,
      folder,
      apps: selected,
      origin: origin || item.sources?.[0] || realSrc,
      importedAt: previous.importedAt || now,
      updatedAt: now,
      version: info.version || previous.version || '',
      hash: hashDir(central),
      targets: previous.targets && typeof previous.targets === 'object' ? previous.targets : {},
    };
    writeMeta(folder, meta);

    const removeApps = existed ? (previous.apps || []).filter((app) => !selected.includes(app)) : [];
    const targets = applyApps(folder, selected, { replace: existed, removeApps });
    return { status: existed ? 'updated' : 'imported', name: info.name || folder, folder, targets, backup };
  } catch (err) {
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    if (existed && !fs.existsSync(central) && backup && fs.existsSync(backup)) {
      try { copyDir(backup, central); } catch {}
    }
    throw err;
  }
}

/**
 * 导入技能到管家目录，再链接/复制到勾选应用。
 * update=false 时同名技能跳过；update=true 时先备份旧版本再替换。
 */
export function importSkills(items, apps = [], options = {}) {
  const list = Array.isArray(items) ? items : [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const results = [];
  for (const item of list) {
    try {
      const r = importOne(item, apps, { update: options.update === true });
      results.push(r);
      if (r.status === 'imported') imported += 1;
      else if (r.status === 'updated') updated += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      results.push({ status: 'error', error: String(err.message || err), name: item?.name || '' });
    }
  }
  return { ok: true, imported, updated, skipped, total: list.length, results };
}

export function setSkillApps(name, apps = []) {
  const folder = requireFolder(name);
  const meta = readMeta(folder);
  const previous = Array.isArray(meta.apps) ? meta.apps : [];
  const selected = [...new Set(Array.isArray(apps) ? apps : [])].filter((app) => APP_KEYS.includes(app));
  const removeApps = previous.filter((app) => !selected.includes(app));
  const results = applyApps(folder, selected, { replace: false, removeApps });
  return { ok: true, folder, apps: selected, results };
}

/** 手动分类：写进技能目录的 meta；传空串表示恢复自动分类。 */
export function setSkillCategory(name, category) {
  const folder = requireFolder(name);
  const meta = readMeta(folder);
  const key = String(category || '').trim();
  if (key) meta.category = key.slice(0, 40);
  else delete meta.category;
  writeMeta(folder, meta);
  return { ok: true, folder, category: meta.category || '' };
}

export function syncSkill(name) {
  const folder = requireFolder(name);
  const meta = readMeta(folder);
  const apps = Array.isArray(meta.apps) ? meta.apps : [];
  const results = applyApps(folder, apps, { replace: true });
  return { ok: true, folder, apps, results };
}

export function syncSkills(name = '') {
  if (name) return syncSkill(name);
  const results = {};
  let total = 0;
  for (const item of listInstalledSkills()) {
    try {
      results[item.folder] = syncSkill(item.folder).results;
      total += 1;
    } catch (err) {
      results[item.folder] = { error: String(err.message || err) };
    }
  }
  return { ok: true, total, results };
}

/** 删除管家目录（移到备份），只移除链接/未修改副本，手动修改的目录保留。 */
export function removeSkill(name) {
  const folder = requireFolder(name);
  const meta = readMeta(folder);
  const central = centralDir(folder);
  const managed = new Set([...(Array.isArray(meta.apps) ? meta.apps : []), ...Object.keys(meta.targets || {})]);
  const removed = {};
  const kept = {};
  for (const t of APP_DIRS) {
    if (!managed.has(t.app)) continue;
    const r = removeManagedTarget(t, folder, central);
    if (r.startsWith('removed')) removed[t.app] = r;
    else kept[t.app] = r;
  }
  const dest = path.join(backupRoot(), `removed-${folder}-${timestamp()}-${crypto.randomBytes(3).toString('hex')}`);
  fs.renameSync(central, dest);
  return { ok: true, folder, backup: dest, removed, kept };
}

/** ZIP 解压到临时目录后，从临时目录安装。 */
export function installSkillFromDir(src, name, apps = [], options = {}) {
  return importOne(
    { path: src, name, sources: [src], foundIn: options.foundIn || [] },
    apps,
    {
      update: options.update === true,
      origin: options.origin || 'zip',
      sourceRoots: [src],
    },
  );
}

export function skillTargets() {
  return APP_DIRS.map((a) => ({
    app: a.app,
    label: a.label,
    root: a.root,
    exists: fs.existsSync(a.dir),
    available: fs.existsSync(a.root),
  }));
}

export function listSkills() {
  return listInstalledSkills();
}
