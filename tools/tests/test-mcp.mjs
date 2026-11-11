/**
 * MCP 写入夹具测试：临时 HOME，不触碰真实配置。
 * 运行：node tools/tests/test-mcp.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xunlong-mcp-'));
const home = path.join(root, 'home');
const appdata = path.join(home, 'AppData', 'Roaming');
fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });

process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.APPDATA = appdata;
process.env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
process.env.XUNLONG_DATA_DIR = path.join(root, 'data');

fs.writeFileSync(
  path.join(home, '.codex', 'config.toml'),
  `notify = ["notify-send"]\nmodel = "gpt-5"\n\n[profiles.work]\nmodel = "gpt-5-mini"\n\n[mcp_servers.fetch]\ncommand = "old"\nargs = []\n`,
  'utf8',
);
fs.writeFileSync(
  path.join(home, '.claude', 'settings.json'),
  JSON.stringify({ mcpServers: { fetch: { command: 'claude-own', args: [] } } }, null, 2),
  'utf8',
);
fs.writeFileSync(
  path.join(home, '.gemini', 'settings.json'),
  JSON.stringify({ mcpServers: {} }, null, 2),
  'utf8',
);
fs.writeFileSync(path.join(home, '.qwen', 'settings.json'), JSON.stringify({ mcpServers: {} }, null, 2), 'utf8');

const { upsertMcp, applyMcp } = await import(`../../app/core/mcp.mjs?test=${Date.now()}`);

upsertMcp({ name: 'fetch', command: 'npx', args: ['server-fetch'], apps: ['codex'], enabled: true });
let result = applyMcp();
assert.equal(result.codex, 1);
let codex = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
assert.equal((codex.match(/\[mcp_servers\.fetch\]/g) || []).length, 1);
assert.match(codex, /^notify = \["notify-send"\]$/m);
assert.match(codex, /^model = "gpt-5"$/m);
assert.match(codex, /\[profiles\.work\]\nmodel = "gpt-5-mini"/);
assert.match(codex, /# >>> xunlong-mcp >>>/);
assert.match(codex, /command = "npx"/);
const claude = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
assert.equal(claude.mcpServers.fetch.command, 'claude-own');

// 编辑为只同步 Claude 后，Codex 的 fetch 应被移除，Claude 的同名项应替换为托管项。
const { mutate } = await import('../../app/core/store.mjs');
mutate((state) => {
  state.mcpServers[0].apps = ['claude'];
});
result = applyMcp();
assert.equal(result.claude, 1);
codex = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
assert.equal(codex.includes('[mcp_servers.fetch]'), false);
assert.equal(codex.includes('# >>> xunlong-mcp >>>'), false);
const claude2 = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
assert.equal(claude2.mcpServers.fetch.command, 'npx');

// 删除后再次应用，Claude 的托管项应被移除。
mutate((state) => {
  state.mcpServers = [];
});
applyMcp();
const claude3 = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
assert.equal(claude3.mcpServers.fetch, undefined);

console.log('MCP 写入测试通过');
console.log('  顶层键保留、同名表不重复、跨应用不误删、停用可移除');
console.log(`  临时目录：${root}`);
fs.rmSync(root, { recursive: true, force: true });
