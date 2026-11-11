/**
 * 备份/恢复夹具测试：临时 HOME，不触碰真实配置。
 * 运行：node tools/tests/test-backup.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xunlong-backup-'));
const home = path.join(root, 'home');
const appdata = path.join(home, 'AppData', 'Roaming');
fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.APPDATA = appdata;
process.env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
process.env.XUNLONG_DATA_DIR = path.join(root, 'data');

const claude = path.join(home, '.claude', 'settings.json');
const qwen = path.join(home, '.qwen', '.env');
fs.writeFileSync(claude, '{"env":{"A":"1"}}', 'utf8');
fs.writeFileSync(qwen, 'OPENAI_KEY=1\n', 'utf8');

const { backupFile } = await import('../../app/core/adapters.mjs');
const { createBackup, listBackups, restoreBackup } = await import('../../app/core/backup.mjs');

const auto = backupFile(claude, 'claude');
assert.ok(auto);
let backups = listBackups();
const autoItem = backups.find((b) => b.kind === 'auto');
assert.equal(autoItem.restorable, true);
assert.ok(autoItem.target.endsWith('settings.json'));
fs.writeFileSync(claude, '{"env":{"A":"broken"}}', 'utf8');
let result = restoreBackup(autoItem.id);
assert.deepEqual(result.restored, [autoItem.id]);
assert.equal(fs.readFileSync(claude, 'utf8'), '{"env":{"A":"1"}}');

const manual = createBackup('测试备份');
assert.ok(manual.files >= 1);
backups = listBackups();
const manualItem = backups.find((b) => b.id === manual.id);
assert.ok(manualItem);
fs.writeFileSync(claude, '{"env":{"A":"2"}}', 'utf8');
fs.writeFileSync(qwen, 'OPENAI_KEY=2\n', 'utf8');
result = restoreBackup(manual.id);
assert.ok(result.restored.includes('claude-settings.json'));
assert.ok(result.restored.includes('qwen-env'));
assert.equal(fs.readFileSync(claude, 'utf8'), '{"env":{"A":"1"}}');
assert.equal(fs.readFileSync(qwen, 'utf8'), 'OPENAI_KEY=1\n');
// 两个同 basename 的 settings 不能在 pre-restore 目录里互相覆盖
const preFiles = fs.readdirSync(result.preRestoreDir);
assert.equal(new Set(preFiles.map((f) => f.split('-').slice(0, 1)[0])).size, preFiles.length);

console.log('备份/恢复测试通过');
console.log('  自动备份可恢复、手动备份覆盖范围包含多家 CLI、恢复前现场不重名');
console.log(`  临时目录：${root}`);
fs.rmSync(root, { recursive: true, force: true });
