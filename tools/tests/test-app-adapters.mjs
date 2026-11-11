/**
 * 应用适配器夹具测试：不读取或修改真实用户配置。
 * 运行：node tools/tests/test-app-adapters.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseToml } from '../../app/core/config-parse.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xunlong-adapters-'));
const home = path.join(root, 'home');
const appdata = path.join(home, 'AppData', 'Roaming');
const localappdata = path.join(home, 'AppData', 'Local');
fs.mkdirSync(path.join(home, '.kimi-code'), { recursive: true });
fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
fs.mkdirSync(path.join(home, '.minimax'), { recursive: true });
fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
fs.mkdirSync(path.join(home, '.grok'), { recursive: true });
fs.mkdirSync(path.join(home, '.dsh', 'profiles', 'desktop'), { recursive: true });
fs.mkdirSync(path.join(home, '.omp', 'agent'), { recursive: true });
fs.mkdirSync(path.join(localappdata, 'hermes'), { recursive: true });
fs.mkdirSync(path.join(appdata, 'Claude'), { recursive: true });

process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.APPDATA = appdata;
process.env.LOCALAPPDATA = localappdata;
process.env.XUNLONG_DATA_DIR = path.join(root, 'data');
process.env.KIMI_CODE_HOME = path.join(home, '.kimi-code');
process.env.HERMES_HOME = path.join(localappdata, 'hermes');
process.env.DSH_HOME = path.join(home, '.dsh');
process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
process.env.CODEX_HOME = path.join(home, '.codex');

fs.writeFileSync(
  path.join(home, '.kimi-code', 'config.toml'),
  `# 用户自己写的注释，必须保留
default_model = "custom/old-model"
default_permission_mode = "manual"

[providers."custom"]
type = "openai"
base_url = "https://old.example/v1"
api_key = "old-secret"

[models."custom/old-model"]
provider = "custom"
model = "old-model"
max_context_size = 100000

[secondary_model]
default_model = "custom/old-model"
`,
  'utf8',
);

fs.writeFileSync(
  path.join(home, '.codex', 'config.toml'),
  `notify = ["notify-send"]\nmodel = "gpt-5"\n\n[profiles.work]\nmodel = "gpt-5-mini"\n`,
  'utf8',
);
fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'old' }, null, 2), 'utf8');
fs.writeFileSync(
  path.join(home, '.grok', 'config.toml'),
  `top_setting = "keep"\n\n[models]\ndefault = "old" # 已有注释\n\n[model."old"]\nmodel = "old"\nbase_url = "https://old.example/v1"\nextra = "keep"\n`,
  'utf8',
);
fs.writeFileSync(
  path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'),
  `- id: llm-pi-ai
  config:
    providers:
      deepseek-account:
        api: openai-completions
        models:
        - id: old-model
- id: agent-default-model
  config:
    provider: deepseek-account
    model: old-model
`,
  'utf8',
);
fs.writeFileSync(
  path.join(home, '.dsh', '.credentials.yaml'),
  `version: 1\nrefs:\n  OTHER_KEY: value\n`,
  'utf8',
);
fs.writeFileSync(
  path.join(home, '.omp', 'agent', 'models.yml'),
  `providers:\n  existing:\n    baseUrl: https://old.example/v1\n    api: openai-completions\n    extraField: keep\n    models:\n    - id: model-1\n      name: Model One\n`,
  'utf8',
);

fs.writeFileSync(
  path.join(home, '.openclaw', 'openclaw.json'),
  `// OpenClaw 使用 JSON5
{  models: {
    mode: 'merge',
    providers: {
      acme: {
        baseUrl: 'https://openclaw.example/v1',
        apiKey: 'openclaw-secret',
        api: 'openai-completions',
        models: [
          { id: 'oc-model', name: 'oc-model' },
        ],
      },
    },
  },
  agents: { defaults: { model: { primary: 'acme/oc-model' } } },
}
`,
  'utf8',
);

const hermesFile = path.join(localappdata, 'hermes', 'config.yaml');
fs.writeFileSync(
  hermesFile,
  `custom_providers:
- name: acme
  base_url: https://hermes.example/v1
  api_key: "hermes-secret"
  api_mode: chat_completions
model:
  default: hermes-model
  provider: acme
mcp_servers: {}
`,
  'utf8',
);

fs.writeFileSync(
  path.join(home, '.minimax', 'config.yaml'),
  `custom_provider:
  acme:
    name: Acme MiniMax
    api: openai-completions
    options:
      baseURL: https://minimax.example/v1
      apiKey: minimax-secret
    models:
      mm-model:
        name: mm-model
defaultModel: custom_provider:acme/mm-model
`,
  'utf8',
);

fs.writeFileSync(
  path.join(appdata, 'Claude', 'claude_desktop_config.json'),
  JSON.stringify({ account: { plan: 'test' }, mcpServers: {} }, null, 2),
  'utf8',
);

const adapters = await import(`../../app/core/adapters.mjs?fixture=${Date.now()}`);
const { CLI } = await import(`../../app/core/paths.mjs?fixture=${Date.now()}`);
assert.ok(CLI.kimi.settings.startsWith(home), '测试必须使用临时 HOME，不能碰真实配置');

const apps = adapters.detectApps();
const app = (key) => apps.find((item) => item.key === key);
assert.equal(app('kimi').installed, true);
assert.equal(app('kimi').readOnly, false);
assert.equal(app('openclaw').readOnly, true);
assert.equal(app('claudeDesktop').installed, true);

const kimiBefore = adapters.readCurrent('kimi');
assert.equal(kimiBefore.provider, 'custom');
assert.equal(kimiBefore.model, 'old-model');
assert.equal(kimiBefore.keyTail, 'cret');

assert.deepEqual(
  {
    baseUrl: app('openclaw').current.baseUrl,
    model: app('openclaw').current.model,
    provider: app('openclaw').current.provider,
  },
  { baseUrl: 'https://openclaw.example/v1', model: 'oc-model', provider: 'acme' },
);
assert.equal(app('hermes').current.baseUrl, 'https://hermes.example/v1');
assert.equal(app('hermes').current.model, 'hermes-model');
assert.equal(app('minimax').current.provider, 'Acme MiniMax');
assert.equal(app('minimax').current.model, 'mm-model');

const activeOpenClaw = adapters.readActiveProvider('openclaw');
assert.equal(activeOpenClaw.apiKey, 'openclaw-secret');
assert.equal(activeOpenClaw.protocol, 'openai');
const activeHermes = adapters.readActiveProvider('hermes');
assert.equal(activeHermes.apiKey, 'hermes-secret');
const activeMinimax = adapters.readActiveProvider('minimax');
assert.equal(activeMinimax.apiKey, 'minimax-secret');
assert.equal(activeMinimax.protocol, 'openai');

// Hermes 新版 providers: 映射，也应能读出来。
fs.writeFileSync(
  hermesFile,
  `model:
  provider: acme
  default: hermes-next
providers:
  acme:
    api: https://hermes-next.example/v1
    api_key: hermes-next-secret
    api_mode: anthropic_messages
`,
  'utf8',
);
const hermesNext = adapters.readActiveProvider('hermes');
assert.equal(hermesNext.baseUrl, 'https://hermes-next.example/v1');
assert.equal(hermesNext.apiKey, 'hermes-next-secret');
assert.equal(hermesNext.protocol, 'anthropic');
assert.equal(hermesNext.model, 'hermes-next');

// Codex：顶层键必须留在顶层，已有 profile 表不能被吞。
adapters.applyProvider({
  app: 'codex',
  protocol: 'openai',
  name: 'Acme',
  baseUrl: 'https://codex.example/v1',
  apiKey: 'codex-secret',
  model: 'codex-model',
});
const codexText = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
const codexToml = parseToml(codexText);
assert.equal(codexToml.top.notify?.[0], 'notify-send');
assert.equal(codexToml.top.model_provider, 'xunlong');
assert.equal(codexToml.top.model, 'codex-model');
const codexSection = codexToml.sections.find((s) => s.path.join('.') === 'model_providers.xunlong');
assert.equal(codexSection?.values.base_url, 'https://codex.example/v1');
assert.match(codexText, /\[profiles\.work\]\nmodel = "gpt-5-mini"/);
assert.ok(codexText.indexOf('notify =') < codexText.indexOf('# >>> xunlong-ai-manager >>>'));

// Grok：保留用户顶层键和旧 model 表，只更新 models.default 与托管别名。
adapters.applyProvider({
  app: 'grok',
  protocol: 'openai',
  name: 'Acme',
  baseUrl: 'https://grok.example/v1',
  apiKey: 'grok-secret',
  model: 'grok-model',
});
const grokText = fs.readFileSync(path.join(home, '.grok', 'config.toml'), 'utf8');
assert.equal((grokText.match(/^\[models\]$/gm) || []).length, 1);
assert.match(grokText, /^top_setting = "keep"$/m);
assert.match(grokText, /\[model\."old"\][\s\S]*extra = "keep"/);
assert.match(grokText, /^default = "xunlong"$/m);
assert.match(grokText, /\[model\."xunlong"\]/);
const grokNow = adapters.readCurrent('grok');
assert.equal(grokNow.model, 'grok-model');
assert.equal(grokNow.baseUrl, 'https://grok.example/v1');

// DSH：重复应用必须更新 baseURL，凭据 Key 需要正确转义。
adapters.applyProvider({
  app: 'dsh',
  protocol: 'openai',
  name: 'Acme',
  baseUrl: 'https://dsh-one.example/v1',
  apiKey: 'dsh-secret-1',
  model: 'dsh-model',
});
const dshText1 = fs.readFileSync(path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8');
assert.match(dshText1, /xunlong:/);
assert.match(dshText1, /baseURL: "https:\/\/dsh-one\.example\/v1"/);
assert.match(dshText1, /provider: xunlong/);
const dshCreds1 = fs.readFileSync(path.join(home, '.dsh', '.credentials.yaml'), 'utf8');
assert.match(dshCreds1, /XUNLONG_DSH_KEY: dsh-secret-1/);
adapters.applyProvider({
  app: 'dsh',
  protocol: 'openai',
  name: 'Acme',
  baseUrl: 'https://dsh-two.example/v1',
  apiKey: 'dsh-secret-2',
  model: 'dsh-model-2',
});
const dshText2 = fs.readFileSync(path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8');
assert.equal(dshText2.includes('dsh-one.example'), false);
assert.match(dshText2, /baseURL: "https:\/\/dsh-two\.example\/v1"/);
assert.equal((dshText2.match(/^      xunlong:$/gm) || []).length, 1);
assert.match(fs.readFileSync(path.join(home, '.dsh', '.credentials.yaml'), 'utf8'), /XUNLONG_DSH_KEY: dsh-secret-2/);

// OMP：保留未知 provider、未知字段和模型名。
adapters.applyProvider({
  app: 'omp',
  protocol: 'openai',
  name: 'Acme',
  baseUrl: 'https://omp.example/v1',
  apiKey: 'omp-secret',
  model: 'omp-model',
});
const ompText = fs.readFileSync(path.join(home, '.omp', 'agent', 'models.yml'), 'utf8');
assert.match(ompText, /existing:/);
assert.match(ompText, /extraField: keep/);
assert.match(ompText, /model-1/);
assert.match(ompText, /xunlong:/);
assert.equal(adapters.readCurrent('omp').baseUrl, 'https://omp.example/v1');

// 无标记的同名 xunlong 表也应被清理，避免重复 TOML 表。
fs.appendFileSync(
  path.join(home, '.kimi-code', 'config.toml'),
  `\n[providers."xunlong"]\ntype = "openai"\nbase_url = "https://stale.example/v1"\napi_key = "stale"\n`,
  'utf8',
);
const applied = adapters.applyProvider({
  app: 'kimi',
  protocol: 'openai',
  name: 'Acme',
  baseUrl: 'https://new.example/v1/',
  apiKey: 'new-secret',
  model: 'new-model',
  models: ['new-model', 'alt-model'],
});
assert.equal(applied.alias, 'xunlong/new-model');
let kimiText = fs.readFileSync(CLI.kimi.settings, 'utf8');
assert.match(kimiText, /^default_model = "xunlong\/new-model"$/m);
assert.match(kimiText, /# 用户自己写的注释，必须保留/);
assert.match(kimiText, /\[providers\."custom"\]/);
assert.match(kimiText, /\[models\."custom\/old-model"\]/);
assert.match(kimiText, /\[secondary_model\]\ndefault_model = "custom\/old-model"/);
assert.equal((kimiText.match(/# >>> xunlong-ai-manager >>>/g) || []).length, 1);
assert.match(kimiText, /\[providers\."xunlong"\]/);
assert.equal((kimiText.match(/\[providers\."xunlong"\]/g) || []).length, 1);
assert.equal(kimiText.includes('https://stale.example/v1'), false);
assert.match(kimiText, /\[models\."xunlong\/new-model"\]/);
assert.match(kimiText, /\[models\."xunlong\/alt-model"\]/);

const kimiAfter = adapters.readCurrent('kimi');
assert.equal(kimiAfter.provider, 'xunlong');
assert.equal(kimiAfter.model, 'new-model');
assert.equal(kimiAfter.baseUrl, 'https://new.example/v1');
assert.equal(kimiAfter.keyTail, 'cret');

// 再应用一次，旧托管块必须被替换，不能留下重复模型。
adapters.applyProvider({
  app: 'kimi',
  protocol: 'openai',
  name: 'Acme',
  baseUrl: 'https://second.example/v1',
  apiKey: 'second-secret',
  model: 'second-model',
});
kimiText = fs.readFileSync(CLI.kimi.settings, 'utf8');
const kimiHead = kimiText.split(/^\s*\[/m)[0];
assert.equal((kimiHead.match(/^default_model\s*=/gm) || []).length, 1);
assert.match(kimiText, /\[secondary_model\]\ndefault_model = "custom\/old-model"/);
assert.equal((kimiText.match(/# >>> xunlong-ai-manager >>>/g) || []).length, 1);
assert.equal(kimiText.includes('xunlong/new-model'), false);
assert.equal(kimiText.includes('xunlong/second-model'), true);
assert.equal(adapters.readCurrent('kimi').model, 'second-model');
assert.equal(adapters.readCurrent('kimi').baseUrl, 'https://second.example/v1');

// 备份必须落在临时数据目录。
const backups = fs.readdirSync(path.join(root, 'data', 'backups')).filter((name) => name.startsWith('kimi-'));
assert.ok(backups.length >= 1, 'Kimi 写入前应自动备份');

const desktop = adapters.readCurrent('claudeDesktop');
assert.equal(desktop.provider, 'Claude 账号');
assert.equal(adapters.readActiveProvider('claudeDesktop'), null);

console.log('应用适配器测试通过');
console.log('  只读：OpenClaw / Hermes / MiniMax / Claude Desktop');
console.log('  可写：Kimi Code（保留用户 provider，托管块可重复替换）');
console.log(`  临时目录：${root}`);
fs.rmSync(root, { recursive: true, force: true });
