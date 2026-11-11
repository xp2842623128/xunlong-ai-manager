/**
 * Skills API 集成测试：临时 HOME / 数据目录，起一个随机端口，不触碰真实配置。
 * 运行：node tools/tests/test-skills-api.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xunlong-skills-api-'));
const home = path.join(root, 'home');
const data = path.join(root, 'data');
const appdata = path.join(home, 'AppData', 'Roaming');
const localappdata = path.join(home, 'AppData', 'Local');
const appRoots = {
  claude: path.join(home, '.claude'),
  codex: path.join(home, '.codex'),
  gemini: path.join(home, '.gemini'),
  qwen: path.join(home, '.qwen'),
  opencode: path.join(home, '.config', 'opencode'),
  grok: path.join(home, '.grok'),
  pi: path.join(home, '.pi', 'agent'),
  omp: path.join(home, '.omp', 'agent'),
  kimi: path.join(home, '.kimi-code'),
  dsh: path.join(home, '.dsh'),
};
for (const dir of Object.values(appRoots)) fs.mkdirSync(dir, { recursive: true });

process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.APPDATA = appdata;
process.env.LOCALAPPDATA = localappdata;
process.env.XUNLONG_DATA_DIR = data;
process.env.CLAUDE_CONFIG_DIR = appRoots.claude;
process.env.CODEX_HOME = appRoots.codex;
process.env.DSH_HOME = appRoots.dsh;
process.env.KIMI_CODE_HOME = appRoots.kimi;

function writeSkill(dir, version = '1.0') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: demo\ndescription: API 测试技能\nversion: ${version}\n---\n\n# Demo\n\n版本 ${version}\n`,
    'utf8',
  );
}

function request(port, method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: url,
        headers: {
          host: `127.0.0.1:${port}`,
          'content-type': 'application/json',
          'x-requested-with': 'xunlong-panel',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

let server;
let port;
try {
  const { createServer } = await import('../../app/server.mjs');
  server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;

  const source = path.join(appRoots.claude, 'skills', 'demo');
  writeSkill(source, '1.0');
  let r = await request(port, 'POST', '/api/skills/import', {
    items: [{ path: source, name: 'demo' }],
    apps: ['claude', 'dsh'],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.imported, 1);

  r = await request(port, 'GET', '/api/skills');
  assert.equal(r.status, 200);
  let item = (r.body.installed || []).find((x) => x.folder === 'demo');
  assert.ok(item);
  assert.ok(['link', 'copy'].includes(item.targets.dsh));

  r = await request(port, 'PATCH', '/api/skills/demo', { apps: ['claude'] });
  assert.equal(r.status, 200);
  assert.equal(r.body.results.dsh, 'removed-link');
  assert.equal(fs.existsSync(path.join(appRoots.dsh, 'skills', 'demo')), false);

  r = await request(port, 'POST', '/api/skills/sync', { name: 'demo' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  // ZIP 导入：根目录有 SKILL.md，第二次同名必须 409，勾选 update 后成功
  const zipSrc = path.join(root, 'zipsrc');
  writeSkill(zipSrc, '1.0');
  const zipPath = path.join(root, 'zipdemo.zip');
  execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', zipSrc, '.'], { stdio: 'ignore' });
  const b64 = fs.readFileSync(zipPath).toString('base64');
  r = await request(port, 'POST', '/api/skills/install-zip', {
    filename: 'zipdemo.zip',
    data: b64,
    apps: ['dsh'],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'zipdemo');

  r = await request(port, 'POST', '/api/skills/install-zip', {
    filename: 'zipdemo.zip',
    data: b64,
    apps: ['dsh'],
  });
  assert.equal(r.status, 409);

  writeSkill(zipSrc, '2.0');
  execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', zipSrc, '.'], { stdio: 'ignore' });
  r = await request(port, 'POST', '/api/skills/install-zip', {
    filename: 'zipdemo.zip',
    data: fs.readFileSync(zipPath).toString('base64'),
    apps: ['dsh'],
    update: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.status, 'updated');
  assert.ok(
    fs.readFileSync(path.join(appRoots.dsh, 'skills', 'zipdemo', 'SKILL.md'), 'utf8').includes('版本 2.0'),
  );

  r = await request(port, 'DELETE', '/api/skills/demo');
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(path.join(data, 'skills', 'demo')), false);

  r = await request(port, 'DELETE', '/api/skills/zipdemo');
  assert.equal(r.status, 200);

  console.log('Skills API 测试通过');
  console.log('  导入、查询、PATCH 启停、同步、ZIP 首次导入/409/覆盖更新、删除');
  console.log(`  临时目录：${root}`);
} catch (err) {
  console.error('Skills API 测试失败：', err);
  console.error(`临时目录保留：${root}`);
  process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (!process.exitCode) fs.rmSync(root, { recursive: true, force: true });
}
