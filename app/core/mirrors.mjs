import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOME, FILES, timestamp } from './paths.mjs';

const TARGETS = {
  npm: {
    label: 'npm',
    file: path.join(HOME, '.npmrc'),
    mirror: 'https://registry.npmmirror.com',
    testUrl: 'https://registry.npmmirror.com/-/ping',
  },
  pip: {
    label: 'pip',
    file: path.join(process.env.APPDATA || HOME, 'pip', 'pip.ini'),
    mirror: 'https://pypi.tuna.tsinghua.edu.cn/simple',
    testUrl: 'https://pypi.tuna.tsinghua.edu.cn/simple/',
  },
  docker: {
    label: 'Docker',
    file: path.join(HOME, '.docker', 'daemon.json'),
    mirror: 'https://docker.m.daocloud.io',
    testUrl: 'https://docker.m.daocloud.io/v2/',
  },
};

const EXTRA_MIRRORS = [
  { key: 'github', label: 'GitHub 下载', url: 'https://ghproxy.net/https://github.com/', testUrl: 'https://ghproxy.net/' },
  { key: 'hf', label: 'HuggingFace', url: 'https://hf-mirror.com', testUrl: 'https://hf-mirror.com/' },
];

function backup(file, tag) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(FILES.backups, { recursive: true });
  const dest = path.join(FILES.backups, `mirror-${tag}-${timestamp()}-${Date.now().toString(36)}.bak`);
  fs.copyFileSync(file, dest);
  return dest;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

/* ---------------- 读取当前状态 ---------------- */

export function mirrorStatus() {
  const out = {};

  // npm
  const npmrc = readText(TARGETS.npm.file).replace(/\r/g, '');
  out.npm = {
    file: TARGETS.npm.file,
    current: (npmrc.match(/^registry=(.*)$/m) || [])[1] || '',
    mirror: TARGETS.npm.mirror,
  };

  // pip
  const pipini = readText(TARGETS.pip.file).replace(/\r/g, '');
  out.pip = {
    file: TARGETS.pip.file,
    current: (pipini.match(/^index-url\s*=\s*(.*)$/m) || [])[1] || '',
    mirror: TARGETS.pip.mirror,
  };

  // docker
  let docker = {};
  try {
    docker = JSON.parse(readText(TARGETS.docker.file) || '{}');
  } catch {}
  out.docker = {
    file: TARGETS.docker.file,
    current: (docker['registry-mirrors'] || []).join(', '),
    mirror: TARGETS.docker.mirror,
  };

  out.extra = EXTRA_MIRRORS.map((m) => ({ key: m.key, label: m.label, url: m.url }));
  return out;
}

/* ---------------- 换源 ---------------- */

export function applyMirror(key) {
  const t = TARGETS[key];
  if (!t) throw new Error('未知的换源目标');
  backup(t.file, key);

  if (key === 'npm') {
    let text = readText(t.file).replace(/^\uFEFF/, '');
    if (/^registry=/m.test(text)) text = text.replace(/^registry=.*$/m, `registry=${t.mirror}`);
    else text = `${text.trimEnd()}${text.trim() ? '\n' : ''}registry=${t.mirror}\n`;
    writeText(t.file, text.trimStart());
    return { ok: true, current: t.mirror, file: t.file };
  }

  if (key === 'pip') {
    let text = readText(t.file).replace(/^\uFEFF/, '');
    if (/^\[global\]/im.test(text)) {
      if (/^index-url\s*=/im.test(text)) text = text.replace(/^index-url\s*=.*$/im, `index-url = ${t.mirror}`);
      else text = text.replace(/^\[global\]/im, `[global]\nindex-url = ${t.mirror}`);
    } else {
      text = `${text.trimEnd()}\n[global]\nindex-url = ${t.mirror}\ntrusted-host = pypi.tuna.tsinghua.edu.cn\n`;
    }
    writeText(t.file, text.trimStart());
    return { ok: true, current: t.mirror, file: t.file };
  }

  if (key === 'docker') {
    let data = {};
    try {
      data = JSON.parse(readText(t.file) || '{}');
    } catch {
      throw new Error('daemon.json 不是合法 JSON，已中止');
    }
    const existing = Array.isArray(data['registry-mirrors']) ? data['registry-mirrors'] : [];
    data['registry-mirrors'] = [t.mirror, ...existing.filter((item) => item !== t.mirror)];
    writeText(t.file, JSON.stringify(data, null, 2));
    return { ok: true, current: t.mirror, file: t.file, note: 'Docker Desktop 需重启后生效' };
  }
  throw new Error('未实现');
}

export function restoreMirror(key) {
  const t = TARGETS[key];
  if (!t) throw new Error('未知的换源目标');
  const dir = FILES.backups;
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(`mirror-${key}-`) && f.endsWith('.bak'))
        .sort()
    : [];
  if (!files.length) throw new Error('没有找到该目标的历史备份');
  const src = path.join(dir, files[files.length - 1]);
  fs.mkdirSync(path.dirname(t.file), { recursive: true });
  fs.copyFileSync(src, t.file);
  return { ok: true, restored: files[files.length - 1], file: t.file };
}

/* ---------------- 测速 ---------------- */

async function latency(url, timeout = 6000) {
  const started = Date.now();
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'GET', signal: c.signal, redirect: 'follow' });
    return { ok: res.ok, status: res.status, ms: Date.now() - started, error: res.ok ? '' : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function testMirrors() {
  const list = [
    { key: 'npm', label: 'npm 镜像', url: TARGETS.npm.testUrl },
    { key: 'pip', label: 'PyPI 清华源', url: TARGETS.pip.testUrl },
    { key: 'docker', label: 'Docker 镜像', url: TARGETS.docker.testUrl },
    ...EXTRA_MIRRORS.map((m) => ({ key: m.key, label: m.label, url: m.testUrl })),
  ];
  const results = await Promise.all(list.map(async (m) => ({ ...m, ...(await latency(m.url)) })));
  return { ok: true, results, testedAt: new Date().toISOString() };
}
