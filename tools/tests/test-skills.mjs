/**
 * Skills 中心化夹具测试：临时 HOME / 数据目录，不触碰真实技能。
 * 运行：node tools/tests/test-skills.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xunlong-skills-'));
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
fs.mkdirSync(path.join(data, 'skills'), { recursive: true });

process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.APPDATA = appdata;
process.env.LOCALAPPDATA = localappdata;
process.env.XUNLONG_DATA_DIR = data;
process.env.CLAUDE_CONFIG_DIR = appRoots.claude;
process.env.CODEX_HOME = appRoots.codex;
process.env.DSH_HOME = appRoots.dsh;
process.env.KIMI_CODE_HOME = appRoots.kimi;

const {
  importSkills,
  listInstalledSkills,
  setSkillApps,
  syncSkill,
  removeSkill,
  installSkillFromDir,
  skillTargets,
} = await import('../../app/core/skills.mjs');

function writeSkill(dir, version = '1.0', extra = '') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: demo\ndescription: 测试技能\nversion: ${version}\n---\n\n# Demo\n\n版本 ${version}\n${extra}\n`,
    'utf8',
  );
}

function targetPath(app, folder = 'demo') {
  return path.join(appRoots[app], 'skills', folder);
}

function removeTarget(app) {
  const p = targetPath(app);
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) fs.unlinkSync(p);
  else fs.rmSync(p, { recursive: true, force: true });
}

function readTarget(app) {
  return fs.readFileSync(path.join(targetPath(app), 'SKILL.md'), 'utf8');
}

try {
  assert.equal(skillTargets().length, 10);
  assert.ok(skillTargets().some((t) => t.app === 'dsh' && t.available));

  const source = path.join(appRoots.claude, 'skills', 'demo');
  writeSkill(source, '1.0');
  let r = importSkills([{ path: source, name: 'demo' }], ['claude', 'dsh'], {});
  assert.equal(r.imported, 1);
  assert.equal(r.updated, 0);
  assert.equal(r.skipped, 0);

  let installed = listInstalledSkills();
  assert.equal(installed.length, 1);
  assert.equal(installed[0].folder, 'demo');
  assert.deepEqual(installed[0].apps, ['claude', 'dsh']);
  assert.ok(['link', 'copy'].includes(installed[0].targets.claude));
  assert.ok(['link', 'copy'].includes(installed[0].targets.dsh));

  const central = path.join(data, 'skills', 'demo');
  assert.ok(fs.existsSync(path.join(central, 'SKILL.md')));
  assert.ok(readTarget('claude').includes('版本 1.0'));
  assert.ok(readTarget('dsh').includes('版本 1.0'));

  // 停用 DSH：只移除链接/未修改副本，管家目录保留
  r = setSkillApps('demo', ['claude']);
  assert.equal(r.results.dsh, 'removed-link');
  assert.equal(fs.existsSync(targetPath('dsh')), false);
  assert.ok(fs.existsSync(central));

  // 再启用，然后手动改成不同副本，停用时必须保留
  r = setSkillApps('demo', ['claude', 'dsh']);
  assert.ok(r.results.dsh.startsWith('linked') || r.results.dsh.startsWith('copied'));
  removeTarget('dsh');
  fs.cpSync(central, targetPath('dsh'), {
    recursive: true,
    filter: (src) => path.basename(src) !== 'meta.json',
  });
  fs.appendFileSync(path.join(targetPath('dsh'), 'SKILL.md'), '\n本地修改\n', 'utf8');
  r = setSkillApps('demo', ['claude']);
  assert.equal(r.results.dsh, 'kept-modified');
  assert.ok(readTarget('dsh').includes('本地修改'));

  // 保留的副本重新启用时不会被静默覆盖；同步才会备份后替换
  r = setSkillApps('demo', ['claude', 'dsh']);
  assert.equal(r.results.dsh, 'conflict:modified');
  r = syncSkill('demo');
  assert.ok(String(r.results.dsh).startsWith('replaced'));
  assert.ok(fs.existsSync(path.join(data, 'backups', 'skills')));
  assert.equal(readTarget('dsh').includes('本地修改'), false);

  // 从另一个应用更新中央版本，旧版本先备份
  const updateSource = path.join(appRoots.codex, 'skills', 'demo');
  writeSkill(updateSource, '2.0', '更新内容');
  r = importSkills([{ path: updateSource, name: 'demo' }], ['claude', 'dsh'], { update: true });
  assert.equal(r.updated, 1);
  assert.ok(readTarget('claude').includes('版本 2.0'));
  assert.ok(readTarget('dsh').includes('版本 2.0'));
  assert.ok(fs.readdirSync(path.join(data, 'backups', 'skills')).length >= 1);

  // ZIP 临时目录安装入口（源在数据目录外，需显式允许该临时根）
  const stage = path.join(data, 'backups', 'zip-stage');
  writeSkill(stage, '3.0');
  r = installSkillFromDir(stage, 'zip-stage-demo', ['dsh'], { origin: 'zip-test' });
  assert.equal(r.status, 'imported');
  assert.ok(
    fs.readFileSync(path.join(targetPath('dsh', 'zip-stage-demo'), 'SKILL.md'), 'utf8').includes('版本 3.0'),
  );

  // 删除：管家目录移到备份，链接移除
  r = removeSkill('demo');
  assert.ok(r.backup && fs.existsSync(r.backup));
  assert.equal(fs.existsSync(central), false);
  assert.equal(fs.existsSync(targetPath('claude')), false);
  assert.equal(fs.existsSync(targetPath('dsh')), false);

  console.log('Skills 测试通过');
  console.log('  链接/复制目标、DSH、停用保留修改、同步替换、更新备份、ZIP 临时目录、删除移备份');
  console.log(`  临时目录：${root}`);
} catch (err) {
  console.error('Skills 测试失败：', err);
  console.error(`临时目录保留：${root}`);
  process.exitCode = 1;
} finally {
  if (!process.exitCode) fs.rmSync(root, { recursive: true, force: true });
}
