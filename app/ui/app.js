/* 迅龙AI管家 · 前端（原生 ES Module，无构建步骤） */

import { applyI18n, restoreI18n, setUiLang, t, uiLang } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const APP_LABEL = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  qwen: 'Qwen Code',
  opencode: 'OpenCode',
  grok: 'Grok Build',
  pi: 'Pi',
  omp: 'OMP',
  kimi: 'Kimi Code',
  claudeDesktop: 'Claude Desktop',
  dsh: 'DeepSeek Harness',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  minimax: 'MiniMax Code',
  antigravity: 'Antigravity',
  copilot: 'Copilot CLI',
  iflow: 'iFlow CLI',
  codebuddy: 'CodeBuddy',
};
const PROTO_LABEL = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini' };
const WRITABLE_APPS = new Set(['claude', 'codex', 'gemini', 'qwen', 'opencode', 'grok', 'pi', 'omp', 'kimi', 'dsh']);
const visibleApps = (ov) => {
  const all = ov?.apps || [];
  const visible = all.filter((a) => !(ov?.settings?.hiddenApps || []).includes(a.key));
  return visible.length ? visible : all;
};

const state = {
  route: 'dashboard',
  app: 'claude',
  usageDays: 7,
  overview: null,
  providers: null,
  presets: null,
  gateway: null,
  usage: null,
  mcp: null,
  prompts: null,
  sessions: null,
  backups: null,
  settings: null,
  themePref: 'light',
  lang: 'zh',
};

/* ---------------- 主题 ---------------- */
const THEME_CHOICES = [
  ['light', '浅色'],
  ['dark', '深色'],
  ['system', '跟随系统'],
];
const LANG_CHOICES = [
  ['zh', '简体中文'],
  ['en', 'English'],
];
const prefersDark = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
};
function applyTheme(pref) {
  const choice = ['light', 'dark', 'system'].includes(pref) ? pref : 'light';
  state.themePref = choice;
  document.documentElement.dataset.theme = choice === 'system' ? (prefersDark() ? 'dark' : 'light') : choice;
  return state.themePref;
}
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.themePref === 'system') applyTheme('system');
  });
} catch {}

/* ---------------- 基础工具 ---------------- */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = (n) => {
  const v = Number(n || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e4) return (v / 1e3).toFixed(1) + 'k';
  return String(Math.round(v));
};

const timeAgo = (iso) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '—';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
};

const dt = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—');

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json', 'x-requested-with': 'xunlong-panel' },
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<svg width="16" height="16" style="flex:none;color:${type === 'err' ? 'var(--red)' : 'var(--green)'}"><use href="#${type === 'err' ? 'i-alert' : 'i-check'}"/></svg><div>${esc(t(msg))}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function copyText(text, label = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('复制失败，请手动选择', 'err');
  }
}

async function exportDiagnostics(btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api('/diagnostics/export', { method: 'POST', body: {} });
    state.lastDiagPath = r.path;
    toast('诊断包已保存到「' + r.dir + '」');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}


function askConfirm({ title, text, okLabel = '确定', danger = false, onOk }) {
  openModal({
    title,
    body: `<div class="sd" style="line-height:1.9">${esc(text)}</div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: okLabel,
        className: danger ? 'danger' : 'primary',
        onClick: async (btn) => {
          btn.disabled = true;
          try {
            await onOk();
          } finally {
            btn.disabled = false;
          }
        },
      },
    ],
  });
}

function openModal({ title, body, actions = [], wide = false }) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  $('#modal').classList.toggle('wide', wide);
  const foot = $('#modal-foot');
  foot.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn ${a.className || ''}`;
    b.textContent = a.label;
    b.onclick = () => a.onClick?.(b);
    foot.appendChild(b);
  }
  $('#modal-mask').classList.add('show');
  applyI18n($('#modal-body'));
  applyI18n(foot);
  return { body: $('#modal-body'), foot };
}

function closeModal() {
  $('#modal-mask').classList.remove('show');
}

$('#modal-mask').addEventListener('click', (e) => {
  if (e.target.id === 'modal-mask' || e.target.closest('[data-close]')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    $('#drawer').classList.remove('show');
    $('#drawer-mask').classList.remove('show');
  }
});

/* ---------------- 图表 ---------------- */
function barChart(rows) {
  const W = 760;
  const H = 190;
  const padL = 36;
  const padB = 26;
  const padT = 12;
  if (!rows?.length) return `<div class="empty">暂无数据</div>`;
  const max = Math.max(1, ...rows.map((r) => Number(r.requests || 0)));
  if (max === 1 && rows.every((r) => !r.requests)) return `<div class="empty" style="padding:52px"><p>还没有请求记录。启动网关并把 CLI 指向本地网关后，这里会出现趋势。</p></div>`;
  const bw = (W - padL - 12) / rows.length;
  const tickValues = [...new Set([0, Math.round(max / 2), max])];
  const bars = rows
    .map((r, i) => {
      const h = Math.max(1, (Number(r.requests || 0) / max) * (H - padB - padT));
      const x = padL + i * bw + 8;
      const y = H - padB - h;
      return `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(3, bw - 16).toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${r.date} · ${r.requests} 次 · ${fmt(r.input + r.output)} tokens</title></rect>
        <text class="axis" x="${(x + (bw - 16) / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${r.date.slice(5)}</text>`;
    })
    .join('');
  const grid = tickValues
    .map((v) => {
      const y = H - padB - (v / max) * (H - padB - padT);
      return `<line class="grid-line" x1="${padL}" x2="${W - 8}" y1="${y}" y2="${y}"/><text class="axis" x="4" y="${y + 3}">${v}</text>`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4f7cff"/><stop offset="100%" stop-color="rgba(79,124,255,.25)"/>
    </linearGradient></defs>${grid}${bars}</svg>`;
}

/* ---------------- 数据加载 ---------------- */
async function loadOverview(force = false) {
  if (!state.overview || force) state.overview = await api('/overview');
  return state.overview;
}
async function loadProviders(force = false) {
  if (!state.providers || force) state.providers = (await api('/providers')).items;
  return state.providers;
}
async function loadPresets(force = false) {
  if (!state.presets || force) state.presets = (await api('/presets')).items;
  return state.presets;
}
async function loadGateway(force = false) {
  if (!state.gateway || force) state.gateway = await api('/gateway');
  return state.gateway;
}
async function loadUsage(force = false) {
  if (!state.usage || force || state.usage.days !== state.usageDays) {
    state.usage = await api(`/usage?days=${state.usageDays}`);
  }
  return state.usage;
}

/* ---------------- 页面元信息 ---------------- */
const PAGES = {
  store: ['AI 商店', '浏览、配置和管理本机 AI 智能体'],
  accel: ['AI 通用加速', '镜像加速：GitHub / HuggingFace / Docker 等'],
  providers: ['模型管理', '添加你的 API Key，一键切换 CLI 配置'],
  skills: ['Skills', '本机已安装的技能'],
  market: ['插件市场', '公开开源 MCP 服务器，一键安装'],
  mcp: ['MCP 服务器', '统一管理并同步到各个 CLI'],
  prompts: ['提示词', '沉淀常用指令，一键复制'],
  sessions: ['会话', '浏览本机 CLI 的历史会话'],
  usage: ['Token 用量', '按天、按供应商、按模型查看请求与 Token'],
  gateway: ['本地网关', 'OpenAI / Anthropic 兼容入口，自动故障转移'],
  settings: ['设置', '备份、主题、端口与免费声明'],
  dashboard: ['仪表盘', '本地 AI 编程工具，一个面板管好'],
};

function setHeader(route) {
  const [title, sub] = PAGES[route] || ['', ''];
  const t = $('#page-title');
  const s = $('#page-sub');
  if (t) t.textContent = title;
  if (s) s.textContent = sub;
}

function pageHead(title, sub, actions = '') {
  return `<div class="page-head">
    <div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
    <div class="page-actions">${actions}</div>
  </div>`;
}

function updateGwIndicator(gw) {
  const el = $('#gw-indicator');
  if (!el) return;
  const on = gw?.running;
  el.innerHTML = `<span class="dot ${on ? 'on' : 'off'}"></span>${on ? `网关运行中 · ${gw.port}` : '网关未启动'}`;
}

/* ---------------- 路由 ---------------- */
function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  let name = PAGES[hash] ? hash : 'dashboard';
  if (hash.startsWith('app/')) { name = 'app'; state.detailApp = hash.slice(4); }
  if (hash.startsWith('desktop/')) { name = 'desktop'; state.desktopName = decodeURIComponent(hash.slice(8)); }
  state.route = name;
  setHeader(name);
  document.body.classList.toggle('settings-mode', name === 'settings');
  $$('#nav .nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  render();
}

async function render(force = false) {
  const view = $('#view');
  view.innerHTML = `<div class="skeleton">加载中…</div>`;
  try {
    if (state.route === 'desktop') await pageDesktopDetail(view, force);
    else if (state.route === 'app') await pageAppDetail(view, force);
    else if (state.route === 'store') await pageStore(view, force);
    else if (state.route === 'accel') await pageAccel(view, force);
    else if (state.route === 'skills') await pageSkills(view, force);
    else if (state.route === 'dashboard') await pageDashboard(view, force);
    else if (state.route === 'providers') await pageProviders(view, force);
    else if (state.route === 'gateway') await pageGateway(view, force);
    else if (state.route === 'usage') await pageUsage(view, force);
    else if (state.route === 'market') await pageMarket(view, force);
    else if (state.route === 'mcp') await pageMcp(view, force);
    else if (state.route === 'prompts') await pagePrompts(view, force);
    else if (state.route === 'sessions') await pageSessions(view, force);
    else if (state.route === 'settings') await pageSettings(view, force);
  } catch (err) {
    view.innerHTML = `<div class="card"><div class="notice"><svg><use href="#i-alert"/></svg><div><b>加载失败：</b>${esc(err.message)}</div></div></div>`;
  }
  const ov = state.overview || (await loadOverview().catch(() => null));
  const gw = state.gateway || ov?.gateway;
  if (gw) updateGwIndicator(gw);
  if (ov) {
    $('#nav-providers').textContent = ov.providerCount || '';
    $('#app-version').textContent = ov.version || '1.0.0';
    renderSide(ov);
  }
  // 轻量刷新网关状态，保证顶栏指示器始终准确
  api('/gateway')
    .then((g) => {
      state.gateway = g;
      updateGwIndicator(g);
    })
    .catch(() => {});
  applyI18n();
}

/* ================= 仪表盘 ================= */
async function pageDashboard(root, force) {
  const ov = await loadOverview(force);
  const u = ov.usage;
  state.gateway = ov.gateway;
  const today = u.byDay[u.byDay.length - 1] || { requests: 0, input: 0, output: 0 };
  const apps = visibleApps(ov);

  const stat = (label, value, hint, glow = 'var(--accent)') => `
    <div class="card stat"><div class="glow" style="background:${glow}"></div>
      <div class="label">${esc(label)}</div><div class="value">${value}</div><div class="hint">${esc(hint)}</div></div>`;

  const appRows = apps
    .map(
      (a) => `<div class="list-item">
        <span class="dot ${a.installed ? 'on' : 'off'}"></span>
        <div class="list-main">
          <div class="list-title">${esc(a.label)} ${a.installed ? '' : '<span class="badge gray">未检测到</span>'}${a.readOnly ? '<span class="badge">只读</span>' : ''}</div>
          <div class="list-sub">${a.current?.baseUrl ? esc(a.current.baseUrl) : esc(a.current?.provider || '未配置')} ${a.current?.model ? '· ' + esc(a.current.model) : ''}</div>
        </div>
        <button class="btn sm" ${a.readOnly ? `data-open-app="${a.key}"` : 'data-goto="providers"'}>${a.readOnly ? '查看' : '配置'}</button>
      </div>`,
    )
    .join('');

  const recent = u.recent.slice(0, 8);
  const recentRows = recent.length
    ? recent
        .map(
          (r) => `<tr><td>${esc(r.providerName || '—')}</td><td class="mono">${esc(r.model || '—')}</td>
          <td>${fmt(r.input)} / ${fmt(r.output)}</td><td>${r.status}</td><td>${timeAgo(r.ts)}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="5"><div class="empty" style="padding:26px"><p>还没有请求记录。启动网关后，把 CLI 指向本地网关即可统计。</p></div></td></tr>`;

  root.innerHTML = `
    <div class="grid grid-4">
      ${stat('供应商', ov.providerCount, `${ov.presetsCount} 个预设可选`, 'var(--accent)')}
      ${stat('今日请求', fmt(today.requests), `近 7 天 ${fmt(u.totals.requests)} 次`, '#22d3ee')}
      ${stat('今日 Tokens', fmt(today.input + today.output), `输入 ${fmt(today.input)} / 输出 ${fmt(today.output)}`, '#34d399')}
      ${stat('聚合网关', ov.gateway.running ? '运行中' : '未启动', ov.gateway.running ? `端口 ${ov.gateway.port}` : '点击右侧启动', '#f5b942')}
    </div>

    <div class="grid" style="grid-template-columns: 1.55fr 1fr; margin-top:16px">
      <div class="card">
        <div class="card-head"><div><div class="card-title"><svg><use href="#i-chart"/></svg>近 7 天请求趋势</div>
        <div class="card-note">仅统计经过本地网关的请求</div></div>
        <button class="btn sm ghost" data-goto="usage">查看明细</button></div>
        ${usageChart(u.byDay, state.usageMetric || 'requests')}
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title"><svg><use href="#i-server"/></svg>CLI 状态</div></div>
        ${appRows}
      </div>
    </div>

    ${ov.providerCount === 0 ? onboardingCard() : ''}

    <div class="card tight" style="margin-top:16px">
      <div class="card-head" style="padding:16px 18px 10px;margin:0"><div class="card-title"><svg><use href="#i-clock"/></svg>最近请求</div></div>
      <table class="table"><thead><tr><th>供应商</th><th>模型</th><th>Token（入/出）</th><th>状态</th><th>时间</th></tr></thead>
      <tbody>${recentRows}</tbody></table>
    </div>`;

  $$('[data-goto]', root).forEach((b) => (b.onclick = () => (location.hash = `#/${b.dataset.goto}`)));
  $$('[data-open-app]', root).forEach((b) => (b.onclick = () => (location.hash = '#/app/' + b.dataset.openApp)));
  $('#btn-onboard-scan')?.addEventListener('click', () => openScanModal());
  $('#btn-onboard-add')?.addEventListener('click', () => openProviderForm({ defaultApp: state.app || 'claude', apps: ov.apps || [] }));

  if (ov.providerCount === 0 && !sessionStorage.getItem('scanAutoShown')) {
    sessionStorage.setItem('scanAutoShown', '1');
    setTimeout(() => openScanModal(), 700);
  }
}

function onboardingCard() {
  return `<div class="card" style="margin-top:16px;border-color:rgba(79,124,255,.35)">
    <div class="card-head"><div><div class="card-title"><svg><use href="#i-zap"/></svg>三步开始</div>
    <div class="card-note">全程本地，无需注册账号</div></div></div>
    <div class="grid grid-3">
      <div><div class="badge blue">第 1 步</div><h3 style="font-size:14px;margin:10px 0 6px">添加供应商</h3>
      <p style="color:var(--muted);font-size:12.5px;line-height:1.7;margin:0">从 75 个官方预设里选一个，填入你自己的 API Key。</p></div>
      <div><div class="badge blue">第 2 步</div><h3 style="font-size:14px;margin:10px 0 6px">一键切换</h3>
      <p style="color:var(--muted);font-size:12.5px;line-height:1.7;margin:0">自动写入 Claude Code / Codex / Gemini / Qwen / Kimi 等 CLI 配置，并保留备份。</p></div>
      <div><div class="badge blue">第 3 步</div><h3 style="font-size:14px;margin:10px 0 6px">启动网关</h3>
      <p style="color:var(--muted);font-size:12.5px;line-height:1.7;margin:0">本地聚合多供应商，自动故障转移，统计每一次调用。</p></div>
    </div>
    <div style="margin-top:16px" class="row">
      <button class="btn primary" id="btn-onboard-add"><svg><use href="#i-plus"/></svg>添加第一个供应商</button>
      <button class="btn" id="btn-onboard-scan"><svg><use href="#i-search"/></svg>扫描本机已安装的 AI 应用</button>
    </div>
  </div>`;
}

/* ================= 供应商 ================= */
async function pageProviders(root, force) {
  const [list, presets, ov] = await Promise.all([loadProviders(force), loadPresets(), loadOverview(force)]);
  // 只读识别应用（OpenClaw / Hermes / MiniMax / Claude Desktop）只在 AI 商店与应用详情里查看，不占模型管理标签页
  const writable = visibleApps(ov).filter((a) => !a.readOnly);
  const apps = writable.length ? writable : (ov?.apps || []).filter((a) => !a.readOnly);
  const app = apps.some((a) => a.key === state.app) ? state.app : apps[0]?.key || 'claude';
  state.app = app;
  const appInfo = apps.find((a) => a.key === app) || {};
  const items = list.filter((p) => p.app === app);
  const active = items.find((p) => p.activatedAt);
  const q = (state.providersQuery || '').trim().toLowerCase();
  const filter = state.providersFilter || 'all';
  const filtered = items.filter((p) => {
    if (filter === 'active' && !p.activatedAt) return false;
    if (filter === 'idle' && p.activatedAt) return false;
    if (!q) return true;
    return `${p.name} ${p.model} ${p.baseUrl} ${p.group || ''}`.toLowerCase().includes(q);
  });

  const colors = { claude: '#d97757', codex: '#10a37f', gemini: '#4285f4', qwen: '#615ced', opencode: '#4b5563', grok: '#111827', pi: '#0ea5e9', omp: '#7c3aed' };
  const tabs = apps
    .map(
      (a) => `<button class="app-tab ${a.key === app ? 'active' : ''}" data-app="${a.key}">
        ${APP_ICONS.has(a.key) ? appIcon(a.key, a.label) : ''}${esc(a.label)}</button>`,
    )
    .join('');

  const rows = filtered.length
    ? filtered
        .map((p) => {
          const isActive = Boolean(p.activatedAt);
          return `<div class="prov-row ${isActive ? 'active' : ''}">
            <div class="row-ico">${esc((p.name || '?').slice(0, 1).toUpperCase())}</div>
            <div class="row-main">
              <div class="row-title">${esc(p.name)} ${p.group ? `<span class="badge">${esc(p.group)}</span>` : ''}</div>
              <div class="row-url">${esc(p.baseUrl || '—')}</div>
            </div>
            <div class="row-right">
              <span class="row-meta">${esc(p.model || '默认模型')}</span>
              ${isActive ? '<span class="row-status"><span class="dot on"></span>使用中</span>' : '<span class="row-meta">未启用</span>'}
              <div class="row-actions">
                <button class="act" data-act="activate" data-id="${p.id}" title="${isActive ? '重新应用' : '切换到此'}"><svg width="15" height="15"><use href="#i-play"/></svg></button>
                <button class="act" data-act="edit" data-id="${p.id}" title="编辑"><svg width="15" height="15"><use href="#i-edit"/></svg></button>
                <button class="act" data-act="copy" data-id="${p.id}" title="复制"><svg width="15" height="15"><use href="#i-copy"/></svg></button>
                <button class="act danger" data-act="del" data-id="${p.id}" title="删除"><svg width="15" height="15"><use href="#i-trash"/></svg></button>
                <button class="act" data-act="more" data-id="${p.id}" title="更多"><svg width="15" height="15"><use href="#i-more"/></svg></button>
              </div>
            </div>
          </div>`;
        })
        .join('')
    : `<div class="card empty"><div class="big">＋</div><h3>还没有 ${esc(APP_LABEL[app] || app)} 供应商</h3>
       <p>从预设添加，或扫描本机已有配置。</p><button class="btn primary" id="btn-add-empty">添加供应商</button></div>`;

  root.innerHTML = `
    ${pageHead(
      '模型管理',
      '管理各 AI 工具的供应商：切换、新增、编辑、复制与故障转移',
      `<input class="input" id="prov-search" placeholder="搜索供应商…" value="${esc(state.providersQuery || '')}" style="width:190px" />
       <button class="icon-round" id="btn-scan" title="扫描本机"><svg width="16" height="16"><use href="#i-search"/></svg></button>
       <button class="btn primary" id="btn-custom"><svg><use href="#i-plus"/></svg>新增供应商</button>`,
    )}
    <div class="app-tabs">${tabs}</div>
    <div class="sub-toolbar">
      <button class="sub-pill ${filter === 'all' ? 'active' : ''}" data-filter="all">全部 ${items.length}</button>
      <button class="sub-pill ${filter === 'active' ? 'active' : ''}" data-filter="active">使用中</button>
      <button class="sub-pill ${filter === 'idle' ? 'active' : ''}" data-filter="idle">未启用</button>
      <button class="sub-pill" id="btn-preset"><svg width="13" height="13"><use href="#i-download"/></svg>从预设添加</button>
      <span class="spacer"></span>
      <span class="card-note">${esc(appInfo.configPath || '')}</span>
    </div>
    <div class="prov-list">${rows}</div>`;

  $$('.app-tab', root).forEach((t) => (t.onclick = () => { state.app = t.dataset.app; render(true); }));
  $$('[data-filter]', root).forEach((b) => (b.onclick = () => { state.providersFilter = b.dataset.filter; render(true); }));
  $('#btn-preset')?.addEventListener('click', () => openPresetPicker(app, presets));
  $('#btn-custom')?.addEventListener('click', () => openProviderForm({ defaultApp: app, apps }));
  $('#btn-add-empty')?.addEventListener('click', () => openProviderForm({ defaultApp: app, apps }));
  $('#btn-scan')?.addEventListener('click', () => openScanModal());

  let searchTimer = null;
  $('#prov-search')?.addEventListener('input', (e) => {
    if (e.isComposing) return;
    state.providersQuery = e.target.value;
    const pos = e.target.selectionStart;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      await render(true);
      const el = $('#prov-search');
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    }, 260);
  });

  $$('[data-act]', root).forEach((b) => {
    const id = b.dataset.id;
    const p = items.find((x) => x.id === id);
    if (!p) return;
    b.onclick = async (ev) => {
      const act = b.dataset.act;
      if (act === 'del') {
        if (!confirm(`确定删除「${p.name}」？`)) return;
        try {
          await api(`/providers/${id}`, { method: 'DELETE' });
          state.providers = null;
          toast('已删除');
          await render(true);
        } catch (e) {
          toast(e.message, 'err');
        }
        return;
      }
      if (act === 'activate') {
        b.disabled = true;
        try {
          const r = await api(`/providers/${id}/activate`, { body: {} });
          toast(r.note || '已切换');
          state.providers = null;
          state.overview = null;
          await render(true);
        } catch (e) {
          toast(e.message, 'err');
          b.disabled = false;
        }
      }
      if (act === 'edit') openProviderForm({ provider: p, apps });
      if (act === 'copy') {
        try {
          const k = await api(`/providers/${id}/key`);
          await api('/providers', {
            body: {
              app: p.app,
              name: `${p.name} 副本`,
              protocol: p.protocol,
              baseUrl: p.baseUrl,
              apiKey: k.apiKey || '',
              model: p.model,
              models: p.models,
              group: p.group || '',
              note: p.note || '',
            },
          });
          state.providers = null;
          toast('已复制');
          render(true);
        } catch (e) {
          toast(e.message, 'err');
        }
      }
      if (act === 'more') {
        ev.stopPropagation();
        const row = b.closest('.prov-row');
        const old = row.querySelector('.menu');
        $$('.menu', root).forEach((m) => m.remove());
        if (old) return;
        const menu = document.createElement('div');
        menu.className = 'menu';
        menu.innerHTML = `<button data-m="copy">复制</button><button data-m="test">检测连通</button><button data-m="usage">配置用量查询</button><div class="sep"></div><button class="danger" data-m="del">删除</button>`;
        row.appendChild(menu);
        menu.addEventListener('click', async (e) => {
          const m = e.target.closest('[data-m]')?.dataset.m;
          if (!m) return;
          menu.remove();
          if (m === 'copy') {
            try {
              const k = await api(`/providers/${id}/key`);
              await api('/providers', { body: { app: p.app, name: `${p.name} 副本`, protocol: p.protocol, baseUrl: p.baseUrl, apiKey: k.apiKey || '', model: p.model, models: p.models, group: p.group || '' } });
              state.providers = null;
              toast('已复制');
              render(true);
            } catch (err) { toast(err.message, 'err'); }
          }
          if (m === 'test') {
            toast('测试中…');
            try {
              const r = await api(`/providers/${id}/test`, { body: {} });
              toast(r.ok ? `连接成功 · ${r.latency}ms · ${r.count} 个模型` : `连接失败：${r.error}`, r.ok ? 'ok' : 'err');
            } catch (err) { toast(err.message, 'err'); }
          }
          if (m === 'usage') openUsageConfig(p);
          if (m === 'del') {
            if (!confirm(`确定删除「${p.name}」？`)) return;
            await api(`/providers/${id}`, { method: 'DELETE' });
            state.providers = null;
            toast('已删除');
            render(true);
          }
        });
      }
    };
  });
}


function openUsageConfig(p) {
  const q = p.usageQuery || { mode: 'auto' };
  openModal({
    title: `配置用量查询 · ${p.name}`,
    body: `
      <div class="field"><label>查询方式</label>
        <select class="select" id="uq-mode">
          <option value="auto" ${q.mode !== 'custom' && q.mode !== 'off' ? 'selected' : ''}>自动（按供应商域名识别）</option>
          <option value="custom" ${q.mode === 'custom' ? 'selected' : ''}>自定义接口</option>
          <option value="off" ${q.mode === 'off' ? 'selected' : ''}>关闭查询</option>
        </select>
        <div class="hint">自动模式使用官方公开余额接口；自定义模式适用于中转/自建服务。</div>
      </div>
      <div id="uq-custom" style="display:${q.mode === 'custom' ? 'block' : 'none'}">
        <div class="field"><label>接口地址</label>
          <input class="input mono" id="uq-url" value="${esc(q.url || '')}" placeholder="https://api.example.com/v1/user/balance" />
          <div class="hint">仅允许 HTTPS；保存后会把该供应商的 Key 作为 Bearer Token 发往此地址。</div></div>
        <div class="field"><label>余额字段路径</label>
          <input class="input mono" id="uq-path" value="${esc(q.path || '')}" placeholder="data.balance" />
          <div class="hint">用点号取嵌套字段，例如 data.balance 或 balance_infos.0.total_balance</div></div>
        <div class="field"><label>附加请求头（JSON，可选）</label>
          <input class="input mono" id="uq-headers" value="${esc(q.headers || '')}" placeholder='{"X-Api-Key":"..."}' /></div>
        <div class="field"><label>货币</label>
          <input class="input" id="uq-currency" value="${esc(q.currency || 'CNY')}" placeholder="CNY" /></div>
      </div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: '保存并测试',
        className: 'primary',
        onClick: async (btn) => {
          const mode = $('#uq-mode').value;
          const usageQuery = {
            mode,
            url: $('#uq-url')?.value.trim() || '',
            path: $('#uq-path')?.value.trim() || '',
            headers: $('#uq-headers')?.value.trim() || '',
            currency: $('#uq-currency')?.value.trim() || 'CNY',
          };
          btn.disabled = true;
          btn.textContent = '保存中…';
          try {
            await api(`/providers/${p.id}`, { method: 'PUT', body: { usageQuery } });
            state.providers = null;
            const r = await api(`/providers/${p.id}/balance`, { body: {} });
            closeModal();
            showBalance(p, r);
          } catch (err) {
            toast(err.message, 'err');
            btn.disabled = false;
            btn.textContent = '保存并测试';
          }
        },
      },
    ],
  });
  $('#uq-mode').addEventListener('change', (e) => {
    $('#uq-custom').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });
}

function showBalance(p, r) {
  const body = r.ok
    ? `<div class="kv"><span class="k">供应商</span><span class="v">${esc(p.name)}</span></div>
       <div class="kv"><span class="k">余额</span><span class="v" style="font-size:20px;font-weight:700">${esc(r.currency || '')} ${Number(r.balance || 0).toFixed(2)}</span></div>
       <div class="kv"><span class="k">可用</span><span class="v">${r.available ? '是' : '否'}</span></div>
       <div class="kv"><span class="k">查询时间</span><span class="v">${dt(r.checkedAt)}</span></div>
       ${r.detail ? `<pre class="mono" style="white-space:pre-wrap;font-size:11px;color:var(--muted);max-height:180px;overflow:auto">${esc(JSON.stringify(r.detail, null, 2))}</pre>` : ''}`
    : `<div class="notice"><svg><use href="#i-alert"/></svg><div>${esc(r.message || '查询失败')}</div></div>`;
  openModal({ title: '余额 / 额度', body, actions: [{ label: '关闭', onClick: closeModal }] });
}

function openPresetPicker(app, presets) {
  const items = presets.filter((p) => p.app === app);
  const body = `
    <div class="field"><input class="input" id="preset-search" placeholder="搜索预设名称 / 平台…" /></div>
    <div id="preset-list" style="display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto">
      ${items
        .map(
          (p) => `<button class="list-item" style="border:1px solid var(--border-soft);border-radius:10px;background:transparent;color:inherit;text-align:left;cursor:pointer" data-preset="${p.id}">
            <div class="prov-avatar" style="width:30px;height:30px;font-size:12px">${esc(p.name.slice(0, 1))}</div>
            <div class="list-main"><div class="list-title">${esc(p.name)} ${p.badge ? `<span class="badge blue">${esc(p.badge)}</span>` : ''}</div>
            <div class="list-sub">${esc(p.baseUrl || '自定义地址')} · ${esc(p.model || '')}</div></div>
            <svg width="16" height="16" style="color:var(--dim)"><use href="#i-plus"/></svg>
          </button>`,
        )
        .join('')}
    </div>`;
  openModal({ title: `从预设添加 · ${APP_LABEL[app]}`, body, wide: true, actions: [{ label: '取消', onClick: closeModal }] });
  const input = $('#preset-search');
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    $$('#preset-list [data-preset]').forEach((el) => {
      el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  };
  $$('#preset-list [data-preset]').forEach((el) => {
    el.onclick = () => {
      const preset = items.find((p) => p.id === el.dataset.preset);
      closeModal();
      setTimeout(() => openProviderForm({ preset, apps: state.overview?.apps || [], defaultApp: app }), 60);
    };
  });
}

function openProviderForm({ preset = null, provider = null, apps = [], defaultApp = 'claude' }) {
  const isEdit = Boolean(provider);
  const app = provider?.app || preset?.app || defaultApp;
  const data = provider || preset || {};
  const appOptions = (Array.isArray(apps) && apps.length ? apps : [...WRITABLE_APPS].map((key) => ({ key, label: APP_LABEL[key] })))
    .filter((item) => item?.key && WRITABLE_APPS.has(item.key));
  if (app && WRITABLE_APPS.has(app) && !appOptions.some((item) => item.key === app)) {
    appOptions.unshift({ key: app, label: APP_LABEL[app] || app });
  }
  const body = `
    <div class="field"><label>应用</label>
      <select class="select" id="f-app" ${isEdit ? 'disabled' : ''}>
        ${appOptions.map((item) => `<option value="${item.key}" ${item.key === app ? 'selected' : ''}>${esc(item.label || item.key)}</option>`).join('')}
      </select></div>
    <div class="field"><label>名称</label><input class="input" id="f-name" value="${esc(data.name || '')}" placeholder="例如 DeepSeek" /></div>
    <div class="field"><label>分组（可选）</label><input class="input" id="f-group" value="${esc(data.group || '')}" placeholder="如：国内 / 公司 / 备用" /></div>
    <div class="field"><label>Base URL</label><input class="input mono" id="f-baseurl" value="${esc(data.baseUrl || '')}" placeholder="https://api.example.com/v1" />
      <div class="hint">Anthropic 协议填到域名根即可，OpenAI 协议通常以 /v1 结尾。</div></div>
    <div class="field"><label>API Key</label><input class="input mono" id="f-key" value="${isEdit ? '' : esc(data.apiKey || '')}" placeholder="${isEdit ? '留空表示不修改' : 'sk-…'}" />
      <div class="hint">只保存在本机 config.json，不会上传。</div></div>
    <div class="row" style="gap:12px">
      <div class="field" style="flex:1"><label>协议</label>
        <select class="select" id="f-proto">
          ${( ['opencode','pi','omp','grok'].includes(app) ? ['openai'] : Object.keys(PROTO_LABEL)).map((k) => `<option value="${k}" ${(data.protocol || (app === 'claude' ? 'anthropic' : app === 'gemini' ? 'gemini' : 'openai')) === k ? 'selected' : ''}>${PROTO_LABEL[k]}</option>`).join('')}
        </select></div>
      <div class="field" style="flex:1"><label>模型</label><input class="input mono" id="f-model" value="${esc(data.model || '')}" placeholder="deepseek-chat" list="model-list" />
        <datalist id="model-list">${(data.models || []).map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist></div>
    </div>
    <div class="field"><label>备注（可选）</label><input class="input" id="f-note" value="${esc(data.note || '')}" /></div>
    <div id="test-result"></div>`;

  openModal({
    title: isEdit ? `编辑供应商 · ${provider.name}` : preset ? `添加预设 · ${preset.name}` : '自定义供应商',
    body,
    actions: [
      { label: '测试连接', onClick: async (btn) => {
          btn.disabled = true;
          btn.textContent = '测试中…';
          try {
            const keyVal = $('#f-key').value.trim();
            const r =
              isEdit && !keyVal
                ? await api(`/providers/${provider.id}/test`, { body: {} })
                : await api('/providers/test', {
                    body: {
                      protocol: $('#f-proto').value,
                      baseUrl: $('#f-baseurl').value,
                      apiKey: keyVal,
                    },
                  });
            $('#test-result').innerHTML = r.ok
              ? `<div class="notice" style="border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.07)"><svg><use href="#i-check"/></svg><div>连接成功 · ${r.latency}ms · ${r.count} 个模型</div></div>`
              : `<div class="notice" style="border-color:rgba(248,113,113,.35);background:rgba(248,113,113,.07)"><svg><use href="#i-alert"/></svg><div>连接失败：${esc(r.error)}</div></div>`;
          } catch (e) {
            $('#test-result').innerHTML = `<div class="notice"><svg><use href="#i-alert"/></svg><div>${esc(e.message)}</div></div>`;
          }
          btn.disabled = false;
          btn.textContent = '测试连接';
        } },
      { label: '取消', onClick: closeModal },
      { label: isEdit ? '保存修改' : '添加', className: 'primary', onClick: async (btn) => {
          const payload = {
            app: $('#f-app').value,
            name: $('#f-name').value.trim(),
            group: $('#f-group')?.value.trim() || '',
            baseUrl: $('#f-baseurl').value.trim(),
            model: $('#f-model').value.trim(),
            protocol: $('#f-proto').value,
            note: $('#f-note').value.trim(),
            website: data.website || '',
            keyUrl: data.keyUrl || '',
            models: data.models || [],
          };
          const key = $('#f-key').value.trim();
          if (key) payload.apiKey = key;
          if (!payload.name || !payload.baseUrl) return toast('请填写名称与 Base URL', 'err');
          btn.disabled = true;
          try {
            if (isEdit) await api(`/providers/${provider.id}`, { method: 'PUT', body: payload });
            else await api('/providers', { body: payload });
            closeModal();
            state.providers = null;
            state.overview = null;
            toast(isEdit ? '已保存' : '已添加');
            render(true);
          } catch (e) {
            toast(e.message, 'err');
            btn.disabled = false;
          }
        } },
    ],
    wide: true,
  });
}

/* ================= AI 商店 ================= */

const APP_ICONS = new Set(['claude', 'claudeDesktop', 'codex', 'gemini', 'grok', 'opencode', 'deepseek', 'qwen', 'kimi', 'minimax', 'ollama']);
function appIcon(key, label, cls = '') {
  const ch = esc((label || '?').slice(0, 1));
  if (APP_ICONS.has(key)) return `<img class="app-ico ${cls}" src="/icons/${key}.svg" alt="${ch}" />`;
  const colors = { claude: '#d97757', codex: '#10a37f', gemini: '#4285f4', qwen: '#615ced', opencode: '#4b5563', grok: '#111827', pi: '#0ea5e9', omp: '#7c3aed', claudeDesktop: '#d97757', kimi: '#111827', dsh: '#4d6bfe', openclaw: '#e5484d', hermes: '#111827', minimax: '#ff5c5c', antigravity: '#4285f4' };
  return `<span class="ico-letter" style="background:${colors[key] || '#8b93a7'}">${ch}</span>`;
}

const APP_DESC = {
  claude: 'Anthropic 官方 CLI 编程代理',
  codex: 'OpenAI 官方 CLI 编程代理',
  gemini: 'Google Gemini 命令行代理',
  qwen: '通义千问命令行编程代理',
  opencode: '开源终端 AI 编程代理',
  grok: 'xAI Grok 构建代理',
  pi: '可扩展的终端 AI 编程代理',
  omp: 'Oh My Pi 终端代理',
  kimi: '月之暗面 Kimi Code CLI，配置写入 ~/.kimi-code/config.toml',
  claudeDesktop: 'Claude 桌面客户端，账号登录，只读取安装与配置信息',
  dsh: 'DeepSeek Harness 桌面智能体，配置写入 cordis.patch.yml',
  openclaw: 'OpenClaw 多模型终端代理，只读取现有 provider 配置',
  hermes: 'Nous Research Hermes Agent，只读取现有 provider 配置',
  minimax: 'MiniMax Code 桌面/终端代理，只读取现有 provider 配置',
};

function renderSide(ov) {
  const box = $('#side-apps');
  if (box) box.innerHTML = '<div class="side-app" style="color:var(--dim)">扫描中…</div>';
  api('/desktop-apps').then((d) => {
    const desk = (d.items || []).slice(0, 10);
    const box2 = $('#side-apps');
    if (!box2) return;
    box2.innerHTML = desk.length
      ? desk
          .map(
            (x) =>
              `<div class="side-app" data-side-desktop="${encodeURIComponent(x.name)}"><span class="dot on"></span><span class="nm">${esc(x.name)}</span></div>`,
          )
          .join('')
      : '<div class="side-app" style="color:var(--dim)">未检测到桌面 AI 应用</div>';
    $$('[data-side-desktop]', box2).forEach((el) => (el.onclick = () => (location.hash = '#/desktop/' + el.dataset.sideDesktop)));
  }).catch(() => {});

  const avail = $('#badge-available');
  const inst = $('#badge-installed');
  if (avail) avail.textContent = `${ov.presetsCount || 0} 个可用`;
  if (inst) inst.textContent = '';
  const gw = state.gateway || ov.gateway;
  const dot = $('#side-gw-dot');
  const txt = $('#side-gw-text');
  if (dot) dot.className = 'dot ' + (gw?.running ? 'on' : 'off');
  if (txt) txt.textContent = gw?.running ? `运行中 · 端口 ${gw.port}` : '未启动';
  const card = $('#side-gateway');
  if (card) card.onclick = () => (location.hash = '#/gateway');
  const accel = $('#side-accel');
  if (accel) accel.onclick = () => (location.hash = '#/accel');
}

async function pageStore(root, force) {
  const [ov, providers] = await Promise.all([loadOverview(force), loadProviders()]);
  const apps = visibleApps(ov);
  const installed = apps.filter((a) => a.installed);
  const configured = apps.filter((a) => a.current?.baseUrl || a.current?.provider || a.current?.model);
  const current = providers.find((p) => p.app === 'claude' && p.activatedAt) || providers.find((p) => p.activatedAt);

  const heroItem = (icon, name) => `<div class="hero-item"><div class="hero-icon"><svg><use href="#${icon}"/></svg></div>
    <div class="nm">${name}<svg><use href="#i-chevron"/></svg></div></div>`;

  const cards = apps
    .map((a) => {
      const has = Boolean(a.current?.baseUrl || a.current?.provider || a.current?.model);
      return `<div class="store-card" data-detail="${a.key}">
        ${a.readOnly ? '<span class="badge gray installed">仅识别</span>' : a.installed ? '<span class="badge green installed">已安装</span>' : ''}
        <div class="store-logo">${appIcon(a.key, a.label, 'lg')}</div>
        <div class="store-name">${esc(a.label)}</div>
        <div class="store-ver">${esc((a.protocol || '').toUpperCase())}</div>
        <div class="store-desc">${esc(APP_DESC[a.key] || '')}</div>
        <button class="store-btn ${has ? '' : 'primary'}" data-cfg="${a.key}">${a.readOnly ? '查看配置' : has ? '已配置' : '一键配置'}</button>
      </div>`;
    })
    .join('');

  root.innerHTML = `
    ${pageHead(
      'AI 商店',
      '浏览、配置和管理本机 AI 智能体 · 安装请使用各应用官方安装包',
      `<span class="badge blue">${apps.length} 个可用</span>
       <span class="badge green">${installed.length} 个已安装</span>
       <button class="btn primary" id="store-scan"><svg><use href="#i-search"/></svg>扫描本机</button>`,
    )}
    <div class="store-section" style="margin-top:2px">
      <div class="store-section-title">推荐</div>
      <div class="hero-row">
        <div class="hero">
          <div class="hero-inner">
            <div class="hero-title">工具箱 <span class="pill-vip" style="background:linear-gradient(135deg,#ffd76e,#f0b429)">免费</span></div>
            <div class="hero-items" id="hero-items">
              ${heroItem('i-search', '扫描本机')}
              ${heroItem('i-route', '本地网关')}
              ${heroItem('i-download', '备份恢复')}
            </div>
          </div>
        </div>
        <div class="mini-card">
          <div class="top">
            <div class="mini-icon"><svg><use href="#i-server"/></svg></div>
            <div style="min-width:0">
              <div class="nm">${esc(current?.name || '暂无默认供应商')} <span class="badge ${current ? 'green' : 'gray'}">${current ? '已启用' : '未配置'}</span></div>
              <div class="ver">${esc(current?.model || '添加后即可一键切换')}</div>
            </div>
          </div>
          <div class="desc truncate">${esc(current?.baseUrl || '支持 75 个官方预设，也可以填任意兼容端点')}</div>
          <div class="foot"><button class="store-btn" data-goto="providers">管理模型</button></div>
        </div>
        <div class="mini-card">
          <div class="top">
            <div class="mini-icon"><svg><use href="#i-download"/></svg></div>
            <div style="min-width:0">
              <div class="nm">本机配置 <span class="badge blue">${configured.length} 个</span></div>
              <div class="ver">${installed.length} 个 CLI 已安装</div>
            </div>
          </div>
          <div class="desc">从现有配置一键导入，Key 只保存在本机。</div>
          <div class="foot"><button class="store-btn" id="store-scan2">导入现有配置</button></div>
        </div>
      </div>
    </div>

    <div class="store-section">
      <div class="store-section-title">AI 智能体</div>
      <div class="store-grid">${cards}</div>
    </div>

    `;

  $('#store-scan')?.addEventListener('click', () => openScanModal());
  $('#store-scan2')?.addEventListener('click', () => openScanModal());
  $$('[data-goto]', root).forEach((b) => (b.onclick = () => (location.hash = `#/${b.dataset.goto}`)));
  $$('[data-detail]', root).forEach((card) => (card.onclick = (e) => { if (e.target.closest('[data-cfg]')) return; location.hash = '#/app/' + card.dataset.detail; }));
  $$('[data-cfg]', root).forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.cfg;
      const app = apps.find((a) => a.key === key);
      if (app?.readOnly) { location.hash = '#/app/' + key; return; }
      state.app = key;
      if (app?.current?.baseUrl) location.hash = '#/app/' + key;
      else openProviderForm({ defaultApp: key, apps });
    };
  });
  const items = $$('#hero-items .hero-item');
  if (items[0]) items[0].onclick = () => openScanModal();
  if (items[1]) items[1].onclick = () => (location.hash = '#/gateway');
  if (items[2]) items[2].onclick = () => (location.hash = '#/settings');
}

/* ================= Skills ================= */
function skillStateText(st) {
  return {
    link: '链接共享',
    copy: '复制副本',
    'other-link': '其他链接',
    'broken-link': '链接失效',
    missing: '未连接',
    other: '占用',
  }[st] || '未知';
}

function skillStateClass(st) {
  if (st === 'link') return 'link';
  if (st === 'copy') return 'copy';
  if (st === 'missing' || st === 'broken-link') return 'off';
  return 'warn';
}

function skillTargetText(targets, app) {
  const st = targets?.[app] || 'missing';
  const label = targetLabelMap.get(app) || app;
  return `<span class="skill-chip ${skillStateClass(st)}" title="${esc(label)}：${esc(skillStateText(st))}">${esc(label)} · ${esc(skillStateText(st))}</span>`;
}

let targetLabelMap = new Map();

// —— 分类（技能 / MCP / 插件 / 提示词共用） ——
const CAT_BASE = [
  ['dev', '开发'], ['docs', '文档'], ['data', '数据'], ['web', '浏览/网页'],
  ['collab', '协作'], ['sys', '系统/文件'], ['ai', 'AI/模型'], ['other', '其他'],
];
let CAT_ITEMS = null;

async function ensureCats() {
  if (CAT_ITEMS) return CAT_ITEMS;
  try {
    const r = await api('/categories');
    CAT_ITEMS = (r.items || []).map((c) => [c.key, c.label]);
  } catch {
    CAT_ITEMS = CAT_BASE.slice();
  }
  if (!CAT_ITEMS.length) CAT_ITEMS = CAT_BASE.slice();
  return CAT_ITEMS;
}

function catLabelOf(key) {
  const hit = (CAT_ITEMS || CAT_BASE).find((c) => c[0] === key);
  return hit ? hit[1] : '其他';
}

function catFilterRow(kind, items) {
  const cur = (state.catFilter && state.catFilter[kind]) || 'all';
  const counts = {};
  for (const it of items) counts[it.category || 'other'] = (counts[it.category || 'other'] || 0) + 1;
  const keys = ['all', ...(CAT_ITEMS || CAT_BASE).map((c) => c[0]).filter((k) => counts[k])];
  return `<div class="cat-row">${keys
    .map(
      (k) =>
        `<button class="cat-chip${k === cur ? ' active' : ''}" data-cat-filter="${kind}" data-cat-key="${k}">${
          k === 'all' ? '全部' : esc(catLabelOf(k))
        } ${k === 'all' ? items.length : counts[k]}</button>`,
    )
    .join('')}</div>`;
}

function catSelect(kind, id, current) {
  return `<select class="cat-select" data-cat-kind="${kind}" data-cat-id="${esc(id)}" title="分类"><option value=""${
    current ? '' : ' selected'
  }>自动</option>${(CAT_ITEMS || CAT_BASE)
    .map(([k, l]) => `<option value="${k}"${k === current ? ' selected' : ''}>${esc(l)}</option>`)
    .join('')}</select>`;
}

function filteredByCat(kind, items) {
  const cur = (state.catFilter && state.catFilter[kind]) || 'all';
  return cur === 'all' ? items : items.filter((i) => (i.category || 'other') === cur);
}

async function setCategory(kind, id, value, reload) {
  if (kind === 'mcp') await api(`/mcp/${id}`, { method: 'PUT', body: { category: value } });
  else if (kind === 'prompts') await api(`/prompts/${id}`, { method: 'PATCH', body: { category: value } });
  else if (kind === 'skills') await api(`/skills/${encodeURIComponent(id)}`, { method: 'PATCH', body: { category: value } });
  else if (kind === 'market') await api('/marketplace/category', { method: 'POST', body: { id, category: value } });
  toast(value ? `已归到「${catLabelOf(value)}」` : '已恢复自动分类');
  await reload();
}

function bindCategoryUI(root, reload) {
  $$('[data-cat-filter]', root).forEach((b) => (b.onclick = () => {
    state.catFilter = state.catFilter || {};
    state.catFilter[b.dataset.catFilter] = b.dataset.catKey;
    render(true);
  }));
  $$('[data-cat-kind]', root).forEach((el) => (el.onchange = async () => {
    el.disabled = true;
    try {
      await setCategory(el.dataset.catKind, el.dataset.catId, el.value, reload);
    } catch (err) {
      toast(err.message, 'err');
      el.disabled = false;
    }
  }));
}

async function pageSkills(root, force) {
  await ensureCats();
  const data = await api('/skills');
  const installed = data.installed || [];
  const available = data.available || [];
  const targets = data.targets || [];
  targetLabelMap = new Map(targets.map((t) => [t.app, t.label]));
  const tab = state.skillsTab || 'installed';
  const all = tab === 'installed' ? installed : available;
  const list = tab === 'installed' ? filteredByCat('skills', all) : all;

  const cards = list
    .map((s) => {
      if (tab === 'installed') {
        const apps = Array.isArray(s.apps) ? s.apps : [];
        const mode = s.mode === 'link' ? '链接共享' : s.mode === 'copy' ? '复制副本' : s.mode === 'mixed' ? '混合模式' : '未连接';
        return `<div class="store-card skill-card">
          <div class="skill-card-head">
            <div class="store-logo">${esc((s.name || '?').slice(0, 1).toUpperCase())}</div>
            <div class="skill-card-title">
              <div class="store-name">${esc(s.name)}</div>
              <div class="store-ver">${s.version ? `v${esc(s.version)} · ` : ''}${esc(mode)}</div>
            </div>
          </div>
          <div class="store-desc">${esc(s.description || '（无描述）')}</div>
          <div class="cat-line">${catSelect('skills', s.folder, s.category)}<span class="cat-tip">${s.categoryManual ? '手动分类' : '自动分类'}</span></div>
          <div class="skill-targets">${
            apps.length
              ? apps.map((app) => skillTargetText(s.targets, app)).join('')
              : '<span class="skill-chip off">尚未启用应用</span>'
          }</div>
          <div class="skill-actions">
            <button class="btn sm" data-skill="apps" data-folder="${esc(s.folder)}">启用应用</button>
            <button class="btn sm" data-skill="sync" data-folder="${esc(s.folder)}">同步</button>
            <button class="btn sm danger" data-skill="remove" data-folder="${esc(s.folder)}">删除</button>
          </div>
          <div class="list-sub mono truncate" style="width:100%" title="${esc(s.path)}">${esc(s.path)}</div>
        </div>`;
      }
      return `<div class="store-card skill-card">
        <div class="skill-card-head">
          <div class="store-logo">${esc((s.name || '?').slice(0, 1).toUpperCase())}</div>
          <div class="skill-card-title">
            <div class="store-name">${esc(s.name)}</div>
            <div class="store-ver">${s.foundIn?.length ? '发现于：' + esc(s.foundIn.join('、')) : '本机'}</div>
          </div>
        </div>
        <div class="store-desc">${esc(s.description || '（无描述）')}</div>
        <div class="skill-actions">
          <button class="btn sm primary" data-skill="import" data-name="${esc(s.name)}">导入</button>
        </div>
        <div class="list-sub mono truncate" style="width:100%" title="${esc(s.path)}">${esc(s.path)}</div>
      </div>`;
    })
    .join('');

  root.innerHTML = `
    ${pageHead(
      'Skills',
      '一份技能，链接到多个 AI 工具',
      `<button class="btn" id="skill-sync-all" ${installed.length ? '' : 'disabled'}><svg><use href="#i-refresh"/></svg>同步全部</button>
       <button class="btn" id="skill-zip"><svg><use href="#i-download"/></svg>从 ZIP 导入</button>
       <button class="btn" id="skill-md"><svg><use href="#i-download"/></svg>从 MD 导入</button>
       <button class="btn primary" id="skill-add"><svg><use href="#i-plus"/></svg>添加 Skill</button>`,
    )}
    <div class="sub-toolbar" style="gap:20px">
      <button class="sub-pill ${tab === 'installed' ? 'active' : ''}" data-stab="installed">已安装 ${installed.length}</button>
      <button class="sub-pill ${tab === 'available' ? 'active' : ''}" data-stab="available">发现 ${available.length}</button>
    </div>
    ${tab === 'installed' ? catFilterRow('skills', all) : ''}
    ${
      list.length
        ? `<div class="store-grid">${cards}</div>`
        : `<div class="empty" style="padding-top:90px">
            <h3 style="font-size:15px">还没有 Skill</h3>
            <p>从发现里安装，或者导入本机已有的 Skill。</p>
            <div class="row" style="justify-content:center;gap:8px">
              <button class="btn" data-stab="available">去发现</button>
              <button class="btn" id="skill-import-empty">导入本机已有 (${available.length})</button>
            </div>
          </div>`
    }`;

  $$('[data-stab]', root).forEach((b) => (b.onclick = () => { state.skillsTab = b.dataset.stab; render(true); }));
  bindCategoryUI(root, () => {
    if (state.skillsTab === 'installed') state.skills = null;
    return render(true);
  });
  $('#skill-add')?.addEventListener('click', () => openSkillImport());
  $('#skill-zip')?.addEventListener('click', () => openSkillZipImport());
  $('#skill-md')?.addEventListener('click', () => openSkillMdImport());
  $('#skill-import-empty')?.addEventListener('click', () => openSkillImport());

  $('#skill-sync-all')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '同步中…';
    try {
      const r = await api('/skills/sync', { body: {} });
      const issues = Object.values(r.results || {}).flatMap((x) => Object.values(x || {})).filter((x) => String(x).includes('conflict') || String(x).includes('kept'));
      toast(`已同步 ${r.total} 个技能${issues.length ? `；${issues.length} 个应用需手动处理` : ''}`);
      render(true);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
      btn.textContent = '同步全部';
    }
  });

  $$('[data-skill]', root).forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.skill;
      if (action === 'import') return openSkillImport(btn.dataset.name || '');
      if (action === 'apps') return openSkillManage(btn.dataset.folder || '');
      const folder = btn.dataset.folder || '';
      if (!folder) return;
      if (action === 'remove') {
        if (!confirm(`删除「${folder}」？会移除管家建立的链接；手动修改过的应用目录会保留，技能本身移到备份。`)) return;
      }
      btn.disabled = true;
      try {
        if (action === 'sync') {
          const r = await api('/skills/sync', { body: { name: folder } });
          const issues = Object.values(r.results || {}).filter((x) => String(x).includes('conflict') || String(x).includes('kept'));
          toast(`已同步「${folder}」${issues.length ? `；${issues.length} 个应用需手动处理` : ''}`);
        } else if (action === 'remove') {
          await api(`/skills/${encodeURIComponent(folder)}`, { method: 'DELETE' });
          toast(`已删除「${folder}」，技能目录已移到备份`);
        }
        render(true);
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
      }
    };
  });
}

function skillAppChecks(targets, selectedApps) {
  return (targets || [])
    .map((t) => {
      const available = t.available !== false;
      const checked = Array.isArray(selectedApps) ? selectedApps.includes(t.app) : Boolean(t.exists);
      return `<label class="app-check ${available ? '' : 'disabled'}" title="${available ? '' : '应用目录不存在'}">
        <input type="checkbox" data-app-target="${t.app}" ${checked ? 'checked' : ''} ${available ? '' : 'disabled'} />
        <span class="mini-ico">${esc((t.label || '?').slice(0, 1))}</span>${esc(t.label)}</label>`;
    })
    .join('');
}

async function openSkillImport(onlyName = '') {
  const data = await api('/skills');
  const allAvailable = data.available || [];
  const available = onlyName ? allAvailable.filter((s) => s.name === onlyName) : allAvailable;
  const targets = data.targets || [];
  if (!available.length) {
    toast(onlyName ? `没有找到可导入的「${onlyName}」` : '没有发现可导入的本地 Skill');
    return;
  }
  const body = `
    <p style="font-size:12.5px;color:var(--muted);line-height:1.75;margin:0 0 12px">
      导入会把技能放进迅龙AI管家的目录，再按勾选给各应用建立链接（Windows 用 junction）；系统不支持链接时自动复制一份。原始文件不动。停用只移除管家建立的链接或未修改的副本，手动改过的目录会保留。
    </p>
    <div class="row" style="margin-bottom:10px;gap:8px">
      <input class="input" id="skill-search" placeholder="搜索名称或位置" />
      <button class="btn sm ghost" id="skill-all">全选</button>
      <button class="btn sm ghost" id="skill-none">全不选</button>
    </div>
    <div class="skill-list" id="skill-list">
      ${available
        .map(
          (s, i) => `<label class="skill-row" data-name="${esc(s.name)}" data-found="${esc((s.foundIn || []).join('、'))}">
            <input type="checkbox" data-skill-idx="${i}" checked />
            <div class="list-main">
              <div class="skill-name">${esc(s.name)}</div>
              <div class="skill-found">发现于：${esc((s.foundIn || []).join('、'))}</div>
            </div>
          </label>`,
        )
        .join('')}
    </div>
    <div class="row" style="margin:16px 0 8px;gap:8px;align-items:center">
      <div style="font-size:12.5px;font-weight:600">导入后在这些应用里启用</div>
      <button class="btn sm ghost" id="skill-apps-all">全选</button>
      <button class="btn sm ghost" id="skill-apps-none">全不选</button>
    </div>
    <div class="app-check-grid">${skillAppChecks(targets)}</div>
    <p style="font-size:11px;color:var(--dim);line-height:1.65;margin:10px 0 0">
      同名技能默认跳过，不覆盖已有版本；需要替换请用「从 ZIP 导入」并勾选覆盖更新。
    </p>`;

  openModal({
    title: onlyName ? `导入「${esc(onlyName)}」` : '导入本机已有的 Skill',
    body,
    wide: false,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: `导入 ${available.length} 个`,
        className: 'primary',
        onClick: async (btn) => {
          const picked = $$('[data-skill-idx]').filter((x) => x.checked).map((x) => available[Number(x.dataset.skillIdx)]);
          const apps = $$('[data-app-target]').filter((x) => x.checked).map((x) => x.dataset.appTarget);
          if (!picked.length) return toast('请选择要导入的 Skill', 'err');
          btn.disabled = true;
          btn.textContent = '导入中…';
          try {
            const r = await api('/skills/import', { body: { items: picked, apps } });
            toast(`已导入 ${r.imported} 个${r.updated ? `，更新 ${r.updated} 个` : ''}${r.skipped ? `，跳过 ${r.skipped} 个` : ''}`);
            closeModal();
            state.overview = null;
            render(true);
          } catch (e) {
            toast(e.message, 'err');
            btn.disabled = false;
            btn.textContent = `导入 ${available.length} 个`;
          }
        },
      },
    ],
  });

  const countLabel = () => {
    const n = $$('[data-skill-idx]').filter((x) => x.checked).length;
    const b = $('#modal-foot .btn.primary');
    if (b) b.textContent = `导入 ${n} 个`;
  };
  $$('[data-skill-idx]').forEach((x) => x.addEventListener('change', countLabel));
  $('#skill-all')?.addEventListener('click', () => { $$('[data-skill-idx]').forEach((x) => (x.checked = true)); countLabel(); });
  $('#skill-none')?.addEventListener('click', () => { $$('[data-skill-idx]').forEach((x) => (x.checked = false)); countLabel(); });
  $('#skill-apps-all')?.addEventListener('click', () => { $$('[data-app-target]:not(:disabled)').forEach((x) => (x.checked = true)); });
  $('#skill-apps-none')?.addEventListener('click', () => { $$('[data-app-target]').forEach((x) => (x.checked = false)); });
  $('#skill-search')?.addEventListener('input', (e) => {
    if (e.isComposing) return;
    const q = e.target.value.toLowerCase();
    $$('#skill-list .skill-row').forEach((row) => {
      row.style.display = (row.dataset.name + row.dataset.found).toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

async function openSkillManage(folder) {
  const data = await api('/skills');
  const item = (data.installed || []).find((s) => s.folder === folder);
  if (!item) return toast('技能不存在', 'err');
  const targets = data.targets || [];
  const body = `
    <p style="font-size:12.5px;color:var(--muted);line-height:1.75;margin:0 0 14px">
      勾选即让「${esc(item.name)}」在这个应用里可用。启停只操作管家建立的链接；如果应用目录里已有同名但内容不同的副本，不会静默覆盖。
    </p>
    <div class="app-check-grid">${skillAppChecks(targets, item.apps || [])}</div>`;
  openModal({
    title: `启用应用 · ${esc(item.name)}`,
    body,
    wide: false,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: '保存',
        className: 'primary',
        onClick: async (btn) => {
          const apps = $$('[data-app-target]').filter((x) => x.checked).map((x) => x.dataset.appTarget);
          btn.disabled = true;
          btn.textContent = '保存中…';
          try {
            const r = await api(`/skills/${encodeURIComponent(folder)}`, { method: 'PATCH', body: { apps } });
            const issues = Object.values(r.results || {}).filter((x) => String(x).includes('conflict') || String(x).includes('kept'));
            toast(`已保存${issues.length ? `；${issues.length} 个应用内容不同，未覆盖` : ''}`);
            closeModal();
            render(true);
          } catch (err) {
            toast(err.message, 'err');
            btn.disabled = false;
            btn.textContent = '保存';
          }
        },
      },
    ],
  });
}

async function openSkillZipImport() {
  const data = await api('/skills');
  const targets = data.targets || [];
  let pickedFile = null;
  const body = `
    <p style="font-size:12.5px;color:var(--muted);line-height:1.75;margin:0 0 12px">
      ZIP 根目录或唯一一层子目录里要有 SKILL.md。解压到临时目录校验后再导入，不会把压缩包内容直接写进应用目录。
    </p>
    <div class="row" style="gap:8px;align-items:center">
      <button class="btn" id="skill-zip-pick"><svg><use href="#i-download"/></svg>选择 ZIP</button>
      <span id="skill-zip-name" style="font-size:12px;color:var(--muted)">未选择文件</span>
    </div>
    <input id="skill-zip-file" type="file" accept=".zip,application/zip" style="display:none" />
    <div style="margin:16px 0 8px;font-size:12.5px;font-weight:600">导入后在这些应用里启用</div>
    <div class="app-check-grid">${skillAppChecks(targets)}</div>
    <label class="app-check" style="margin-top:14px">
      <input type="checkbox" id="skill-zip-update" /> 同名覆盖更新（旧版本会先备份到 data/backups/skills）
    </label>`;

  openModal({
    title: '从 ZIP 导入 Skill',
    body,
    wide: false,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: '导入',
        className: 'primary',
        onClick: async (btn) => {
          if (!pickedFile) return toast('请选择 ZIP 文件', 'err');
          if (pickedFile.size > 30 * 1024 * 1024) return toast('压缩包过大（上限 30MB）', 'err');
          btn.disabled = true;
          btn.textContent = '导入中…';
          try {
            const bytes = new Uint8Array(await pickedFile.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
              binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            }
            const apps = $$('[data-app-target]').filter((x) => x.checked).map((x) => x.dataset.appTarget);
            const update = Boolean($('#skill-zip-update')?.checked);
            const r = await api('/skills/install-zip', {
              body: { filename: pickedFile.name, data: btoa(binary), apps, update },
            });
            toast(`${r.result?.status === 'updated' ? '已更新' : '已导入'}技能：${r.title || r.name}`);
            closeModal();
            state.overview = null;
            render(true);
          } catch (e) {
            toast(e.message, 'err');
            btn.disabled = false;
            btn.textContent = '导入';
          }
        },
      },
    ],
  });

  const input = $('#skill-zip-file');
  $('#skill-zip-pick')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', () => {
    pickedFile = input.files?.[0] || null;
    const label = $('#skill-zip-name');
    if (label) label.textContent = pickedFile ? `${pickedFile.name}（${(pickedFile.size / 1024).toFixed(0)} KB）` : '未选择文件';
  });
}

async function openSkillMdImport() {
  const data = await api('/skills');
  const targets = data.targets || [];
  let pickedFile = null;
  let parsed = null;

  const body = `
    <p style="font-size:12.5px;color:var(--muted);line-height:1.75;margin:0 0 12px">
      选一个 Markdown 文件（<code>.md</code> / <code>.markdown</code>）。标题取 frontmatter 的 <code>name</code>，
      没有就取第一个 <code># 标题</code>，再没有就用文件名；没有 frontmatter 时会自动补一段。
    </p>
    <div class="row" style="gap:8px;align-items:center">
      <button class="btn" id="skill-md-pick"><svg><use href="#i-download"/></svg>选择文件</button>
      <span id="skill-md-name" style="font-size:12px;color:var(--muted)">未选择文件</span>
    </div>
    <input id="skill-md-file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" style="display:none" />
    <div id="skill-md-preview" class="sd" style="margin-top:12px">还没有选择文件</div>
    <div style="margin:16px 0 8px;font-size:12.5px;font-weight:600">导入后在这些应用里启用</div>
    <div class="app-check-grid">${skillAppChecks(targets)}</div>
    <label class="app-check" style="margin-top:14px">
      <input type="checkbox" id="skill-md-update" /> 同名覆盖更新（旧版本会先备份）
    </label>`;

  openModal({
    title: '从 Markdown 导入 Skill',
    body,
    wide: false,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: '导入',
        className: 'primary',
        onClick: async (btn) => {
          if (!pickedFile) return toast('请选择 Markdown 文件', 'err');
          if (!parsed) return toast('文件内容为空', 'err');
          btn.disabled = true;
          btn.textContent = '导入中…';
          try {
            const apps = $$('[data-app-target]').filter((x) => x.checked).map((x) => x.dataset.appTarget);
            const update = Boolean($('#skill-md-update')?.checked);
            const r = await api('/skills/md', {
              body: { filename: pickedFile.name, content: parsed.text, apps, update },
            });
            toast(`${r.result?.status === 'updated' ? '已更新' : '已导入'}技能：${r.title || r.name}`);
            closeModal();
            state.overview = null;
            render(true);
          } catch (e) {
            toast(e.message, 'err');
            btn.disabled = false;
            btn.textContent = '导入';
          }
        },
      },
    ],
  });

  const input = $('#skill-md-file');
  $('#skill-md-pick')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', async () => {
    pickedFile = input.files?.[0] || null;
    const label = $('#skill-md-name');
    if (label) label.textContent = pickedFile ? `${pickedFile.name}（${(pickedFile.size / 1024).toFixed(1)} KB）` : '未选择文件';
    const box = $('#skill-md-preview');
    if (!pickedFile) {
      parsed = null;
      if (box) box.textContent = '还没有选择文件';
      return;
    }
    const text = (await pickedFile.text()).replace(/\r\n/g, '\n');
    const fm = text.startsWith('---') ? text.slice(0, Math.max(0, text.indexOf('\n---', 3))) : '';
    const fmName = (fm.match(/^name:\s*(.+)$/m) || [])[1];
    const fmDesc = (fm.match(/^description:\s*(.+)$/m) || [])[1];
    const heading = (text.match(/^#[ \t]+(.+)$/m) || [])[1];
    const base = pickedFile.name.replace(/\.[^.]+$/, '');
    const title = String(fmName || heading || base).replace(/["']/g, '').trim();
    const desc = String(fmDesc || '')
      .replace(/^["']|["']$/g, '')
      .trim() || (text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('---') && !/^[A-Za-z0-9_-]+:\s/.test(l)) || '');
    parsed = { text, title, desc };
    if (box) {
      box.innerHTML = `<div><b>标题</b>：${esc(title || '（空）')}</div>
        <div style="margin-top:4px"><b>描述</b>：${esc(desc.slice(0, 120) || '（无）')}</div>
        <div style="margin-top:4px"><b>大小</b>：${text.length} 字符 · ${text.split('\n').length} 行</div>`;
    }
  });
}

/* ================= 扫描本机 ================= */
async function openScanModal() {
  openModal({
    title: '扫描本机 AI 应用',
    wide: true,
    body: `<div class="skeleton">正在扫描已安装的 CLI、配置与桌面应用…</div>`,
    actions: [{ label: '关闭', onClick: closeModal }],
  });
  try {
    const scan = await api('/scan?force=1');
    renderScan(scan);
  } catch (err) {
    $('#modal-body').innerHTML = `<div class="notice"><svg><use href="#i-alert"/></svg><div>${esc(err.message)}</div></div>`;
  }
}

function renderScan(scan) {
  if (!$('#modal-mask')?.classList.contains('show')) return;
  const candidates = scan.candidates || [];
  const installed = (scan.apps || []).filter((a) => a.installed);
  const desktop = scan.desktop || [];
  const unsupported = scan.unsupported || [];

  const candRows = candidates.length
    ? candidates
        .map(
          (c, i) => `<label class="list-item" style="cursor:pointer">
            <input type="checkbox" data-scan-idx="${i}" ${c.duplicate ? 'disabled' : 'checked'} style="width:16px;height:16px;flex:none" />
            <div class="list-main">
              <div class="list-title">${esc(c.name)}
                <span class="badge blue">${esc(APP_LABEL[c.app] || c.app)}</span>
                ${c.duplicate ? '<span class="badge gray">已存在</span>' : '<span class="badge green">可导入</span>'}
              </div>
              <div class="list-sub mono truncate">${esc(c.baseUrl)} · ${esc(c.model || '默认模型')} · Key ${c.hasKey ? '••••' + esc(c.keyTail) : '无'}</div>
            </div>
          </label>`,
        )
        .join('')
    : `<div class="empty" style="padding:24px"><p>没有发现可导入的现有配置。可以手动添加，或先从预设添加。</p></div>`;

  const appRows = installed
    .map(
      (a) => `<div class="list-item">
        <span class="dot ${a.hasConfig ? 'on' : 'off'}"></span>
        <div class="list-main">
          <div class="list-title">${esc(a.label)} ${a.binPath ? '<span class="badge green">已安装</span>' : '<span class="badge gray">仅配置文件</span>'}${a.readOnly ? '<span class="badge">只读</span>' : ''}</div>
          <div class="list-sub mono truncate">${esc(a.binPath || a.configPath)}</div>
        </div>
        <span class="badge ${a.hasConfig ? 'blue' : 'gray'}">${a.hasConfig ? '有配置' : '无配置'}</span>
      </div>`,
    )
    .join('') || '<div class="empty" style="padding:20px"><p>未检测到本工具支持的 CLI</p></div>';

  const desktopChips = desktop.length
    ? desktop
        .slice(0, 24)
        .map(
          (d) =>
            `<span class="badge" title="${esc([d.publisher, d.location].filter(Boolean).join(' · '))}">${esc(d.name)}${d.version ? ' ' + esc(d.version) : ''}</span>`,
        )
        .join(' ')
    : '未检测到桌面 AI 应用';

  openModal({
    title: '扫描本机 AI 应用',
    wide: true,
    body: `
      <div class="notice" style="margin-bottom:12px"><svg><use href="#i-search"/></svg>
        <div>检测完成：<b>${installed.length}</b> 个 CLI、<b>${candidates.length}</b> 份可导入配置、<b>${desktop.length}</b> 个桌面 AI 应用。
        扫描只读本机文件，不会修改任何配置。</div></div>

      <div class="card" style="padding:0;margin-bottom:12px">
        <div class="card-head" style="padding:14px 16px 8px;margin:0">
          <div><div class="card-title">可导入的现有配置</div>
          <div class="card-note">勾选后写入供应商列表；Key 仍只存本机</div></div>
          <span class="badge blue">${candidates.filter((c) => !c.duplicate).length} 项可选</span>
        </div>
        ${candRows}
      </div>

      <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
        <div class="card" style="padding:0">
          <div class="card-head" style="padding:14px 16px 8px;margin:0"><div class="card-title">已安装的 CLI</div></div>
          ${appRows}
        </div>
        <div class="card" style="padding:14px 16px">
          <div class="card-head" style="margin:0 0 8px"><div class="card-title">桌面 AI 应用</div></div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${desktopChips}</div>
          <div class="card-note" style="margin-top:10px">桌面应用只做识别，不纳入配置管理。</div>
          ${unsupported.length
            ? `<div class="card-note" style="margin-top:10px">检测到但暂不支持写入：${unsupported
                .map((u) => `<span class="badge">${esc(u.name)}</span>`)
                .join(' ')}</div>`
            : ''}
        </div>
      </div>`,
    actions: [
      { label: '重新扫描', onClick: () => openScanModal() },
      {
        label: '导入选中',
        className: 'primary',
        onClick: async (btn) => {
          const picked = $$('[data-scan-idx]')
            .filter((x) => x.checked && !x.disabled)
            .map((x) => candidates[Number(x.dataset.scanIdx)]);
          if (!picked.length) return toast('没有选中可导入项', 'err');
          btn.disabled = true;
          btn.textContent = '导入中…';
          try {
            const r = await api('/scan/import', { body: { items: picked } });
            toast(`已导入 ${r.created} 个${r.skipped ? `，跳过 ${r.skipped} 个` : ''}`);
            closeModal();
            state.providers = null;
            state.overview = null;
            render(true);
          } catch (err) {
            toast(err.message, 'err');
            btn.disabled = false;
            btn.textContent = '导入选中';
          }
        },
      },
    ],
  });
}

/* ================= 网关 ================= */
async function pageGateway(root, force) {
  const [gw, providers] = await Promise.all([loadGateway(force), loadProviders()]);
  state.gateway = gw;
  updateGwIndicator(gw);
  const order = gw.config?.order || [];
  const sorted = [...providers].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const rows = sorted
    .map(
      (p, i) => `<tr>
        <td style="width:34px;color:var(--dim)">${i + 1}</td>
        <td><div style="font-weight:600">${esc(p.name)}</div><div class="list-sub">${esc(APP_LABEL[p.app] || p.app)} · ${esc(PROTO_LABEL[p.protocol])}</div></td>
        <td class="mono truncate" style="max-width:260px">${esc(p.baseUrl)}</td>
        <td><span class="badge ${p.enabled === false ? 'gray' : 'green'}">${p.enabled === false ? '停用' : '启用'}</span></td>
        <td style="white-space:nowrap">
          <button class="btn sm ghost" data-up="${p.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn sm ghost" data-down="${p.id}" ${i === sorted.length - 1 ? 'disabled' : ''}>↓</button>
        </td>
      </tr>`,
    )
    .join('');

  root.innerHTML = `
    ${pageHead('本地网关', 'OpenAI / Anthropic 兼容入口，多上游自动故障转移', `<button class="btn sm" id="gw-jump-usage" data-goto="usage">查看用量</button>`)}
    <div class="grid" style="grid-template-columns: 1fr 1fr">
      <div class="card">
        <div class="card-head"><div><div class="card-title"><svg><use href="#i-route"/></svg>网关状态</div>
          <div class="card-note">仅监听 127.0.0.1，不对公网开放</div></div>
          <span class="badge ${gw.running ? 'green' : 'gray'}">${gw.running ? '运行中' : '已停止'}</span></div>
        <div class="kv"><span class="k">状态</span><span class="v">${gw.running ? `运行中 · ${gw.requests} 次请求` : '未启动'}</span></div>
        <div class="kv"><span class="k">端口</span><span class="v mono">${esc(gw.port || gw.settings?.gatewayPort || 8317)}</span></div>
        <div class="kv"><span class="k">启动时间</span><span class="v">${dt(gw.startedAt)}</span></div>
        <div class="row" style="margin-top:14px">
          ${gw.running
            ? '<button class="btn danger" id="gw-stop"><svg><use href="#i-stop"/></svg>停止网关</button>'
            : `<input class="input mono" id="gw-port" value="${esc(gw.settings?.gatewayPort || 8317)}" style="width:120px" />
               <button class="btn primary" id="gw-start"><svg><use href="#i-play"/></svg>启动网关</button>`}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title"><svg><use href="#i-plug"/></svg>接入地址</div></div>
        <div class="field"><label>OpenAI 兼容（Codex / OpenCode / 任意 SDK）</label>
          <div class="copybox"><span>${esc(gw.endpoints?.openai || `http://127.0.0.1:${gw.port || 8317}/v1`)}</span>
          <button class="btn sm" data-copy="${esc(gw.endpoints?.openai || `http://127.0.0.1:${gw.port || 8317}/v1`)}">复制</button></div></div>
        <div class="field" style="margin-top:12px"><label>Anthropic 兼容（Claude Code）</label>
          <div class="copybox"><span>${esc(gw.endpoints?.anthropic || `http://127.0.0.1:${gw.port || 8317}`)}</span>
          <button class="btn sm" data-copy="${esc(gw.endpoints?.anthropic || `http://127.0.0.1:${gw.port || 8317}`)}">复制</button></div></div>
        <div class="notice" style="margin-top:14px"><svg><use href="#i-shield"/></svg>
          <div>在供应商处把 Base URL 指向这里、Key 随便填，即可让所有请求走本机网关，并自动故障转移。</div></div>
      </div>
    </div>

    <div class="card tight" style="margin-top:16px">
      <div class="card-head" style="padding:16px 18px 6px;margin:0">
        <div><div class="card-title"><svg><use href="#i-server"/></svg>故障转移顺序</div>
        <div class="card-note">按顺序尝试，失败或 429/5xx 时自动切到下一个</div></div>
        <span class="badge">${sorted.length} 个供应商</span>
      </div>
      <table class="table"><thead><tr><th></th><th>供应商</th><th>Base URL</th><th>状态</th><th>排序</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5"><div class="empty">还没有供应商</div></td></tr>'}</tbody></table>
    </div>`;

  $('#gw-start')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api('/gateway/start', { body: { port: Number($('#gw-port').value) } });
      toast('网关已启动');
      state.gateway = null;
      state.overview = null;
      render(true);
    } catch (err) {
      toast(err.message, 'err');
      e.currentTarget.disabled = false;
    }
  });
  $('#gw-stop')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api('/gateway/stop', { body: {} });
      toast('网关已停止');
      state.gateway = null;
      state.overview = null;
      render(true);
    } catch (err) {
      toast(err.message, 'err');
      e.currentTarget.disabled = false;
    }
  });
  $$('[data-copy]', root).forEach((b) => (b.onclick = () => copyText(b.dataset.copy, '地址已复制')));
  $$('[data-up],[data-down]', root).forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.up || b.dataset.down;
      const ids = sorted.map((p) => p.id);
      const i = ids.indexOf(id);
      const j = b.dataset.up ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      b.disabled = true;
      try {
        await api('/gateway/order', { body: { order: ids } });
        state.gateway = null;
        render(true);
      } catch (err) {
        toast(err.message, 'err');
        b.disabled = false;
      }
    };
  });
}

/* ================= 用量 ================= */
function openUsageRange() {
  const now = new Date();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const presets = [
    ['今天', () => { const s = new Date(); s.setHours(0, 0, 0, 0); return [s, now]; }],
    ['近 24 小时', () => [new Date(Date.now() - 86400000), now]],
    ['近 7 天', () => [new Date(Date.now() - 7 * 86400000), now]],
    ['近 14 天', () => [new Date(Date.now() - 14 * 86400000), now]],
    ['近 30 天', () => [new Date(Date.now() - 30 * 86400000), now]],
    ['全部', () => [new Date(2020, 0, 1), now]],
  ];
  const cur = state.usageRange;
  const startVal = iso(cur ? new Date(cur.start) : new Date(Date.now() - 7 * 86400000));
  const endVal = iso(cur ? new Date(cur.end) : now);
  openModal({
    title: '时间范围',
    body: `
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${presets.map((x, i) => `<button class="tab" data-preset="${i}">${x[0]}</button>`).join('')}
      </div>
      <div class="field"><label>开始时间</label><input class="input" type="datetime-local" id="rg-start" value="${startVal}" /></div>
      <div class="field"><label>结束时间</label><input class="input" type="datetime-local" id="rg-end" value="${endVal}" /></div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: '确定',
        className: 'primary',
        onClick: () => {
          const s = $('#rg-start').value;
          const e = $('#rg-end').value;
          if (!s || !e) return toast('请选择起止时间', 'err');
          const start = new Date(s).getTime();
          const end = new Date(e).getTime();
          if (end <= start) return toast('结束时间必须晚于开始时间', 'err');
          state.usageRange = { start, end, label: s.slice(5, 10) + ' ~ ' + e.slice(5, 10) };
          closeModal();
          render(true);
        },
      },
    ],
  });
  $$('[data-preset]').forEach((b) => (b.onclick = () => {
    const [s, e] = presets[Number(b.dataset.preset)][1]();
    $('#rg-start').value = iso(s);
    $('#rg-end').value = iso(e);
  }));
}

function usageChart(rows, metric, mode = 'day') {
  const val = (r) => (metric === 'cost' ? r.cost || 0 : metric === 'tokens' ? (r.input || 0) + (r.output || 0) : r.requests || 0);
  const max = Math.max(1, ...rows.map(val));
  const unit = mode === 'hour' ? '按小时' : '按天';
  const title = (metric === 'cost' ? '成本' : metric === 'tokens' ? 'Tokens' : '请求数') + ` · ${unit}`;
  const fmtV = (v) => (metric === 'cost' ? '$' + v.toFixed(2) : metric === 'tokens' ? (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(v)) : String(v));
  return `<div class="card-note" style="margin:8px 0 6px">${title}</div>
    <div class="row" style="align-items:flex-end;gap:3px;height:170px;padding:0 4px">
      ${rows.map((r) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%" title="${esc(String(r.date))} · ${fmtV(val(r))}">
        <div style="width:100%;background:#4D8DF8;border-radius:2px 2px 0 0;height:${Math.max(val(r) > 0 ? 3 : 1, Math.round((val(r) / max) * 160))}px"></div></div>`).join('')}
    </div>
    <div class="row" style="justify-content:space-between;color:var(--dim);font-size:10.5px;margin-top:6px;padding:0 4px">
      ${rows.filter((_, i) => i % Math.max(1, Math.ceil(rows.length / 12)) === 0).map((r) => `<span>${esc(String(r.date).slice(-5))}</span>`).join('')}
    </div>`;
}

async function pageUsage(root, force) {
  const rg = state.usageRange;
  const u = await api(`/usage${rg ? `?start=${rg.start}&end=${rg.end}` : `?days=${state.usageDays}`}`);
  const rangeLabel = rg ? rg.label : state.usageDays === 1 ? '今天' : `近 ${state.usageDays} 天`;
  const speed = (() => {
    const rows = (u.recent || []).filter((r) => r.latency > 0 && r.output > 0);
    if (!rows.length) return 0;
    const sum = rows.reduce((a, r) => a + r.output / (r.latency / 1000), 0);
    return Math.round(sum / rows.length);
  })();
  const allRows = u.recent || [];
  const providers = new Set([...(u.byProvider || []).map((p) => p.name), ...allRows.map((r) => r.providerName)].filter(Boolean));
  const models = new Set(allRows.map((r) => r.model).filter(Boolean));
  const selectedProvider = state.usageProvider || '';
  const filtered = selectedProvider ? allRows.filter((r) => r.providerName === selectedProvider) : allRows;

  const statusFilter = state.usageStatus || '';
  const statusRows = statusFilter ? filtered.filter((r) => (statusFilter === 'ok' ? !r.status || r.status < 400 : r.status >= 400)) : filtered;
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(statusRows.length / pageSize));
  const page = Math.min(Math.max(1, state.usagePage || 1), pageCount);
  const pageRows = statusRows.slice((page - 1) * pageSize, page * pageSize);
  const rows = pageRows
    .map(
      (r) => `<tr>
        <td class="mono">${dt(r.ts).slice(11)}</td>
        <td><span class="badge blue">${esc(APP_LABEL[r.app] || r.app || '—')}</span></td>
        <td>${esc(r.providerName || '—')}</td>
        <td class="mono">${esc(r.model || '—')}</td>
        <td class="mono">${fmt(r.input)}</td>
        <td class="mono">${fmt(r.output)}</td>
        <td class="mono">$${Number(r.cost || 0).toFixed(4)}</td>
        <td class="mono">${r.cached ? fmt(r.cached) : '—'}</td>
        <td class="mono">${r.latency ? Math.round(r.output / (r.latency / 1000)) + ' tok/s' : '—'}</td>
        <td>${r.status >= 400 ? `<span class="badge amber">${r.status}</span>` : '<span class="badge green">200</span>'}</td>
      </tr>`,
    )
    .join('') || '<tr><td colspan="10"><div class="empty" style="padding:34px"><p>还没有请求记录</p></div></td></tr>';

  root.innerHTML = `
    ${pageHead(
      '用量统计',
      '按天、按供应商、按模型统计请求与 Token',
      `<button class="btn sm" id="usage-range"><svg><use href="#i-clock"/></svg>${esc(rangeLabel)} ▾</button>
      <select class="select" id="usage-provider" style="max-width:200px;height:30px">
        <option value="">全部供应商</option>
        ${[...providers].map((p) => `<option value="${esc(p)}" ${selectedProvider === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
      </select>
      <button class="icon-round" id="usage-refresh" title="刷新"><svg width="16" height="16"><use href="#i-refresh"/></svg></button>`,
    )}

    <div class="stat-strip" style="gap:0">
      ${[['cost','估算成本','$' + (u.totals.cost || 0).toFixed(2)],['requests','总请求数',fmt(u.totals.requests)],['tokens','计费 Tokens',fmt(Math.max(0,(u.totals.input||0)+(u.totals.output||0)-(u.totals.cached||0)))],['cache','缓存占输入比',(u.cacheRate||0) + '%']]
        .map(([k,lb,vl]) => `<button class="stat-cell" data-metric="${k}" style="text-align:left;background:none;border:none;cursor:pointer;border-bottom:2px solid ${(state.usageMetric||'requests')===k?'var(--text)':'transparent'}"><div class="lb">${lb}</div><div class="vl">${vl}</div></button>`).join('')}
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head" style="margin-bottom:6px">
        <div><div class="card-title">趋势</div><div class="card-note">网关 + 会话日志</div></div>
        <span class="badge blue">${providers.size} 个供应商 · ${models.size} 个模型</span>
      </div>
      ${usageChart(u.byDay, state.usageMetric || 'requests', u.mode)}
    </div>

    <div class="card tight" style="margin-top:14px">
      <div class="card-head" style="padding:16px 18px 8px;margin:0">
        <div class="card-title">最近请求日志 <span class="badge">${statusRows.length}${u.recentTotal && u.recentTotal > statusRows.length ? ` / ${u.recentTotal}` : ''}</span></div>
        <div class="row" style="gap:8px">
          <select class="select" id="usage-status" style="height:28px;max-width:120px">
            <option value="">全部状态</option>
            <option value="ok" ${statusFilter === 'ok' ? 'selected' : ''}>成功</option>
            <option value="err" ${statusFilter === 'err' ? 'selected' : ''}>失败</option>
          </select>
          <span class="card-note">第 ${page} / ${pageCount} 页</span>
          <button class="btn sm" id="usage-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
          <button class="btn sm" id="usage-next" ${page >= pageCount ? 'disabled' : ''}>下一页</button>
        </div>
      </div>
      <table class="table">
        <thead><tr><th>时间</th><th>应用</th><th>供应商</th><th>模型</th><th>输入</th><th>输出</th><th>成本</th><th>缓存命中</th><th>速度</th><th>状态</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  $$('[data-days]', root).forEach((t) => (t.onclick = () => { state.usageDays = Number(t.dataset.days); state.usage = null; render(true); }));
  $('#usage-status')?.addEventListener('change', (e) => { state.usageStatus = e.target.value; state.usagePage = 1; render(true); });
  $('#usage-prev')?.addEventListener('click', () => { state.usagePage = Math.max(1, (state.usagePage || 1) - 1); render(true); });
  $('#usage-next')?.addEventListener('click', () => { state.usagePage = (state.usagePage || 1) + 1; render(true); });
  $$('[data-metric]', root).forEach((b) => (b.onclick = () => { state.usageMetric = b.dataset.metric; render(true); }));
  $('#usage-range')?.addEventListener('click', openUsageRange);
  $('#usage-provider')?.addEventListener('change', (e) => {
    state.usageProvider = e.target.value;
    render(true);
  });
  $('#usage-refresh')?.addEventListener('click', () => { state.usage = null; render(true); });
}

/* ================= MCP ================= */
const MCP_APPS = ['claude', 'codex', 'gemini', 'qwen'];

async function pageMcp(root, force) {
  await ensureCats();
  const [data, ov] = await Promise.all([api('/mcp'), loadOverview()]);
  state.gateway = ov.gateway;
  const apps = visibleApps(ov).filter((a) => MCP_APPS.includes(a.key));
  const items = data.items || [];
  const q = (state.mcpQuery || '').trim().toLowerCase();
  const filtered = filteredByCat('mcp', items.filter((m) => !q || `${m.name} ${m.command} ${(m.args || []).join(' ')}`.toLowerCase().includes(q)));
  const colors = { claude: '#d97757', codex: '#10a37f', gemini: '#4285f4', qwen: '#615ced', opencode: '#4b5563', grok: '#111827', pi: '#0ea5e9', omp: '#7c3aed' };
  const counts = apps.map((a) => items.filter((m) => (m.apps || []).includes(a.key)).length);

  const rows = filtered.length
    ? filtered
        .map(
          (m) => `<tr>
            <td style="min-width:280px">
              <div class="row-title"><span class="dot ${m.enabled === false ? 'off' : 'on'}"></span>${esc(m.name)}</div>
              <div class="row-url mono">${esc(m.command)} ${esc((m.args || []).join(' '))}</div>
              <div class="cat-line">${catSelect('mcp', m.id, m.category)}<span class="cat-tip">${m.categoryManual ? '手动分类' : '自动分类'}</span></div>
            </td>
            ${apps
              .map(
                (a) => `<td class="app-cell"><input type="checkbox" data-mcp="${m.id}" data-app="${a.key}" ${(m.apps || []).includes(a.key) ? 'checked' : ''} /></td>`,
              )
              .join('')}
            <td style="text-align:right;white-space:nowrap">
              <button class="act" data-mcp-edit="${m.id}" title="编辑"><svg width="15" height="15"><use href="#i-edit"/></svg></button>
              <button class="act" data-mcp-del="${m.id}" title="删除"><svg width="15" height="15"><use href="#i-trash"/></svg></button>
            </td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="${apps.length + 2}"><div class="empty" style="padding:40px"><div class="big">🔌</div><h3>还没有 MCP 服务器</h3><p>添加后勾选要启用的应用，即会同步写入对应 CLI 配置。</p></div></td></tr>`;

  root.innerHTML = `
    ${pageHead(
      'MCP',
      '统一管理 MCP 服务器，并同步到 Claude / Codex / Gemini / Qwen',
      `<button class="btn" id="mcp-check"><svg><use href="#i-zap"/></svg>检查连通性</button>
       <button class="btn" id="mcp-import"><svg><use href="#i-download"/></svg>从应用导入</button>
       <button class="btn" id="mcp-apply"><svg><use href="#i-refresh"/></svg>应用到 CLI</button>
       <button class="btn primary" id="mcp-add"><svg><use href="#i-plus"/></svg>添加 MCP</button>
       <button class="icon-round" id="mcp-more"><svg width="16" height="16"><use href="#i-more"/></svg></button>`,
    )}
    <div class="row" style="margin-bottom:10px;gap:10px">
      <input class="input" id="mcp-search" placeholder="搜索名称、命令或地址" value="${esc(state.mcpQuery || '')}" style="width:280px" />
      <span class="card-note">${items.length} 个 MCP</span>
      <span class="spacer"></span>
      <span class="card-note">直接改应用配置里的同名项会被覆盖</span>
    </div>
    ${catFilterRow('mcp', items)}
    <div class="card tight">
      <table class="table mcp-table">
        <thead>
          <tr>
            <th>名称</th>
            ${apps
              .map(
                (a, i) => `<th class="app-cell" title="${esc(a.label || a.key)}"><div class="app-name"><span class="app-dot" style="background:${colors[a.key] || '#8b93a7'}"></span>${esc(String(a.label || a.key).split(' ')[0])}</div><div class="app-count">${counts[i]}</div></th>`,
              )
              .join('')}
            <th style="width:90px"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  $('#mcp-add')?.addEventListener('click', () => mcpForm(null, null));
  $('#mcp-more')?.addEventListener('click', () => {
    openModal({
      title: '从模板添加',
      body: `<div style="display:flex;flex-direction:column;gap:8px">${(data.templates || [])
        .map(
          (t, i) => `<button class="list-item" data-tpl="${i}" style="border:1px solid var(--border);border-radius:10px;background:#fff;color:inherit;text-align:left;cursor:pointer">
          <div class="list-main"><div class="list-title">${esc(t.name)}</div><div class="list-sub mono">${esc(t.command)} ${esc((t.args || []).join(' '))}</div>
          <div class="list-sub">${esc(t.note || '')}</div></div></button>`,
        )
        .join('')}</div>`,
      actions: [{ label: '取消', onClick: closeModal }],
    });
    $$('[data-tpl]').forEach((b) => (b.onclick = () => {
      const t = data.templates[Number(b.dataset.tpl)];
      closeModal();
      setTimeout(() => mcpForm(null, t), 60);
    }));
  });
  $('#mcp-import')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api('/mcp/import', { body: {} });
      toast(`已从应用导入 ${r.added} 个，合并 ${r.merged} 个`);
      render(true);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      e.currentTarget.disabled = false;
    }
  });
  $('#mcp-apply')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api('/mcp/apply', { body: {} });
      const applied = Object.entries(r.result || {}).map(([k, v]) => `${APP_LABEL[k] || k} ${v}`).join(' · ');
      toast(`已同步：${applied || '无启用项'}`);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      e.currentTarget.disabled = false;
    }
  });
  $('#mcp-check')?.addEventListener('click', async () => {
    try {
      const r = await api('/mcp/check', { body: {} });
      const bad = r.items.filter((x) => !x.ok);
      toast(bad.length ? `${bad.length} 个命令不可用：${bad.map((x) => x.name).join('、')}` : `全部 ${r.items.length} 个命令可用`);
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  let t2 = null;
  $('#mcp-search')?.addEventListener('input', (e) => {
    if (e.isComposing) return;
    state.mcpQuery = e.target.value;
    const pos = e.target.selectionStart;
    clearTimeout(t2);
    t2 = setTimeout(async () => {
      await render(true);
      const el = $('#mcp-search');
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    }, 250);
  });
  $$('[data-mcp]', root).forEach((cb) => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.mcp;
      const item = items.find((m) => m.id === id);
      if (!item) return;
      const apps2 = new Set(item.apps || []);
      if (cb.checked) apps2.add(cb.dataset.app);
      else apps2.delete(cb.dataset.app);
      try {
        await api(`/mcp/${id}`, { method: 'PUT', body: { apps: [...apps2].filter((a) => MCP_APPS.includes(a)) } });
        item.apps = [...apps2].filter((a) => MCP_APPS.includes(a));
        const r = await api('/mcp/apply', { body: {} });
        const applied = Object.entries(r.result || {}).map(([k, v]) => `${APP_LABEL[k] || k} ${v}`).join(' · ');
        toast(`已同步：${applied || '无启用项'}`);
      } catch (e) {
        cb.checked = !cb.checked;
        toast(e.message, 'err');
      }
    });
  });
  $$('[data-mcp-edit]', root).forEach((b) => (b.onclick = () => mcpForm(items.find((m) => m.id === b.dataset.mcpEdit), null)));
  bindCategoryUI(root, () => { state.mcp = null; return render(true); });
  $$('[data-mcp-del]', root).forEach((b) => (b.onclick = async () => {
    if (!confirm('确定删除该 MCP？已同步到 CLI 的同名项会在下次应用时移除。')) return;
    try {
      await api(`/mcp/${b.dataset.mcpDel}`, { method: 'DELETE' });
      await api('/mcp/apply', { body: {} });
      toast('已删除并同步');
      render(true);
    } catch (e) {
      toast(e.message, 'err');
    }
  }));
}

function mcpForm(item, template) {
  const data = item || template || { name: '', command: 'npx', args: [], env: {}, apps: ['claude', 'codex', 'gemini', 'qwen'], enabled: true };
  const body = `
    <div class="field"><label>名称</label><input class="input" id="m-name" value="${esc(data.name)}" placeholder="filesystem" /></div>
    <div class="field"><label>启动命令</label><input class="input mono" id="m-cmd" value="${esc(data.command)}" placeholder="npx" /></div>
    <div class="field"><label>参数（空格分隔）</label><input class="input mono" id="m-args" value="${esc((data.args || []).join(' '))}" placeholder="-y @modelcontextprotocol/server-filesystem D:\\work" /></div>
    <div class="field"><label>环境变量（每行 KEY=VALUE）</label><textarea class="textarea mono" id="m-env" placeholder="API_KEY=xxx">${esc(Object.entries(data.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'))}</textarea></div>
    <div class="field"><label>同步到</label><div class="row" style="gap:14px">
      ${MCP_APPS.map((a) => `<label class="row" style="gap:6px;font-size:13px"><input type="checkbox" data-app-check="${a}" ${(data.apps || []).includes(a) ? 'checked' : ''}/>${APP_LABEL[a]}</label>`).join('')}
    </div></div>
    <div class="field"><label>状态</label><label class="row" style="gap:8px"><input type="checkbox" id="m-enabled" ${data.enabled !== false ? 'checked' : ''}/>启用</label></div>`;

  openModal({
    title: item ? '编辑 MCP' : '添加 MCP',
    body,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '保存并同步', className: 'primary', onClick: async (btn) => {
          const args = $('#m-args').value.split(/\s+/).filter(Boolean);
          const env = {};
          for (const line of $('#m-env').value.split(/\r?\n/)) {
            const i = line.indexOf('=');
            if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
          }
          const apps = $$('[data-app-check]').filter((c) => c.checked).map((c) => c.dataset.appCheck);
          const payload = {
            name: $('#m-name').value.trim(),
            command: $('#m-cmd').value.trim(),
            args,
            env,
            apps,
            enabled: $('#m-enabled').checked,
          };
          if (!payload.name || !payload.command) return toast('请填写名称与命令', 'err');
          btn.disabled = true;
          btn.textContent = '保存中…';
          try {
            if (item) await api(`/mcp/${item.id}`, { method: 'PUT', body: payload });
            else await api('/mcp', { body: payload });
            await api('/mcp/apply', { body: {} });
            closeModal();
            toast('已保存并同步到 CLI');
            render(true);
          } catch (e) {
            toast(e.message, 'err');
            btn.disabled = false;
            btn.textContent = '保存并同步';
          }
        } },
    ],
  });
}

/* ================= 提示词 ================= */
async function pagePrompts(root, force) {
  await ensureCats();
  const data = state.prompts && !force ? state.prompts : (state.prompts = await api('/prompts'));
  const all = data.items || [];
  const items = filteredByCat('prompts', all);

  const rows = items
    .map(
      (p) => {
        const content = String(p.content || '');
        return `<div class="prov-row" style="align-items:flex-start">
        <div class="row-ico">${esc((p.title || '?').slice(0, 1))}</div>
        <div class="row-main">
          <div class="row-title">${esc(p.title)}</div>
          <div class="row-url" style="white-space:normal;line-height:1.65">${esc(content.slice(0, 150))}${content.length > 150 ? '…' : ''}</div>
          <div class="row" style="gap:5px;margin-top:7px">${(p.tags || []).map((t) => `<span class="badge">${esc(t)}</span>`).join('')}${catSelect('prompts', p.id, p.category)}</div>
        </div>
        <div class="row-actions">
          <button class="act" data-copy="${p.id}" title="复制"><svg width="15" height="15"><use href="#i-copy"/></svg></button>
          <button class="act" data-edit="${p.id}" title="编辑"><svg width="15" height="15"><use href="#i-edit"/></svg></button>
          <button class="act" data-del="${p.id}" title="删除"><svg width="15" height="15"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
      },
    )
    .join('');

  root.innerHTML = `
    ${pageHead(
      '提示词',
      '沉淀常用指令，一键复制到任意 CLI',
      `<button class="btn primary" id="prompt-add"><svg><use href="#i-plus"/></svg>添加提示词</button>
       <button class="icon-round" id="prompt-more"><svg width="16" height="16"><use href="#i-more"/></svg></button>`,
    )}
    <div class="row" style="margin-bottom:12px;gap:10px">
      <span class="sub-pill active">全部提示词 ${all.length}</span>
      <span class="card-note">保存在本机，不会上传</span>
    </div>
    ${catFilterRow('prompts', all)}
    ${
      items.length
        ? `<div class="prov-list">${rows}</div>`
        : `<div class="empty" style="padding-top:90px">
            <h3 style="font-size:15px">还没有提示词</h3>
            <p>添加后可以一键复制到任意 CLI。</p>
            <button class="btn" id="prompt-add2"><svg><use href="#i-plus"/></svg>添加提示词</button>
          </div>`
    }`;

  $('#prompt-add')?.addEventListener('click', () => promptForm(null));
  $('#prompt-add2')?.addEventListener('click', () => promptForm(null));
  $('#prompt-more')?.addEventListener('click', () => openPromptImport());
  bindCategoryUI(root, () => { state.prompts = null; return render(true); });
  $$('[data-copy]', root).forEach((b) => (b.onclick = () => copyPrompt(items.find((p) => p.id === b.dataset.copy))));
  $$('[data-edit]', root).forEach((b) => (b.onclick = () => promptForm(items.find((p) => p.id === b.dataset.edit))));
  $$('[data-del]', root).forEach((b) => (b.onclick = async () => {
    if (!confirm('确定删除？')) return;
    b.disabled = true;
    try {
      await api(`/prompts/${b.dataset.del}`, { method: 'DELETE' });
      state.prompts = null;
      toast('已删除');
      render(true);
    } catch (err) {
      toast(err.message, 'err');
      b.disabled = false;
    }
  }));
}

function copyPrompt(item) {
  if (!item) return;
  const names = [...new Set([...String(item.content || '').matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]))];
  if (!names.length) {
    copyText(item.content, '提示词已复制');
    return;
  }
  const body = `<div class="sd" style="margin-bottom:12px">这个提示词包含 ${names.length} 个变量，填写后复制最终文本。</div>
    ${names.map((name) => `<div class="field"><label>${esc(name)}</label><input class="input" data-prompt-var="${esc(name)}" /></div>`).join('')}`;
  openModal({
    title: '填充提示词变量',
    body,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: '复制',
        className: 'primary',
        onClick: () => {
          let text = item.content;
          for (const input of $$('[data-prompt-var]')) {
            const marker = `{{${input.dataset.promptVar}}}`;
            text = text.replaceAll(marker, () => input.value);
            text = text.replace(
              new RegExp(`\\{\\{\\s*${input.dataset.promptVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g'),
              () => input.value,
            );
          }
          copyText(text, '提示词已复制');
          closeModal();
        },
      },
    ],
  });
}

function promptForm(item) {
  const body = `
    <div class="field"><label>标题</label><input class="input" id="p-title" value="${esc(item?.title || '')}" /></div>
    <div class="field"><label>标签（逗号分隔）</label><input class="input" id="p-tags" value="${esc((item?.tags || []).join(','))}" /></div>
    <div class="field"><label>内容</label><textarea class="textarea mono" id="p-content" style="min-height:240px">${esc(item?.content || '')}</textarea></div>`;
  openModal({
    title: item ? '编辑提示词' : '新建提示词',
    body,
    wide: true,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '保存', className: 'primary', onClick: async () => {
          const payload = {
            title: $('#p-title').value.trim(),
            tags: $('#p-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
            content: $('#p-content').value,
          };
          if (!payload.title) return toast('请填写标题', 'err');
          try {
            if (item) await api(`/prompts/${item.id}`, { method: 'PUT', body: payload });
            else await api('/prompts', { body: payload });
            closeModal();
            state.prompts = null;
            toast('已保存');
            render(true);
          } catch (e) {
            toast(e.message, 'err');
          }
        } },
    ],
  });
}

function parsePromptTxt(fileName, text) {
  const base = String(fileName || '提示词').replace(/\.[^.]+$/, '');
  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/^[ \t]*-{3,}[ \t]*$/m)
    .map((b) => b.trim())
    .filter(Boolean);
  const out = [];
  blocks.forEach((block, i) => {
    let title = '';
    let content = block;
    const m = block.match(/^#[ \t]+(.+)\n+([\s\S]*)$/);
    if (m) {
      title = m[1].trim();
      content = m[2].trim();
    }
    if (!content) return;
    if (!title) title = blocks.length > 1 ? `${base} ${i + 1}` : base;
    out.push({ title, content });
  });
  return out;
}

function openPromptImport() {
  let parsed = [];
  openModal({
    title: '导入提示词（TXT）',
    wide: true,
    body: `
      <div class="field"><label>选择 TXT 文件</label><input type="file" id="p-file" accept=".txt,text/plain" /></div>
      <div class="sd" style="margin-bottom:12px;line-height:1.8">
        一个文件一条：文件名当标题。<br>
        一个文件多条：用单独一行 <code>---</code> 分隔，每条第一行可写 <code># 标题</code>。
      </div>
      <div class="field"><label>标签（可选，逗号分隔）</label><input class="input" id="p-imp-tags" placeholder="可留空，例如：导入,常用" /></div>
      <div class="field"><label>预览</label><div id="p-preview" class="sd">还没有选择文件</div></div>`,
    actions: [
      { label: '取消', onClick: closeModal },
      { label: '导入', className: 'primary', onClick: async (btn) => {
          if (!parsed.length) return toast('请先选择 TXT 文件', 'err');
          const tags = ($('#p-imp-tags')?.value || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (btn) btn.disabled = true;
          let ok = 0;
          let fail = 0;
          for (const item of parsed) {
            try {
              await api('/prompts', { body: { title: item.title, content: item.content, tags } });
              ok += 1;
            } catch {
              fail += 1;
            }
          }
          closeModal();
          state.prompts = null;
          toast(`已导入 ${ok} 条提示词${fail ? `，${fail} 条失败` : ''}`, fail ? 'err' : 'ok');
          render(true);
        } },
    ],
  });

  $('#p-file')?.addEventListener('change', async (e) => {
    const file = e.currentTarget.files?.[0];
    const box = $('#p-preview');
    if (!file) {
      parsed = [];
      if (box) box.textContent = '还没有选择文件';
      return;
    }
    try {
      const text = await file.text();
      parsed = parsePromptTxt(file.name, text);
      if (box) {
        box.innerHTML = parsed.length
          ? `<div style="line-height:1.9">共 ${parsed.length} 条：</div>` +
            parsed
              .map(
                (p, i) =>
                  `<div style="margin-top:6px"><b>${i + 1}. ${esc(p.title)}</b><div class="sd" style="white-space:pre-wrap;max-height:64px;overflow:hidden">${esc(p.content.slice(0, 120))}${p.content.length > 120 ? '…' : ''}</div></div>`,
              )
              .join('')
          : '<span style="color:var(--red)">文件里没有可用内容</span>';
      }
    } catch (err) {
      parsed = [];
      if (box) box.innerHTML = `<span style="color:var(--red)">读取失败：${esc(err.message)}</span>`;
    }
  });
}

/* ================= 会话 ================= */
async function pageSessions(root, force) {
  root.innerHTML = `<div class="skeleton">正在扫描本地会话…</div>`;
  const data = state.sessions && !force ? state.sessions : (state.sessions = await api('/sessions'));
  const items = data.items || [];
  const f = state.sessionFilter || (state.sessionFilter = { app: 'all', q: '', sort: 'project' });
  const apps = [...new Set(items.map((s) => s.app))];
  const filtered = items.filter((s) => {
    if (f.app !== 'all' && s.app !== f.app) return false;
    if (!f.q) return true;
    return `${s.title} ${s.project} ${s.cwd}`.toLowerCase().includes(f.q.toLowerCase());
  });

  const timeAgoShort = (iso) => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return `${Math.max(1, m)} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
  };

  let body = '';
  if (!filtered.length) {
    body = `<div class="empty" style="padding-top:70px"><h3 style="font-size:15px">没有找到会话</h3>
      <p>用任意 CLI 跑过任务后，会话会自动出现在这里。</p></div>`;
  } else if (f.sort === 'time') {
    body = `<div class="sess-list">${filtered
      .map(
        (s) => `<div class="sess-row open">
          <div class="sess-head" data-open="${s.id}">
            <svg class="sess-chev" style="transform:rotate(90deg)"><use href="#i-chevron"/></svg>
            <div style="min-width:0">
              <div class="sess-title truncate">${esc(s.title)}</div>
              <div class="sess-path mono truncate">${esc(s.cwd || s.project)}</div>
            </div>
            <div class="sess-meta">${esc(APP_LABEL[s.app] || s.app)} · ${s.messages} 条 · ${timeAgoShort(s.lastTs)}</div>
          </div>
        </div>`,
      )
      .join('')}</div>`;
  } else {
    const groups = new Map();
    for (const s of filtered) {
      const key = `${s.app}|${s.project || s.cwd || 'default'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    body = `<div class="sess-list">${[...groups.entries()]
      .sort((a, b) => new Date(b[1][0].lastTs) - new Date(a[1][0].lastTs))
      .map(
        ([key, list]) => `<div class="sess-row">
          <div class="sess-head" data-toggle>
            <svg class="sess-chev"><use href="#i-chevron"/></svg>
            <div style="min-width:0">
              <div class="sess-title truncate">${esc(list[0].project || list[0].cwd || key)}</div>
              <div class="sess-path mono truncate">${esc(list[0].cwd || list[0].project)}</div>
            </div>
            <div class="sess-meta">${list.length} 个会话 · ${timeAgoShort(list[0].lastTs)}</div>
          </div>
          <div class="sess-body">
            ${list
              .map(
                (s) => `<div class="sess-item" data-open="${s.id}">
                  <span class="badge blue">${esc(APP_LABEL[s.app] || s.app)}</span>
                  <span class="t">${esc(s.title)}</span>
                  <span class="d">${s.messages} 条 · ${timeAgoShort(s.lastTs)}</span>
                </div>`,
              )
              .join('')}
          </div>
        </div>`,
      )
      .join('')}</div>`;
  }

  root.innerHTML = `
    ${pageHead('会话', '浏览本机 CLI 的历史会话', `<button class="icon-round" id="sess-more"><svg width="16" height="16"><use href="#i-more"/></svg></button>`)}
    <div class="row" style="margin-bottom:12px;gap:10px;flex-wrap:wrap">
      <select class="sub-pill" id="sess-app" style="padding-right:24px">
        <option value="all">${f.app === 'all' ? '全部应用' : esc(APP_LABEL[f.app] || f.app)}</option>
        ${apps.map((a) => `<option value="${a}" ${f.app === a ? 'selected' : ''}>${esc(APP_LABEL[a] || a)}</option>`).join('')}
      </select>
      <input class="input" id="sess-search" placeholder="搜索标题、目录、首条消息或会话 ID" value="${esc(f.q)}" style="flex:1;min-width:220px" />
      <div class="tabs">
        <button class="tab ${f.sort === 'time' ? 'active' : ''}" data-sort="time">按时间</button>
        <button class="tab ${f.sort === 'project' ? 'active' : ''}" data-sort="project">按项目</button>
      </div>
    </div>
    ${body}`;

  $$('[data-sort]', root).forEach((b) => (b.onclick = () => { f.sort = b.dataset.sort; render(true); }));
  $('#sess-app')?.addEventListener('change', (e) => { f.app = e.target.value; render(true); });
  let t = null;
  $('#sess-search')?.addEventListener('input', (e) => {
    if (e.isComposing) return;
    f.q = e.target.value;
    const pos = e.target.selectionStart;
    clearTimeout(t);
    t = setTimeout(async () => {
      await render(true);
      const el = $('#sess-search');
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    }, 260);
  });
  $('#sess-more')?.addEventListener('click', () => { state.sessions = null; render(true); });
  $$('[data-toggle]', root).forEach((h) => (h.onclick = () => h.parentElement.classList.toggle('open')));
  $$('[data-open]', root).forEach((h) => (h.onclick = (e) => { e.stopPropagation(); openSession(h.dataset.open); }));
}

let sessionOpenSeq = 0;

async function openSession(id) {
  const seq = ++sessionOpenSeq;
  $('#drawer').classList.add('show');
  $('#drawer-mask').classList.add('show');
  $('#drawer-title').textContent = '加载中…';
  $('#drawer-body').innerHTML = '<div class="skeleton">读取会话…</div>';
  try {
    const data = await api(`/sessions/${id}`);
    if (seq !== sessionOpenSeq) return;
    $('#drawer-title').textContent = '会话详情';
    $('#drawer-body').innerHTML =
      data.messages
        .map(
          (m) => `<div class="msg ${m.role === 'user' ? 'user' : 'assistant'}">
            <div class="role">${esc(m.role)} ${m.ts ? '· ' + dt(m.ts) : ''}</div>${esc(m.text)}</div>`,
        )
        .join('') || '<div class="empty">没有可显示的消息</div>';
    applyI18n($('#drawer'));
  } catch (e) {
    if (seq !== sessionOpenSeq) return;
    $('#drawer-body').innerHTML = `<div class="notice"><svg><use href="#i-alert"/></svg><div>${esc(e.message)}</div></div>`;
  }
}

$('#drawer-mask').addEventListener('click', () => {
  $('#drawer').classList.remove('show');
  $('#drawer-mask').classList.remove('show');
});
$('[data-drawer-close]')?.addEventListener('click', () => {
  $('#drawer').classList.remove('show');
  $('#drawer-mask').classList.remove('show');
});

/* ================= 设置 ================= */
async function pageSettings(root, force) {
  const [s, bk, ov] = await Promise.all([api('/settings'), api('/backups'), loadOverview()]);
  const tab = state.settingsTab || 'general';
  const backups = bk.items || [];

  const nav = [
    ['general', '通用', 'i-sliders'],
    ['apps', '应用配置', 'i-folder'],
    ['route', '本地路由', 'i-route'],
    ['network', '网络', 'i-globe'],
    ['data', '数据', 'i-database'],
    ['about', '关于', 'i-info'],
  ];
  const navHtml = nav
    .map(
      ([k, label, icon]) =>
        `<div class="settings-nav-item ${tab === k ? 'active' : ''}" data-stab="${k}">
          <svg width="15" height="15"><use href="#${icon}"/></svg>${label}</div>`,
    )
    .join('');

  const sw = (key, value) => `<div class="switch ${value ? 'on' : ''}" data-switch="${key}"></div>`;
  const row = (label, desc, ctl) =>
    `<div class="srow"><div class="sl"><span>${label}</span>${desc ? `<div class="sd">${desc}</div>` : ''}</div>${ctl}</div>`;
  const sec = (title, inner, extra = '') => `<div class="set-section"><div class="set-h">${title}${extra}</div>${inner}</div>`;
  const soon = '<span class="badge amber" style="margin-left:6px">即将支持</span>';

  /* ---------------- 通用 ---------------- */
  const general = `
    <h2 class="set-title">通用</h2>
    <p class="set-sub">界面语言、外观主题、启动与窗口、数据迁移</p>
    ${sec('外观', `<div class="sgroup">
      ${row('界面语言', '界面文案支持简体中文与英文', `<div class="seg">${LANG_CHOICES.map(
        ([value, label]) => `<button class="${(s.language || 'zh') === value ? 'active' : ''}" data-lang-set="${value}">${label}</button>`,
      ).join('')}</div>`)}
      ${row('外观主题', '深色适合夜间使用；「跟随系统」会随 Windows 深浅色自动切换', `<div class="seg">${THEME_CHOICES.map(
        ([value, label]) => `<button class="${(s.theme || 'light') === value ? 'active' : ''}" data-theme-set="${value}">${label}</button>`,
      ).join('')}</div>`)}
    </div>`)}
    ${sec('启动与窗口', `<div class="sgroup">
      ${row('开机自启', '', sw('autoStart', s.autoStart))}
      ${row('静默启动', '启动时不显示主窗口，可从托盘打开', sw('silentStart', s.silentStart))}
      ${row('关闭时最小化到托盘', '', sw('closeToTray', s.closeToTray !== false))}
    </div>`)}
    ${sec('数据迁移', `<div class="sgroup">
      ${row('从 CC-Switch 导入', '把 CC-Switch（~/.cc-switch）的供应商一次性导入；CC-Switch 数据只读，不会被修改。', '<button class="btn" id="import-ccswitch"><svg><use href="#i-download"/></svg>从 CC-Switch 导入</button>')}
    </div>`)}
    ${sec('本机扫描', `<div class="sgroup">
      ${row('重新扫描本机', '重新检测 AI 应用与现有配置', '<button class="btn" id="rerun-wizard">开始扫描</button>')}
    </div>`)}`;

  /* ---------------- 应用配置 ---------------- */
  const appsTab = `
    <h2 class="set-title">应用配置</h2>
    <p class="set-sub">显示应用、以及各应用的开关与配置目录</p>
    ${sec('显示的应用', `<div class="sgroup">
      <div class="srow"><div class="sl"><span>控制模型管理、AI 商店与 MCP 矩阵里显示的应用，不会删除或停用已有配置。</span></div></div>
      ${(ov.apps || [])
        .map(
          (a) => `<div class="srow"><div class="sl"><span>${esc(a.label)}</span><div class="sd mono">${esc(a.configPath)}</div></div>
          <div class="switch ${(s.hiddenApps || []).includes(a.key) ? '' : 'on'}" data-appvisible="${a.key}"></div></div>`,
        )
        .join('')}
    </div>`)}
    ${(ov.apps || [])
      .filter((a) => a.installed)
      .map(
        (a) => `<div class="set-section"><div class="set-h">${esc(a.label)}</div><div class="sgroup">
          ${row('配置目录', '', `<div class="row" style="gap:6px"><input class="input mono set-select" readonly value="${esc(a.configPath)}" />
            <button class="btn sm" data-copy="${esc(a.configPath)}">复制</button></div>`)}
          ${row('在模型中显示', '', `<div class="switch ${(s.hiddenApps || []).includes(a.key) ? '' : 'on'}" data-appvisible="${a.key}"></div>`)}
        </div></div>`,
      )
      .join('')}`;

  /* ---------------- 本地路由 ---------------- */
  const gw = ov.gateway || {};
  const routeApps = (ov.apps || []).filter((a) => (ov.active || {})[a.key]);
  const routeTab = `
    <h2 class="set-title">本地路由</h2>
    <p class="set-sub">本地聚合网关，故障转移与整流</p>
    <div class="notice" style="margin-bottom:14px"><svg><use href="#i-shield"/></svg>
      <div>本地路由在本机转发各应用的模型请求，不是智能体加速，与「AI 通用加速」无关。</div></div>
    ${sec('服务', `<div class="sgroup">
      <div class="srow">
        <div class="sl"><span>路由服务</span><div class="sd"><span class="dot ${gw.running ? 'on' : 'off'}"></span> ${gw.running ? '运行中 · 已运行' : '未启动'}</div></div>
        <div class="row" style="gap:18px;font-size:11.5px;color:var(--muted)">
          <span>总请求数 <b style="color:var(--text)">${gw.requests || 0}</b></span>
          <span>成功率 <b style="color:var(--text)">${gw.requests ? Math.round(((gw.requests - gw.errors) / gw.requests) * 100) : 0}%</b></span>
          <button class="btn sm" id="gw-toggle">${gw.running ? '停止' : '启动'}</button>
        </div>
      </div>
      ${row('监听地址与端口', '推荐 127.0.0.1', `<div class="row" style="gap:6px">
        <input class="input mono set-select" readonly value="127.0.0.1" />
        <input class="input mono" id="set-port" style="width:100px" value="${esc(s.gatewayPort)}" />
        <button class="btn sm" id="gw-save-port">保存并重启</button></div>`)}
      ${row('连接地址', '客户端连接使用的地址', `<div class="row" style="gap:6px"><input class="input mono set-select" readonly value="http://127.0.0.1:${esc(gw.port || s.gatewayPort)}" /><button class="btn sm" data-copy="http://127.0.0.1:${esc(gw.port || s.gatewayPort)}">复制</button></div>`)}
      ${row('记录请求用量', '', sw('logRequests', s.logRequests !== false))}
    </div>`)}
    ${sec(`正在使用路由的应用 · ${routeApps.length}`, `<div class="sgroup">
      ${routeApps.length
        ? routeApps
            .map(
              (a) => `<div class="srow"><div class="sl"><span>${esc(a.label)}</span><div class="sd">经由本地网关</div></div>
              <button class="btn sm" data-goto="providers">前往</button></div>`,
            )
            .join('')
        : '<div class="srow"><div class="sl"><span>还没有应用指向本地网关</span><div class="sd">在模型管理里把供应商 Base URL 指向连接地址即可</div></div></div>'}
    </div>`)}
    ${sec('自动故障转移', `<div class="sgroup">
      <div class="srow"><div class="sl"><span>当故障转移队列中配置了多个供应商时，系统会在请求失败时按优先级依次尝试。</span></div></div>
      ${row('重试与超时', '故障转移最多尝试的供应商数 / 非流式请求超时', `<div class="row" style="gap:10px">
        <label class="sd">最大尝试数<input type="number" min="1" max="10" class="input mono" style="width:70px" id="set-retry" value="${esc(s.retryCount ?? 2)}" /></label>
        <input type="number" min="5000" max="600000" step="1000" class="input mono" style="width:100px" id="set-timeout" value="${esc(s.requestTimeout || 120000)}" />
        <span class="sd">毫秒</span>
      </div>`)}
    </div>`)}`;

  /* ---------------- 网络 ---------------- */
  const networkTab = `
    <h2 class="set-title">网络</h2>
    <p class="set-sub">出站代理与镜像源</p>
    ${sec('全局出站代理', `<div class="sgroup">
      <div class="srow"><div class="sl"><span>当前版本未接入自定义代理，API、余额和网关请求均直接连接目标服务。</span><div class="sd">如需代理，可在系统层或路由器层配置。</div></div>
        <span class="badge amber">规划中</span></div>
      ${row('镜像源', 'npm / pip / Docker 换源与测速', '<button class="btn sm" data-goto="accel">打开 AI 通用加速</button>')}
    </div>`)}`;

  /* ---------------- 数据 ---------------- */
  const dataTab = `
    <h2 class="set-title">数据</h2>
    <p class="set-sub">存储位置、导入导出、备份恢复、云同步与诊断日志</p>
    ${sec('存储位置', `<div class="sgroup">
      ${row('数据目录', '当前数据目录；迁移请关闭程序后整体复制', `<div class="row" style="gap:6px">
        <input class="input mono set-select" readonly value="${esc(ov.dataDir)}" />
        <button class="btn sm" data-copy="${esc(ov.dataDir)}">复制</button></div>`)}
    </div>`)}
    ${sec('数据管理', `<div class="sgroup">
      ${row('配置导入 / 导出', '导出供应商、MCP、提示词（不含 API Key）', `<div class="row" style="gap:8px">
        <button class="btn sm" id="export-config"><svg><use href="#i-download"/></svg>导出配置</button>
        <button class="btn sm" id="import-config">导入配置</button></div>`)}
    </div>`)}
    ${sec('备份与恢复', `<div class="sgroup">
      <div class="srow"><div class="sl"><span>备份文件包含本机配置中的 API Key，请只存放在本机并注意磁盘权限。</span></div></div>
      ${row('自动备份间隔', '', `<select class="select set-select" data-set-select="backupInterval">
        ${['关闭', '6 小时', '12 小时', '24 小时'].map((t) => `<option ${(s.backupInterval || '24 小时') === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>`)}
      ${row('备份保留数量', '', `<select class="select set-select" data-set-select="backupKeep">
        ${['5', '10', '20', '50'].map((t) => `<option ${String(s.backupKeep || 20) === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>`)}
      ${row('立即备份', '', '<button class="btn sm" id="do-backup"><svg><use href="#i-download"/></svg>立即备份</button>')}
      <div class="srow">
        <div class="row" style="gap:10px">
          <label class="row" style="gap:6px;cursor:pointer"><input type="checkbox" id="bk-all" />全选</label>
          <span class="sd">已选 <b id="bk-count">0</b> / ${backups.length} 项</span>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn sm" id="bk-del-sel" disabled>删除选中</button>
          <button class="btn danger sm" id="bk-clear" ${backups.length ? '' : 'disabled'}>一键清除</button>
        </div>
      </div>
      ${backups
        .slice(0, 20)
        .map(
          (b) => `<div class="srow"><div class="row" style="gap:10px">
            <input type="checkbox" class="bk-pick" value="${esc(b.id)}" />
            <div class="sl"><span>${esc(b.label)}</span><div class="sd">${dt(b.createdAt)} · ${(b.size / 1024).toFixed(1)} KB${b.target ? ' · ' + esc(b.target) : ''}</div></div></div>
          ${b.restorable === false ? '<span class="badge gray">不可恢复</span>' : `<button class="btn sm" data-restore="${esc(b.id)}">恢复</button>`}</div>`,
        )
        .join('')}
    </div>`)}
    ${sec('云同步' + soon, `<div class="sgroup">
      ${row('同步方式', '', '<span class="badge">WebDAV（规划中）</span>')}
      ${row('WebDAV 服务器地址', '', '<input class="input mono set-select" disabled placeholder="https://dav.example.com/dav/" />')}
      ${row('远程目录 / 同步配置名', '', '<div class="row" style="gap:8px"><input class="input mono" style="width:130px" disabled placeholder="ai-manager-sync" /><input class="input mono" style="width:110px" disabled placeholder="default" /></div>')}
    </div>`)}
    ${sec('应用诊断日志', `<div class="sgroup">
      ${row('导出诊断包', '版本、系统、配置概览（不含 API Key），保存在数据目录的 diagnostics 里，自行发给维护者', '<button class="btn sm" id="export-diag"><svg><use href="#i-download"/></svg>导出诊断包</button>')}
      <div class="srow"><div class="sl"><span>本工具不会上传诊断信息；导出后由你自行决定发给谁。</span></div></div>
    </div>`)}
    ${sec('危险操作', `<div class="sgroup">
      ${row('清除用量记录', '只删除本机统计，不影响供应商配置', '<button class="btn danger sm" id="clear-usage">清除</button>')}
    </div>`)}`;

  /* ---------------- 关于 ---------------- */
  const aboutTab = `
    <h2 class="set-title">关于</h2>
    <p class="set-sub">版本、更新与法律信息</p>
    <div class="sgroup" style="margin-bottom:16px">
      <div class="srow">
        <div class="row" style="gap:12px">
          <div class="side-logo" style="width:38px;height:38px"><svg width="19" height="19"><use href="#i-zap"/></svg></div>
          <div><div class="sl" style="font-weight:600;font-size:13.5px">迅龙AI管家 <span class="badge">v${esc(ov.version)}</span></div>
            <div class="sd">AI 管家一站式 · 供应商切换、本地网关、MCP 与用量统计</div></div>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn sm" id="about-update"><svg><use href="#i-refresh"/></svg>版本信息</button>
          <span class="sd">本地版本</span>
        </div>
      </div>
      <div class="srow"><div class="sl"><span>历史更新</span></div><span class="badge">v1.1.0 · 适配器与安全审计</span></div>
    </div>
    ${sec('链接', `<div class="sgroup">
      ${row('免费声明', '无账号、无会员、无积分、无次数限制', '<span class="badge green">全部免费</span>')}
    </div>`)}
    <div class="sd" style="margin-top:18px">© 2026 迅龙AI管家 · 独立实现的免费工具</div>`;

  const body = { general, apps: appsTab, route: routeTab, network: networkTab, data: dataTab, about: aboutTab }[tab] || general;

  root.innerHTML = `
    <div class="settings-shell">
      <aside class="settings-nav">
        <button class="back-link" id="back-app"><svg width="14" height="14" style="transform:rotate(180deg)"><use href="#i-chevron"/></svg>返回应用</button>
        <div class="side-label">设置</div>
        ${navHtml}
      </aside>
      <div class="settings-body">${body}</div>
    </div>`;

  $('#back-app')?.addEventListener('click', () => { state.settingsTab = 'general'; location.hash = '#/store'; });
  $$('[data-stab]', root).forEach((el) => (el.onclick = () => { state.settingsTab = el.dataset.stab; render(true); }));

  const save = async (patch) => {
    try {
      await api('/settings', { method: 'PUT', body: patch });
      toast('已保存');
      state.overview = null;
      return true;
    } catch (e) {
      toast(e.message, 'err');
      return false;
    }
  };

  $$('[data-switch]', root).forEach((el) => (el.onclick = async () => {
    el.classList.toggle('on');
    await save({ [el.dataset.switch]: el.classList.contains('on') });
  }));
  $$('[data-theme-set]', root).forEach((el) => (el.onclick = async () => {
    const value = el.dataset.themeSet;
    applyTheme(value);
    $$('[data-theme-set]', root).forEach((b) => b.classList.toggle('active', b === el));
    s.theme = value;
    if (state.settings) state.settings.theme = value;
    await save({ theme: value });
  }));
  $$('[data-lang-set]', root).forEach((el) => (el.onclick = async () => {
    const value = el.dataset.langSet === 'en' ? 'en' : 'zh';
    if (value === uiLang()) return;
    state.lang = value;
    setUiLang(value);
    s.language = value;
    if (state.settings) state.settings.language = value;
    await save({ language: value });
    if (value === 'zh') restoreI18n(); // 先把静态文案还原成中文，再重渲染
    await render(true);
    if (value === 'en') applyI18n();
  }));
  $$('[data-appvisible]', root).forEach((el) => (el.onclick = async () => {
    el.classList.toggle('on');
    const key = el.dataset.appvisible;
    const hidden = new Set(s.hiddenApps || []);
    if (el.classList.contains('on')) hidden.delete(key);
    else hidden.add(key);
    s.hiddenApps = [...hidden];
    await save({ hiddenApps: s.hiddenApps });
    state.overview = null;
  }));
  $$('[data-copy]', root).forEach((b) => (b.onclick = () => copyText(b.dataset.copy, '已复制')));
  $$('[data-set-select]').forEach((el) => el.addEventListener('change', (e) => {
    const k = e.target.dataset.setSelect;
    save({ [k]: k === 'backupKeep' ? Number(e.target.value) : e.target.value });
  }));
  $('#set-port')?.addEventListener('change', (e) => save({ gatewayPort: Number(e.target.value) }));
  $('#set-timeout')?.addEventListener('change', (e) => save({ requestTimeout: Number(e.target.value) }));
  $('#set-retry')?.addEventListener('change', (e) => save({ retryCount: Number(e.target.value) }));
  $('#gw-save-port')?.addEventListener('click', async () => {
    const port = Number($('#set-port').value);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return toast('端口需在 1024-65535 之间', 'err');
    if (!(await save({ gatewayPort: port }))) return;
    try {
      await api('/gateway/start', { body: { port } });
      toast('网关已在新端口启动');
      state.overview = null;
      render(true);
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $('#gw-toggle')?.addEventListener('click', async () => {
    try {
      if ((ov.gateway || {}).running) await api('/gateway/stop', { body: {} });
      else await api('/gateway/start', { body: { port: Number(s.gatewayPort) } });
      state.overview = null;
      render(true);
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $$('[data-goto]', root).forEach((b) => (b.onclick = () => (location.hash = `#/${b.dataset.goto}`)));

  $('#import-ccswitch')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api('/import/ccswitch', { body: {} });
      toast(`已导入 ${r.imported} 个供应商${r.skipped ? `，跳过 ${r.skipped}` : ''}`);
      state.providers = null;
      render(true);
    } catch (err) {
      toast(err.message, 'err');
      e.currentTarget.disabled = false;
    }
  });
  $('#rerun-wizard')?.addEventListener('click', () => openScanModal());
  $('#do-backup')?.addEventListener('click', async () => {
    try {
      const r = await api('/backups', { body: { label: '手动备份' } });
      toast(`备份完成 · ${r.item.files} 个文件`);
      render(true);
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $$('[data-restore]', root).forEach((b) => (b.onclick = async () => {
    if (!confirm('恢复会覆盖当前配置，确定继续？')) return;
    try {
      const r = await api(`/backups/${b.dataset.restore}/restore`, { body: {} });
      toast(`已恢复 ${r.restored.length} 个文件${r.errors?.length ? `，${r.errors.length} 个失败` : ''}`, r.errors?.length ? 'err' : 'ok');
      state.providers = null;
      render(true);
    } catch (e) {
      toast(e.message, 'err');
    }
  }));
  const picks = $$('.bk-pick', root);
  const syncPick = () => {
    const n = picks.filter((c) => c.checked).length;
    const cnt = $('#bk-count', root);
    if (cnt) cnt.textContent = String(n);
    const all = $('#bk-all', root);
    if (all) {
      all.checked = picks.length > 0 && n === picks.length;
      all.indeterminate = n > 0 && n < picks.length;
    }
    const del = $('#bk-del-sel', root);
    if (del) del.disabled = n === 0;
  };
  picks.forEach((c) => (c.onchange = syncPick));
  $('#bk-all', root)?.addEventListener('change', (e) => {
    picks.forEach((c) => (c.checked = e.currentTarget.checked));
    syncPick();
  });
  $('#bk-del-sel', root)?.addEventListener('click', () => {
    const ids = picks.filter((c) => c.checked).map((c) => c.value);
    if (!ids.length) return;
    askConfirm({
      title: '删除备份',
      text: `将删除选中的 ${ids.length} 个备份文件，删除后无法恢复。`,
      okLabel: '删除',
      danger: true,
      onOk: async () => {
        let ok = 0;
        let fail = 0;
        for (const id of ids) {
          try {
            await api(`/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
            ok += 1;
          } catch {
            fail += 1;
          }
        }
        closeModal();
        state.prompts = null;
        toast(`已删除 ${ok} 个备份${fail ? `，${fail} 个失败` : ''}`, fail ? 'err' : 'ok');
        render(true);
      },
    });
  });
  $('#bk-clear', root)?.addEventListener('click', () => {
    const total = picks.length;
    askConfirm({
      title: '清除全部备份',
      text: `将删除全部 ${total} 个备份文件（含自动备份），删除后无法恢复。建议先确认当前配置可用。`,
      okLabel: '全部清除',
      danger: true,
      onOk: async () => {
        try {
          const r = await api('/backups', { method: 'DELETE' });
          closeModal();
          toast(`已清除 ${r.removed} 个备份`);
          render(true);
        } catch (err) {
          toast(err.message, 'err');
        }
      },
    });
  });
  $('#clear-usage')?.addEventListener('click', async () => {
    if (!confirm('确定清除网关用量记录？会话日志用量仍会从本机会话文件重新统计。')) return;
    try {
      await api('/usage/clear', { body: {} });
      state.usage = null;
      toast('已清除网关记录');
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $('#export-diag')?.addEventListener('click', (e) => exportDiagnostics(e.currentTarget));
  $('#export-config')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const [providers, mcp, prompts] = await Promise.all([api('/providers'), api('/mcp'), api('/prompts')]);
      const payload = {
        version: ov.version,
        exportedAt: new Date().toISOString(),
        providers: providers.items.map((p) => ({ ...p, apiKey: '', usageQuery: p.usageQuery ? { ...p.usageQuery, headers: '' } : undefined })),
        mcp: mcp.items,
        prompts: prompts.items,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `xunlong-config-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('配置已导出（不含 Key）');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      e.currentTarget.disabled = false;
    }
  });
  $('#import-config')?.addEventListener('click', () => pickConfigImport());
  $('#about-update')?.addEventListener('click', () => toast(`当前版本 v${ov.version} · 自动更新尚未接入，请手动替换程序目录`));
}

function pickConfigImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast('配置文件过大（上限 2MB）', 'err');
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('不是有效的配置文件');
      if (!confirm('导入会新增供应商、MCP 与提示词（不覆盖同名项）。继续？')) return;
      const r = await api('/import/config', { body: { data } });
      state.providers = null;
      state.prompts = null;
      state.overview = null;
      toast(`已导入：供应商 ${r.providers} · MCP ${r.mcp} · 提示词 ${r.prompts}${r.skipped ? `，跳过 ${r.skipped}` : ''}`);
      render(true);
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  input.click();
}

async function pageAccel(root) {
  const st = await api('/mirrors');
  const mirrors = [
    { key: 'github', label: 'GitHub 下载', url: 'https://ghproxy.net/https://github.com/', hint: '在 GitHub 地址前加前缀' },
    { key: 'hf', label: 'HuggingFace', url: 'https://hf-mirror.com', hint: '替换 huggingface.co' },
  ];
  const row = (label, current, key, hint = '') => `<div class="srow">
    <div class="sl"><span>${label}</span><div class="sd mono">${esc(current || '未设置（使用官方源）')}</div>${hint ? `<div class="sd">${hint}</div>` : ''}</div>
    <div class="row" style="gap:6px">
      <button class="btn sm" data-apply="${key}">换源</button>
      <button class="btn sm ghost" data-restore="${key}">还原</button>
    </div>
  </div>`;

  root.innerHTML = `
    ${pageHead('AI 通用加速', '镜像换源、测速与还原：不改网络出口，只换更快的源', '<span class="badge green">免费</span>')}
    <div class="notice" style="margin-bottom:14px"><svg><use href="#i-shield"/></svg>
      <div>本页只修改 npm / pip / Docker 的下载源，<b>不建立隧道、不修改系统代理、不绕过网络管控</b>。每次修改前都会自动备份，可一键还原。</div></div>

    <div class="accel-hero">
      <div class="accel-ring"><svg width="26" height="26"><use href="#i-globe"/></svg></div>
      <div style="flex:1">
        <div class="accel-title">镜像加速</div>
        <div class="accel-sub">先测速，再换源；换源后重新打开终端生效</div>
      </div>
      <button class="btn primary" id="speed-test"><svg><use href="#i-zap"/></svg>全部测速</button>
    </div>

    <div class="store-section">
      <div class="store-section-title">镜像测速</div>
      <div class="sgroup" id="speed-list">
        <div class="srow"><div class="sl"><span>点击右上角「全部测速」</span><div class="sd">会依次请求各镜像的探测地址，只测连通与延迟</div></div></div>
      </div>
    </div>

    <div class="store-section">
      <div class="store-section-title">一键换源</div>
      <div class="sgroup">
        ${row('npm registry', st.npm.current, 'npm', `文件：${st.npm.file}`)}
        ${row('pip index-url', st.pip.current, 'pip', `文件：${st.pip.file}`)}
        ${row('Docker registry-mirrors', st.docker.current, 'docker', `文件：${st.docker.file} · 需重启 Docker Desktop`)}
      </div>
    </div>

    <div class="store-section">
      <div class="store-section-title">下载加速地址</div>
      <div class="store-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
        ${mirrors
          .map(
            (m) => `<div class="mini-card">
              <div class="nm">${esc(m.label)}</div>
              <div class="desc">${esc(m.hint)}</div>
              <div class="copybox" style="margin-top:6px"><span>${esc(m.url)}</span>
                <button class="btn sm" data-copy="${esc(m.url)}">复制</button></div>
            </div>`,
          )
          .join('')}
      </div>
    </div>`;

  $$('[data-copy]', root).forEach((b) => (b.onclick = () => copyText(b.dataset.copy, '已复制')));

  $('#speed-test')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '测速中…';
    const box = $('#speed-list');
    try {
      const r = await api('/mirrors/test', { body: {} });
      box.innerHTML = r.results
        .map(
          (x) => `<div class="srow">
            <div class="sl"><span>${esc(x.label)}</span><div class="sd mono">${esc(x.url)}</div></div>
            ${x.ok
              ? `<span class="badge ${x.ms < 400 ? 'green' : x.ms < 1200 ? 'blue' : 'amber'}">${x.ms} ms</span>`
              : '<span class="badge gray">不可达</span>'}
          </div>`,
        )
        .join('');
    } catch (err) {
      toast(err.message, 'err');
    }
    btn.disabled = false;
    btn.innerHTML = '<svg><use href="#i-zap"/></svg>全部测速';
  });

  $$('[data-apply]', root).forEach((b) => (b.onclick = async () => {
    const key = b.dataset.apply;
    const names = { npm: 'npm', pip: 'pip', docker: 'Docker' };
    if (!confirm(`把 ${names[key]} 切换到国内镜像？原配置会自动备份。`)) return;
    b.disabled = true;
    try {
      const r = await api('/mirrors/apply', { body: { target: key } });
      toast(`${names[key]} 已切换${r.note ? '（' + r.note + '）' : ''}`);
      render(true);
    } catch (err) {
      toast(err.message, 'err');
      b.disabled = false;
    }
  }));

  $$('[data-restore]', root).forEach((b) => (b.onclick = async () => {
    if (!confirm('恢复该目标的上一份备份？')) return;
    try {
      const r = await api('/mirrors/restore', { body: { target: b.dataset.restore } });
      toast(`已还原：${r.restored}`);
      render(true);
    } catch (err) {
      toast(err.message, 'err');
    }
  }));
}

async function pageAppDetail(root, force) {
  const [ov, providers] = await Promise.all([loadOverview(force), loadProviders()]);
  const key = state.detailApp || 'claude';
  const app = (ov.apps || []).find((a) => a.key === key);
  if (!app) {
    root.innerHTML = pageHead('应用详情', '未找到该应用');
    return;
  }
  const list = providers.filter((p) => p.app === key);
  const active = list.find((p) => p.activatedAt);
  const mcpSupported = ['claude', 'codex', 'gemini', 'qwen'].includes(key);

  root.innerHTML = `
    <button class="back-link" id="detail-back"><svg width="14" height="14" style="transform:rotate(180deg)"><use href="#i-chevron"/></svg>返回 AI 商店</button>

    <div class="detail-head">
      <div class="detail-icon">${appIcon(key, app.label, 'lg')}</div>
      <div style="min-width:0">
        <div class="detail-name">${esc(app.label)}
          <span class="badge ${app.installed ? 'green' : 'gray'}">${app.installed ? '已安装' : '未检测到'}</span>
          ${app.readOnly ? '<span class="badge gray">仅识别</span>' : ''}
        </div>
        <div class="sd">${esc((app.protocol || '').toUpperCase())} · ${esc(APP_DESC[key] || '')}</div>
        ${app.docs ? `<a class="sd" href="${esc(app.docs)}" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:4px">使用教程 ↗</a>` : ''}
      </div>
      <div class="spacer"></div>
      <div class="row" style="gap:8px">
        <span class="badge">${list.length} 个供应商</span>
        <button class="btn" id="detail-update"><svg><use href="#i-refresh"/></svg>版本信息</button>
        <button class="btn primary" id="detail-manage"><svg><use href="#i-server"/></svg>${list.length ? (app.readOnly ? '查看记录' : '管理供应商') : (app.readOnly ? '查看配置' : '添加供应商')}</button>
      </div>
    </div>

    <div class="card" style="margin:6px 0 10px">
      <div class="card-head" style="margin-bottom:10px">
        <div><div class="card-title"><svg><use href="#i-server"/></svg>当前模型配置</div>
          <div class="card-note">勾选后可在 ${esc(app.label)} 的模型选择器中使用</div></div>
        <button class="btn sm ghost" id="detail-manage3">管理 ↗</button>
      </div>
      <div class="row" style="gap:8px">
        <select class="select" id="detail-provider" style="max-width:360px">
          ${list.length
            ? list.map((p) => `<option value="${p.id}" ${p.activatedAt ? 'selected' : ''}>${esc(p.name)}${p.model ? ' · ' + esc(p.model) : ''}</option>`).join('')
            : '<option value="">还没有供应商</option>'}
        </select>
        <button class="btn primary" id="detail-apply" ${list.length && !app.readOnly ? '' : 'disabled'}>应用</button>
        ${active ? '<span class="badge green">使用中</span>' : '<span class="badge">未启用</span>'}
      </div>
      ${app.readOnly ? '<div class="sd" style="margin-top:8px">该应用为只读识别：可以读取当前配置和导入记录，但不会写回应用配置。</div>' : ''}
    </div>

    <div class="store-section">
      <div class="store-section-title">工具箱</div>
      <div class="grid grid-3">
        <div class="card">
          <div class="card-head" style="margin-bottom:8px"><div class="card-title"><svg><use href="#i-server"/></svg>当前模型配置</div>
            <button class="btn sm ghost" id="detail-manage2">管理 ↗</button></div>
          ${active
            ? `<div class="row" style="gap:10px"><span class="prov-avatar">${esc(active.name.slice(0, 1))}</span>
               <div style="min-width:0"><div class="store-name" style="text-align:left">${esc(active.name)}</div>
               <div class="store-ver" style="text-align:left">${esc(active.model || '默认模型')}</div></div>
               <span class="badge green" style="margin-left:auto">使用中</span></div>`
            : (app.current?.provider || app.current?.model)
              ? `<div class="row" style="gap:10px"><span class="prov-avatar">${esc((app.current.provider || 'C').slice(0, 1).toUpperCase())}</span>
                 <div style="min-width:0"><div class="store-name" style="text-align:left">${esc(app.current.provider || 'CLI 当前配置')}</div>
                 <div class="store-ver" style="text-align:left">${esc(app.current.model || '')}${app.current.baseUrl ? ' · ' + esc(app.current.baseUrl) : ' · 内置账号'}</div></div>
                 <span class="badge green" style="margin-left:auto">已配置</span></div>` + '<div class="sd" style="margin-top:10px">这是 CLI 当前生效的配置，尚未通过本工具切换。</div>'
              : `<div class="sd">还没有配置供应商${app.readOnly ? (key === 'claudeDesktop' ? '（该应用使用账号登录，无 API 供应商配置）' : '（已读取本机配置，但该应用为只读，不会写回）') : ''}</div>`}
          <div class="sd" style="margin-top:10px">从这里切换只影响本应用，不改其它 CLI。</div>
        </div>

        <div class="card">
          <div class="card-head" style="margin-bottom:8px"><div class="card-title"><svg><use href="#i-plug"/></svg>MCP 同步</div></div>
          <div class="sd">把「MCP」页启用的服务器写入本应用配置。</div>
          <div class="row" style="margin-top:12px;gap:8px">
            <button class="btn sm" id="detail-mcp" ${app.readOnly || !mcpSupported ? 'disabled title="该应用暂不支持写入 MCP"' : ''}>${app.readOnly ? '只读' : mcpSupported ? '立即同步' : '暂不支持'}</button>
            <span class="badge">${ov.mcpCount || 0} 个服务器</span>
          </div>
        </div>

        <div class="card">
          <div class="card-head" style="margin-bottom:8px"><div class="card-title"><svg><use href="#i-clock"/></svg>会话与用量</div></div>
          <div class="sd">浏览该应用的历史会话与调用记录。</div>
          <div class="row" style="margin-top:12px;gap:8px">
            <button class="btn sm" data-goto="sessions">会话</button>
            <button class="btn sm" data-goto="usage">用量</button>
          </div>
        </div>
      </div>
    </div>

    <div class="store-section">
      <div class="store-section-title">免费工具</div>
      <div class="grid grid-3">
        <div class="card">
          <div class="card-title" style="margin-bottom:8px"><svg><use href="#i-search"/></svg>扫描本机配置</div>
          <div class="sd">自动识别本机已有配置并导入。</div>
          <div style="margin-top:12px"><button class="btn sm" id="detail-scan">扫描本机</button></div>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:8px"><svg><use href="#i-route"/></svg>本地网关</div>
          <div class="sd">${ov.gateway?.running ? '运行中 · 端口 ' + ov.gateway.port : '未启动'}，可用于故障转移。</div>
          <div style="margin-top:12px"><button class="btn sm" data-goto="gateway">打开网关</button></div>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:8px"><svg><use href="#i-download"/></svg>备份与配置目录</div>
          <div class="sd mono truncate">${esc(app.configPath)}</div>
          <div class="row" style="margin-top:12px;gap:8px">
            <button class="btn sm" id="detail-copy">复制路径</button>
            <button class="btn sm" data-goto="settings">备份</button>
          </div>
        </div>
      </div>
    </div>

    <div class="store-section">
      <div class="store-section-title">危险操作</div>
      <div class="sgroup">
        <div class="srow"><div class="sl"><span>移除该应用的供应商记录</span>
          <div class="sd">只删除本工具保存的记录，不会修改 ${esc(app.label)} 的实际配置文件。</div></div>
          <button class="btn danger sm" id="detail-remove">移除 ${list.length} 条记录</button></div>
      </div>
    </div>`;

  const goManage = () => {
    if (app.readOnly) {
      toast('该应用为只读识别，不参与模型管理；记录可在此页「危险操作」里移除');
      return;
    }
    state.app = key; location.hash = '#/providers';
  };
  $('#detail-back')?.addEventListener('click', () => (location.hash = '#/store'));
  $('#detail-manage')?.addEventListener('click', goManage);
  $('#detail-manage2')?.addEventListener('click', goManage);
  $('#detail-manage3')?.addEventListener('click', goManage);
  $('#detail-update')?.addEventListener('click', () => toast(`当前版本 v${ov.version} · 自动更新尚未接入`));
  $('#detail-apply')?.addEventListener('click', async () => {
    const id = $('#detail-provider')?.value;
    if (!id) return toast('还没有可用的供应商', 'err');
    try {
      await api(`/providers/${id}/activate`, { body: {} });
      toast('已切换');
      state.providers = null;
      state.overview = null;
      render(true);
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $('#detail-scan')?.addEventListener('click', () => openScanModal());
  $('#detail-mcp')?.addEventListener('click', async () => {
    try {
      const r = await api('/mcp/apply', { body: {} });
      toast(`已同步：Claude ${r.result.claude || 0} · Codex ${r.result.codex || 0} · Gemini ${r.result.gemini || 0}`);
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $('#detail-copy')?.addEventListener('click', () => copyText(app.configPath, '路径已复制'));
  $$('[data-goto]', root).forEach((b) => (b.onclick = () => (location.hash = `#/${b.dataset.goto}`)));
  $('#detail-remove')?.addEventListener('click', async () => {
    if (!list.length) return toast('没有可移除的记录');
    if (!confirm(`确定移除 ${app.label} 的 ${list.length} 条供应商记录？（不会修改 CLI 配置文件）`)) return;
    for (const p of list) await api(`/providers/${p.id}`, { method: 'DELETE' });
    state.providers = null;
    toast('已移除记录');
    render(true);
  });
}


async function pageDesktopDetail(root) {
  const data = await api('/desktop-apps');
  const name = state.desktopName || '';
  const app = (data.items || []).find((d) => d.name === name);
  if (!app) {
    root.innerHTML = pageHead('桌面应用', '未找到该应用');
    return;
  }
  const related = /chatgpt/i.test(name) ? 'codex' : /claude/i.test(name) ? 'claude' : /deepseek harness/i.test(name) ? 'dsh' : '';
  const relatedLabel = related ? APP_LABEL[related] : '';

  const toolCard = (title, icon, desc, btnId, btnText, primary = false) => `
    <div class="card">
      <div class="card-title" style="margin-bottom:8px"><svg><use href="#${icon}"/></svg>${title}</div>
      <div class="sd">${desc}</div>
      <div class="row" style="margin-top:12px"><button class="store-btn ${primary ? 'primary' : ''}" ${btnId.startsWith('goto:') ? `data-goto="${btnId.slice(5)}"` : `id="${btnId}"`}>${btnText}</button></div>
    </div>`;

  root.innerHTML = `
    <button class="back-link" id="desk-back"><svg width="14" height="14" style="transform:rotate(180deg)"><use href="#i-chevron"/></svg>返回 AI 商店</button>

    <div class="detail-head">
      <div class="detail-icon">${appIcon('', name, 'lg')}</div>
      <div style="min-width:0">
        <div class="detail-name">${esc(name)}
          <span class="badge green">已安装</span>
          ${app.version ? `<span class="badge">v${esc(app.version)}</span>` : ''}
        </div>
        <div class="sd">${esc(app.publisher || '桌面应用')} · ${esc(app.location || '')}</div>
        <span class="sd" style="display:inline-block;margin-top:4px">安装与更新请在该应用客户端内完成</span>
      </div>
      <div class="spacer"></div>
      <div class="row" style="gap:8px">
        <button class="btn" id="desk-update"><svg><use href="#i-refresh"/></svg>版本信息</button>
        <button class="btn primary" id="desk-launch" ${app.exe ? '' : 'disabled'}><svg><use href="#i-play"/></svg>启动应用</button>
      </div>
    </div>

    <div class="card" style="margin:6px 0 14px">
      <div class="card-head" style="margin-bottom:10px">
        <div><div class="card-title"><svg><use href="#i-server"/></svg>当前模型配置</div>
          <div class="card-note">勾选后可在 ${esc(name)} 的模型选择器中使用</div></div>
        ${related ? `<button class="btn sm ghost" id="desk-manage">管理 ↗</button>` : ''}
      </div>
      <div class="row" style="gap:8px">
        <select class="select" style="max-width:360px" disabled><option>${esc(name)} 账号登录</option></select>
        <span class="badge">官方账号</span>
        <span class="sd" style="margin-left:8px">桌面应用使用自身账号，不走 API 供应商${related ? `；对应的 CLI 是 ${esc(relatedLabel)}` : ''}</span>
      </div>
    </div>

    <div class="store-section" style="margin-top:6px">
      <div class="store-section-title">工具</div>
      <div class="grid grid-3">
        ${toolCard('MCP 同步', 'i-plug', '把「MCP」页启用的服务器写入相关 CLI 配置。', 'desk-mcp', '立即同步')}
        ${toolCard('Skills', 'i-prompt', '查看本机已安装的技能，支持从 ZIP 导入。', 'goto:skills', '打开 Skills')}
        ${toolCard('会话', 'i-clock', '浏览本机 CLI 的历史会话。', 'goto:sessions', '打开会话')}
        ${toolCard('Token 用量', 'i-chart', '按天、按供应商、按模型统计调用。', 'goto:usage', '查看用量')}
        ${toolCard('插件市场', 'i-download', '公开开源 MCP 服务器，装到 Claude / Codex / Gemini / Qwen。', 'goto:market', '浏览插件')}
        ${toolCard('安装位置', 'i-folder', esc(app.location || '未记录安装路径'), 'desk-open', '打开目录')}
      </div>
    </div>

    ${/deepseek harness/i.test(name) ? `<div class="store-section">
      <div class="store-section-title">精选插件</div>
      <div class="grid grid-3">
        ${[
          ['pet.webp', '大肥鱼桌宠（DSH 端内）', '桌面常驻小鲸鱼，可实时查 API 余额与今日消耗。', 'dsh-pet'],
          ['pet-box.webp', '大肥鱼桌宠（桌面版）', '独立桌面端桌宠，可拖拽、可互动。', 'dsh-pet-desktop'],
          ['bilibili.svg', '自动刷 B 站', '按分区/关键词抓取视频，生成每日早报与精选摘要。', 'dsh-bilibili'],
          ['douyin.webp', '自动刷抖音', '按兴趣抓取短视频，生成 Markdown 日报。', 'dsh-douyin'],
          ['qq.svg', '接入 QQ', '把 DSH 接入 QQ，支持扫码登录与群聊。', 'dsh-qq'],
        ].map(([icon, title, desc, id]) => `<div class="card plugin-card">
          <img class="plugin-icon" src="/plugin-icons/${icon}" alt="" />
          <div class="plugin-body">
            <div class="store-name" style="text-align:left">${esc(title)}</div>
            <div class="sd plugin-desc">${esc(desc)}</div>
            <div class="plugin-foot"><button class="btn sm" ${id ? `data-dsh="${id}"` : `data-plugin="${esc(title)}"`}>安装</button></div>
          </div>
        </div>`).join('')}
      </div>
      <div class="sd" style="margin-top:8px">这些是 DSH 插件市场的条目；安装请在 DSH 的插件页完成，本工具不改它的插件依赖。</div>
    </div>` : ''}

    ${/deepseek harness/i.test(name) ? `<div class="store-section">
      <div class="store-section-title">DSH 插件市场 <span class="badge">本机缓存</span></div>
      <div class="store-grid" id="dsh-plugins" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))"><div class="sd">加载中…</div></div>
      <div class="sd" style="margin-top:8px">插件来自 DSH 自己的市场缓存；安装请在 DSH 的插件页完成，本工具只读取目录，不改它的依赖与插件图。</div>
    </div>` : ''}

    <div style="margin-top:26px">
      <button class="btn danger" id="desk-uninstall"><svg><use href="#i-trash"/></svg>卸载</button>
      <span class="sd" style="margin-left:10px">跳转 Windows 应用列表卸载，本工具不代劳</span>
    </div>`;

  if (/deepseek harness/i.test(name)) {
    api('/dsh-plugins').then((d) => {
      const box = $('#dsh-plugins');
      if (!box) return;
      box.innerHTML = (d.items || []).slice(0, 12).map((p) => `<div class="store-card" style="align-items:flex-start;text-align:left">
        <div class="store-name" style="text-align:left">${esc(p.label)}</div>
        <div class="store-ver" style="text-align:left">${esc(p.id)}</div>
        <div class="store-desc" style="min-height:auto">v${esc(p.version)}${p.engines ? ' · 需要 DSH ' + esc(p.engines) : ''}</div>
        <div class="sd">在 DSH 插件页安装</div>
      </div>`).join('') || '<div class="sd">没有读取到插件目录</div>';
    }).catch(() => {});
  }

  const dshButtons = $$('[data-dsh]', root);
  if (dshButtons.length) {
    api('/dsh/plugins').then((r) => {
      const map = new Map((r.items || []).map((x) => [x.id, x]));
      dshButtons.forEach((b) => {
        const it = map.get(b.dataset.dsh);
        if (!it) return;
        if (it.installed) {
          b.textContent = '已安装';
          b.title = `${it.package} ${it.dep}${it.configured ? ' · 已配置' : ''}`;
          b.dataset.installed = '1';
        } else if (!it.installable) {
          b.textContent = '在 DSH 安装';
          b.disabled = true;
          b.title = '本工具暂不支持自动安装该插件';
        }
      });
    }).catch(() => {});
    dshButtons.forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.installed === '1') return toast('该插件已安装在 DSH 中');
        const it = { id: b.dataset.dsh };
        if (!confirm('将修改 DSH 插件依赖（先备份，失败自动回滚）。继续？')) return;
        b.disabled = true;
        b.textContent = '安装中…';
        try {
          const r = await api('/dsh/install', { body: { id: it.id } });
          if (r.ok) {
            toast('安装完成，重启 DSH 生效');
            b.textContent = '已安装';
            b.dataset.installed = '1';
          } else {
            toast('安装失败，已回滚', 'err');
            b.textContent = '安装';
          }
        } catch (e) {
          toast(e.message, 'err');
          b.textContent = '安装';
        }
        b.disabled = false;
      };
    });
  }

  $$('[data-plugin]', root).forEach((b) => (b.onclick = () => toast(`${b.dataset.plugin}：请在 DSH 插件页安装`)));

  $('#desk-back')?.addEventListener('click', () => (location.hash = '#/store'));
  $('#desk-update')?.addEventListener('click', () => toast('桌面应用更新请在其客户端内检查'));
  $('#desk-launch')?.addEventListener('click', async () => {
    try {
      await api('/desktop/launch', { body: { exe: app.exe } });
      toast('已启动');
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $('#desk-mcp')?.addEventListener('click', async () => {
    try {
      const r = await api('/mcp/apply', { body: {} });
      toast(`已同步：Claude ${r.result.claude || 0} · Codex ${r.result.codex || 0} · Gemini ${r.result.gemini || 0}`);
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $('#desk-open')?.addEventListener('click', async () => {
    try {
      await api('/desktop/open', { body: { path: app.location } });
      toast('已打开安装目录');
    } catch (e) {
      toast(e.message, 'err');
    }
  });
  $('#desk-manage')?.addEventListener('click', () => { state.app = related; location.hash = '#/providers'; });
  $('#desk-uninstall')?.addEventListener('click', () => toast('请在 Windows「应用和功能」里卸载；本工具不会代删第三方软件'));
  $$('[data-goto]', root).forEach((b) => (b.onclick = () => (location.hash = `#/${b.dataset.goto}`)));
}


async function pageMarket(root, force) {
  await ensureCats();
  const data = state.market && !force ? state.market : (state.market = await api('/marketplace'));
  const all = data.items || [];
  const items = filteredByCat('market', all);
  const installedCount = all.filter((i) => i.installed).length;

  root.innerHTML = `
    ${pageHead('插件市场', '收录公开开源的 MCP 服务器，一键安装到任意 CLI', `<button class="btn" id="mk-manual"><svg><use href="#i-plus"/></svg>手动导入</button><button class="btn" id="mk-github"><svg><use href="#i-github"/></svg>从 GitHub 安装</button><span class="badge blue">${all.length} 个插件</span><span class="badge green">${installedCount} 个已安装</span>`)}
    <div class="notice" style="margin-bottom:14px"><svg><use href="#i-shield"/></svg>
      <div>这里的插件全部来自公开开源仓库（modelcontextprotocol/servers 等），只写入 MCP 配置，不下载闭源安装包、不收集任何数据。</div></div>
    ${catFilterRow('market', all)}
    <div class="store-grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
      ${items
        .map(
          (p) => `<div class="store-card" style="align-items:flex-start;text-align:left">
            <div class="row" style="width:100%;justify-content:space-between">
              <div class="store-name" style="text-align:left">${esc(p.name)}</div>
              ${p.installed ? '<span class="badge green">已安装</span>' : ''}
            </div>
            <div class="store-ver">${(p.tags || []).map((t) => `<span class="badge">${esc(t)}</span>`).join(' ')}</div>
            <div class="store-desc" style="min-height:auto">${esc(p.desc)}</div>
            <div class="list-sub mono truncate" style="width:100%">${esc(p.command)} ${esc((p.args || []).join(' '))}</div>
            <div class="cat-line">${catSelect('market', p.id, p.category)}<span class="cat-tip">${p.categoryManual ? '手动分类' : '自动分类'}</span></div>
            <div class="row" style="width:100%;gap:8px;margin-top:10px">
              <button class="store-btn ${p.installed ? '' : 'primary'}" data-install="${p.id}">${p.installed ? '重新安装/加应用' : '安装'}</button>
            </div>
          </div>`,
        )
        .join('')}
    </div>`;

  $$('[data-install]', root).forEach((b) => (b.onclick = () => openMarketInstall(all.find((i) => i.id === b.dataset.install))));
  $('#mk-manual')?.addEventListener('click', () => openMarketManualImport());
  $('#mk-github')?.addEventListener('click', () => openMarketGithubImport());
  bindCategoryUI(root, () => { state.market = null; return render(true); });
}

function openMarketInstall(item) {
  const apps = ['claude', 'codex', 'gemini', 'qwen'];
  const body = `
    <p class="sd" style="margin:0 0 12px">${esc(item.desc)}</p>
    <div class="field"><label>安装到</label>
      <div class="row" style="gap:14px;flex-wrap:wrap">
        ${apps.map((a) => `<label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" data-mk-app="${a}" ${a === 'claude' || a === 'codex' ? 'checked' : ''} />${esc(APP_LABEL[a] || a)}</label>`).join('')}
      </div>
    </div>
    ${item.requiresDir ? `<div class="field"><label>允许访问的目录</label><input class="input mono" id="mk-dir" placeholder="D:\\work" /></div>` : ''}
    ${item.requiresDb ? `<div class="field"><label>SQLite 文件路径</label><input class="input mono" id="mk-db" placeholder="D:\\data\\app.db" /></div>` : ''}
    ${(item.envKeys || []).map((k) => `<div class="field"><label>${esc(k)}</label><input class="input mono" id="mk-env-${esc(k)}" placeholder="必填" /></div>`).join('')}`;

  openModal({
    title: `安装插件 · ${item.name}`,
    body,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: '确认安装',
        className: 'primary',
        onClick: async (btn) => {
          const picked = $$('[data-mk-app]').filter((x) => x.checked).map((x) => x.dataset.mkApp);
          if (!picked.length) return toast('至少选择一个应用', 'err');
          const env = {};
          for (const k of item.envKeys || []) {
            const v = $(`#mk-env-${k}`)?.value.trim();
            if (v) env[k] = v;
          }
          btn.disabled = true;
          btn.textContent = '安装中…';
          try {
            const r = await api('/marketplace/install', {
              body: { id: item.id, apps: picked, dir: $('#mk-dir')?.value.trim() || '', db: $('#mk-db')?.value.trim() || '', env },
            });
            toast(r.merged ? '已合并到现有 MCP' : `已安装 ${item.name}`);
            state.mcp = null;
            state.market = null;
            closeModal();
            render(true);
          } catch (e) {
            toast(e.message, 'err');
            btn.disabled = false;
            btn.textContent = '确认安装';
          }
        },
      },
    ],
  });
}

const MCP_IMPORT_APPS = ['claude', 'codex', 'gemini', 'qwen'];

function mcpAppChecks() {
  return `<div class="row" style="gap:14px;flex-wrap:wrap">${MCP_IMPORT_APPS.map(
    (a) => `<label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" data-mk-app="${a}" ${a === 'claude' || a === 'codex' ? 'checked' : ''} />${esc(APP_LABEL[a] || a)}</label>`,
  ).join('')}</div>`;
}

function pickedMcpApps() {
  return $$('[data-mk-app]').filter((x) => x.checked).map((x) => x.dataset.mkApp);
}

function openMarketManualImport() {
  let fileName = '';
  const body = `
    <p class="sd" style="margin:0 0 10px;line-height:1.75">
      粘贴 MCP 配置 JSON（Claude Desktop / Cursor 那种 <code>{"mcpServers": {...}}</code> 片段也行），或选一个 .json 文件。
      每条都要有 <code>command</code>；同名项会把应用合并进去，不会覆盖原配置。
    </p>
    <div class="field"><label>配置 JSON</label>
      <textarea class="textarea mono" id="mk-json" style="min-height:200px" placeholder='{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "" } }
  }
}'></textarea>
    </div>
    <div class="row" style="gap:8px;align-items:center;margin-bottom:10px">
      <button class="btn" id="mk-pick"><svg><use href="#i-download"/></svg>选择 JSON 文件</button>
      <span id="mk-file" class="sd">未选择文件</span>
    </div>
    <input id="mk-file-input" type="file" accept=".json,.txt,application/json,text/plain" style="display:none" />
    <div class="field"><label>安装到</label>${mcpAppChecks()}</div>
    <div id="mk-detected" class="sd"></div>`;

  openModal({
    title: '手动导入 MCP',
    body,
    wide: true,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: '导入',
        className: 'primary',
        onClick: async (btn) => {
          const config = $('#mk-json')?.value.trim() || '';
          if (!config) return toast('请先粘贴或选择配置', 'err');
          const apps = pickedMcpApps();
          if (!apps.length) return toast('至少选择一个应用', 'err');
          btn.disabled = true;
          btn.textContent = '导入中…';
          try {
            const r = await api('/mcp/import-config', { body: { config, apps } });
            const parts = [];
            if (r.imported?.length) parts.push(`导入 ${r.imported.length} 个`);
            if (r.merged?.length) parts.push(`合并 ${r.merged.length} 个`);
            if (r.skipped?.length) parts.push(`跳过 ${r.skipped.length} 个`);
            toast(parts.join(' · ') || '没有可导入的条目', r.imported?.length || r.merged?.length ? 'ok' : 'err');
            state.mcp = null;
            closeModal();
            render(true);
          } catch (e) {
            toast(e.message, 'err');
            btn.disabled = false;
            btn.textContent = '导入';
          }
        },
      },
    ],
  });

  const preview = () => {
    const box = $('#mk-detected');
    const text = $('#mk-json')?.value.trim() || '';
    if (!text) {
      if (box) box.textContent = '';
      return;
    }
    try {
      const data = JSON.parse(text);
      const map = data?.mcpServers || data?.servers || (data?.command || data?.cmd ? { [data?.name || '（未命名）']: data } : data);
      const names = Array.isArray(map)
        ? map.map((x) => x?.name).filter(Boolean)
        : Object.entries(map || {})
            .filter(([, v]) => v && typeof v === 'object' && (v.command || v.cmd))
            .map(([k]) => k);
      if (box) box.innerHTML = names.length ? `识别到 ${names.length} 条：${names.map((n) => esc(n)).join('、')}` : '<span style="color:var(--red)">没找到带 command 的条目</span>';
    } catch (err) {
      if (box) box.innerHTML = `<span style="color:var(--red)">JSON 解析失败：${esc(String(err.message || err))}</span>`;
    }
  };
  $('#mk-json')?.addEventListener('input', preview);
  const input = $('#mk-file-input');
  $('#mk-pick')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    fileName = file.name;
    const label = $('#mk-file');
    if (label) label.textContent = `${fileName}（${(file.size / 1024).toFixed(1)} KB）`;
    const text = await file.text();
    const area = $('#mk-json');
    if (area) area.value = text;
    preview();
  });
}

function openMarketGithubImport() {
  const body = `
    <p class="sd" style="margin:0 0 10px;line-height:1.75">
      填 GitHub 仓库地址（<code>owner/repo</code> 或完整链接）。会读取仓库信息、README 里的 MCP 配置和 package.json，
      自动给出可编辑的启动命令；确认后再写入所选 CLI 的 MCP 配置。不会把仓库代码下载到本机。
    </p>
    <div class="field"><label>仓库</label>
      <div class="row" style="gap:8px">
        <input class="input mono" id="gh-repo" placeholder="modelcontextprotocol/servers" style="flex:1" />
        <button class="btn" id="gh-probe">读取</button>
      </div>
    </div>
    <div id="gh-result" class="sd">还没有读取仓库</div>
    <div id="gh-form" style="display:none;margin-top:12px">
      <div class="field"><label>名称</label><input class="input mono" id="gh-name" /></div>
      <div class="field"><label>命令</label><input class="input mono" id="gh-command" /></div>
      <div class="field"><label>参数（每行一个）</label><textarea class="textarea mono" id="gh-args" style="min-height:80px"></textarea></div>
      <div class="field"><label>安装到</label>${mcpAppChecks()}</div>
    </div>`;

  openModal({
    title: '从 GitHub 安装 MCP',
    body,
    wide: true,
    actions: [
      { label: '取消', onClick: closeModal },
      {
        label: '安装',
        className: 'primary',
        onClick: async (btn) => {
          const name = $('#gh-name')?.value.trim();
          const command = $('#gh-command')?.value.trim();
          if (!name) return toast('请填写名称', 'err');
          if (!command) return toast('请填写命令', 'err');
          const args = ($('#gh-args')?.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
          const apps = pickedMcpApps();
          if (!apps.length) return toast('至少选择一个应用', 'err');
          btn.disabled = true;
          btn.textContent = '安装中…';
          try {
            const r = await api('/mcp/import-config', { body: { config: { mcpServers: { [name]: { command, args } } }, apps } });
            toast(r.merged?.length ? `已合并到现有 MCP：${name}` : `已安装 ${name}`);
            state.mcp = null;
            closeModal();
            render(true);
          } catch (e) {
            toast(e.message, 'err');
            btn.disabled = false;
            btn.textContent = '安装';
          }
        },
      },
    ],
  });

  const probe = async () => {
    const repo = $('#gh-repo')?.value.trim();
    const box = $('#gh-result');
    if (!repo) return toast('请填写仓库地址', 'err');
    if (box) box.innerHTML = '<div class="skeleton" style="height:40px"></div>';
    try {
      const r = await api('/github/probe', { body: { repo } });
      const info = r.repo;
      if (box) {
        box.innerHTML = `<div><b>${esc(info.full)}</b>${info.archived ? ' <span class="badge">已归档</span>' : ''}</div>
          <div style="margin-top:4px">${esc(info.description || '（没有描述）')}</div>
          <div style="margin-top:4px">★ ${info.stars} · 分支 ${esc(info.branch)}${info.language ? ` · ${esc(info.language)}` : ''}</div>
          <div style="margin-top:6px">${
            r.candidate
              ? `已从${r.source === 'readme' ? ' README' : ' package.json'}识别出启动命令，可直接安装或修改。`
              : '仓库里没找到现成的 MCP 配置，请手动填写命令（例如 npx -y <包名>）。'
          }</div>
          ${r.warn ? `<div style="margin-top:6px;color:var(--amber)">${esc(r.warn)}</div>` : ''}`;
      }
      $('#gh-form').style.display = 'block';
      const c = r.candidate || {};
      $('#gh-name').value = c.name || info.name;
      $('#gh-command').value = c.command || 'npx';
      $('#gh-args').value = (c.args || []).join('\n');
    } catch (e) {
      if (box) box.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`;
    }
  };
  $('#gh-probe')?.addEventListener('click', probe);
  $('#gh-repo')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') probe();
  });
}


/* ---------------- 启动引导 ---------------- */
$('#btn-menu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('#global-menu')?.classList.toggle('show');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#global-menu') && !e.target.closest('#btn-menu')) $('#global-menu')?.classList.remove('show');
});
$$('#global-menu [data-gm]').forEach((b) => {
  b.onclick = async () => {
    const m = b.dataset.gm;
    $('#global-menu')?.classList.remove('show');
    if (m === 'settings') location.hash = '#/settings';
    else if (m === 'update') toast(`当前版本 v${state.overview?.version || '1.0.0'} · 自动更新尚未接入`);
    else if (m !== 'diag') location.hash = `#/${m}`;
    if (m === 'diag') {
      await exportDiagnostics(null);
    }
  };
});

window.addEventListener('hashchange', route);

(async function init() {
  try {
    const s = await api('/settings');
    state.settings = s;
    applyTheme(s.theme);
    state.lang = s.language === 'en' ? 'en' : 'zh';
    setUiLang(state.lang);
  } catch {}
  route();
})();

