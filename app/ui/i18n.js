/* 界面文案中英切换：以中文原文为键，渲染后按文本节点整段替换（只作用于英文模式）。
   只覆盖界面文案；应用名、供应商名、路径、用户数据保持原样。 */

const CJK = /[\u4e00-\u9fa5]/;

let current = 'zh';

export function uiLang() {
  return current;
}

export function setUiLang(lang) {
  current = lang === 'en' ? 'en' : 'zh';
  document.documentElement.lang = current === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.lang = current;
}

const DICT = {
  // ---------- 导航 / 品牌 ----------
  '迅龙AI管家': 'Xunlong AI Manager',
  '免费': 'Free',
  '标题': 'Title',
  'Token（入/出）': 'Tokens (in/out)',
  '界面文案支持简体中文与英文': 'Interface text is available in Simplified Chinese and English',
  '本地网关': 'Local gateway',
  '一键配置': 'Auto-configure',
  '复制副本': 'Copy',
  '启用应用': 'Enable apps',
  '全部应用': 'All apps',
  '全部状态': 'All statuses',
  '全部供应商': 'All providers',
  '扫描中…': 'Scanning…',
  '扫描中...': 'Scanning...',
  '保存在本机，不会上传': 'Stored on this machine, never uploaded',
  '通用功能': 'GENERAL',
  '工作台': 'Workspace',
  'AI 商店': 'AI Store',
  '模型管理': 'Models',
  '插件市场': 'Plugins',
  '提示词': 'Prompts',
  '会话': 'Sessions',
  'Token 用量': 'Token Usage',
  '本地聚合网关': 'Local Gateway',
  'AI 通用加速': 'AI Accelerator',
  '我的应用': 'MY APPS',
  '本地优先 · Key 只存在本机': 'Local-first · keys never leave this machine',
  '· MIT · 无账号无会员': '· MIT · no account, no subscription',
  '界面语言': 'Language',
  '界面语言、外观主题、启动与窗口、数据迁移': 'Language, appearance, launch & window, data migration',
  '当前版本仅提供简体中文': 'Simplified Chinese is the default UI language',
  '中文': 'Chinese',
  '英文': 'English',
  '浅色': 'Light',
  '深色': 'Dark',
  '跟随系统': 'System',
  '外观': 'Appearance',
  '外观主题': 'Theme',
  '深色适合夜间使用；「跟随系统」会随 Windows 深浅色自动切换': 'Dark suits low light; System follows the Windows light/dark setting',
  '启动与窗口': 'Launch & window',
  '开机自启': 'Launch at startup',
  '静默启动': 'Start minimized',
  '启动时不显示主窗口，可从托盘打开': 'Do not show the main window on launch; open it from the tray',
  '关闭时最小化到托盘': 'Minimize to tray on close',
  '数据迁移': 'Data migration',
  '从 CC-Switch 导入': 'Import from CC-Switch',
  '把 CC-Switch（~/.cc-switch）的供应商一次性导入；CC-Switch 数据只读，不会被修改。': 'Import all providers from CC-Switch (~/.cc-switch) at once. CC-Switch data is read-only and never modified.',
  '本机扫描': 'Local scan',
  '重新扫描本机': 'Rescan this machine',
  '重新检测 AI 应用与现有配置': 'Detect AI apps and existing configs again',
  '开始扫描': 'Start scan',
  '重新扫描': 'Rescan',
  '扫描本机': 'Scan machine',
  '扫描本机配置': 'Scan local configs',
  '扫描本机 AI 应用': 'Scan local AI apps',
  '扫描本机已安装的 AI 应用': 'Scan installed AI apps on this machine',
  '扫描本机 AI 应用': 'Scan local AI apps',
  '本机扫描': 'Local scan',
  '本机配置': 'Local config',
  '已安装的 CLI': 'Installed CLIs',
  '桌面 AI 应用': 'Desktop AI apps',
  '桌面应用': 'Desktop apps',
  '桌面应用只做识别，不纳入配置管理。': 'Desktop apps are detection only and are not managed here.',
  '通用': 'General',
  '应用配置': 'App config',
  '本地路由': 'Routing',
  '网络': 'Network',
  '数据': 'Data',
  '关于': 'About',
  '版本信息': 'Version',
  '设置': 'Settings',
  '返回应用': 'Back to app',
  '返回 AI 商店': 'Back to AI Store',
  '字段': 'Field',

  // ---------- 仪表盘 ----------
  '供应商': 'Providers',
  '今日请求': 'Requests today',
  '今日 Tokens': 'Tokens today',
  '聚合网关': 'Gateway',
  '运行中': 'Running',
  '未启动': 'Stopped',
  '已停止': 'Stopped',
  '点击右侧启动': 'Start it on the right',
  '查看明细': 'Details',
  'CLI 状态': 'CLI status',
  '近 7 天请求趋势': 'Requests · last 7 days',
  '仅统计经过本地网关的请求': 'Only requests routed through the local gateway',
  '请求数 · 按天': 'Requests · by day',
  '请求数': 'Requests',
  '最近请求': 'Recent requests',
  '最近请求日志': 'Recent request log',
  '还没有请求记录。启动网关后，把 CLI 指向本地网关即可统计。': 'No requests yet. Start the gateway and point your CLI at it to collect stats.',
  '暂无数据': 'No data',
  '，这里会出现趋势。': ', a trend will appear here.',
  '还没有请求记录。启动网关并把 CLI 指向本地网关后，这里会出现趋势。': 'No requests yet. Start the gateway and point your CLIs at it; the trend will appear here.',
  '三步开始': 'Three steps to start',
  '全程本地，无需注册账号': 'All local, no account required',
  '第 1 步': 'Step 1',
  '第 2 步': 'Step 2',
  '第 3 步': 'Step 3',
  '添加供应商': 'Add provider',
  '从 75 个官方预设里选一个，填入你自己的 API Key。': 'Pick one of 75 official presets and enter your own API key.',
  '一键切换': 'One-click switch',
  '自动写入 Claude Code / Codex / Gemini / Qwen / Kimi 等 CLI 配置，并保留备份。': 'Writes configs for Claude Code / Codex / Gemini / Qwen / Kimi with automatic backups.',
  '启动网关': 'Start gateway',
  '本地聚合多供应商，自动故障转移，统计每一次调用。': 'Aggregate multiple providers locally with automatic failover and per-call stats.',
  '添加第一个供应商': 'Add your first provider',
  '扫描本机已安装的 AI 应用': 'Scan installed AI apps',

  // ---------- 商家 / 商店 ----------
  '浏览、配置和管理本机 AI 智能体': 'Browse, configure and manage local AI agents',
  '浏览、配置和管理本机 AI 智能体 · 安装请使用各应用官方安装包': 'Browse, configure and manage local AI agents · install via each app official installer',
  'AI 智能体': 'AI agents',
  '推荐': 'Recommended',
  '工具箱': 'Toolbox',
  '工具': 'Tools',
  '备份恢复': 'Backup & restore',
  '管理模型': 'Manage models',
  '导入现有配置': 'Import configs',
  '暂无默认供应商': 'No default provider',
  '添加后即可一键切换': 'Add one to enable one-click switching',
  '支持 75 个官方预设，也可以填任意兼容端点': '75 official presets, or any compatible endpoint',
  '从现有配置一键导入，Key 只保存在本机。': 'Import existing configs in one click; keys stay on this machine.',
  '本机配置': 'Local configs',
  '已安装': 'Installed',
  '可导入': 'Importable',
  '已配置': 'Configured',
  '仅识别': 'Detect only',
  '未检测到': 'Not detected',
  '未配置': 'Not configured',
  '只读': 'Read-only',
  '查看': 'View',
  '查看配置': 'View config',
  '配置': 'Configure',
  '安装': 'Install',
  '应用': 'Apply',
  '应用到 CLI': 'Apply to CLI',
  '官方': 'Official',
  '社区': 'Community',
  '仅配置文件': 'Config only',
  '有配置': 'Configured',
  '个 CLI 已安装': ' CLIs installed',
  '个桌面 AI 应用。': ' desktop AI apps.',
  '份可导入配置、': ' importable configs, ',
  '个 CLI、': ' CLIs, ',
  '检测完成：': 'Scan complete: ',
  '检测到但暂不支持写入：': 'Detected but not writable: ',
  '扫描只读本机文件，不会修改任何配置。': 'Scanning only reads local files; nothing is modified.',
  '自动识别本机已有配置并导入。': 'Detect and import existing configs automatically.',
  '未找到该应用': 'App not found',
  '该应用为只读识别：可以读取当前配置和导入记录，但不会写回应用配置。': 'This app is detect-only: current config and records can be read, but nothing is written back.',
  '还没有配置供应商（该应用使用账号登录，无 API 供应商配置）': 'No providers configured (this app uses account sign-in, so there are no API providers)',
  '还没有配置供应商': 'No providers configured yet',
  '还没有供应商': 'No providers yet',
  '移除该应用的供应商记录': 'Remove this app provider records',
  '只删除本工具保存的记录，不会修改 Claude Desktop 的实际配置文件。': 'Only deletes records saved by this tool; the actual Claude Desktop config is untouched.',
  '只删除本工具保存的记录，不会修改 Claude Code 的实际配置文件。': 'Only deletes records saved by this tool; the actual Claude Code config is untouched.',
  '危险操作': 'Danger zone',
  '当前模型配置': 'Current model config',
  '从这里切换只影响本应用，不改其它 CLI。': 'Switching here only affects this app, not other CLIs.',
  '浏览该应用的历史会话与调用记录。': 'Browse this app session history and calls.',
  '管理 ↗': 'Manage ↗',
  '使用教程 ↗': 'Guide ↗',

  // ---------- 模型管理 ----------
  '添加你的 API Key，一键切换 CLI 配置': 'Add your API keys and switch CLI configs in one click',
  '管理各 AI 工具的供应商：切换、新增、编辑、复制与故障转移': 'Manage providers per tool: switch, add, edit, copy and failover',
  '搜索供应商…': 'Search providers…',
  '搜索供应商...': 'Search providers...',
  '新增供应商': 'Add provider',
  '全部供应商': 'All providers',
  '使用中': 'In use',
  '未启用': 'Disabled',
  '从预设添加': 'Add from preset',
  '从预设添加，或扫描本机已有配置。': 'Add from a preset, or scan existing local configs.',
  '搜索供应商…': 'Search providers…',
  '还没有 Claude Code 供应商': 'No Claude Code providers yet',
  '还没有供应商': 'No providers yet',
  '命名': 'Name',
  '名称': 'Name',
  '协议': 'Protocol',
  '接入地址': 'Base URL',
  '模型': 'Model',
  '分组（可选）': 'Group (optional)',
  '备注（可选）': 'Note (optional)',
  '如：国内 / 公司 / 备用': 'e.g. China / Work / Backup',
  '例如 DeepSeek': 'e.g. DeepSeek',
  '保存': 'Save',
  '取消': 'Cancel',
  '删除': 'Delete',
  '编辑': 'Edit',
  '复制': 'Copy',
  '复制路径': 'Copy path',
  '刷新': 'Refresh',
  '搜索': 'Search',
  '排序': 'Sort',
  '按时间': 'By time',
  '按项目': 'By project',
  '状态': 'Status',
  '时间': 'Time',
  '输入': 'Input',
  '输出': 'Output',
  '成本': 'Cost',
  '速度': 'Latency',
  '缓存命中': 'Cache hit',
  '成功': 'OK',
  '失败': 'Failed',
  '测试连接': 'Test connection',
  '保存中…': 'Saving…',
  '已保存': 'Saved',
  '删除中…': 'Deleting…',
  '复制失败，请手动选择': 'Copy failed, select it manually',
  '已复制': 'Copied',
  'Anthropic 兼容（Claude Code）': 'Anthropic compatible (Claude Code)',
  'OpenAI 兼容（Codex / OpenCode / 任意 SDK）': 'OpenAI compatible (Codex / OpenCode / any SDK)',
  'Anthropic 协议填到域名根即可，OpenAI 协议通常以 /v1 结尾。': 'For Anthropic use the domain root; OpenAI usually ends with /v1.',
  '勾选后可在 Claude Code 的模型选择器中使用': 'Check to make it selectable in Claude Code model picker',
  '勾选后可在 Claude Desktop 的模型选择器中使用': 'Check to make it selectable in Claude Desktop model picker',
  '勾选后写入供应商列表；Key 仍只存本机': 'Checked entries are written to the provider list; keys stay local',
  '可导入的现有配置': 'Importable existing configs',

  // ---------- 应用描述（适配器） ----------
  'Anthropic 官方 CLI 编程代理': 'Anthropic official CLI coding agent',
  'OpenAI 官方 CLI 编程代理': 'OpenAI official CLI coding agent',
  'Google Gemini 命令行代理': 'Google Gemini command-line agent',
  '通义千问命令行编程代理': 'Qwen command-line coding agent',
  '开源终端 AI 编程代理': 'Open source terminal AI coding agent',
  'xAI Grok 构建代理': 'xAI Grok build agent',
  'Oh My Pi 终端代理': 'Oh My Pi terminal agent',
  '可扩展的终端 AI 编程代理': 'Extensible terminal AI coding agent',
  '月之暗面 Kimi Code CLI，配置写入 ~/.kimi-code/config.toml': 'Moonshot Kimi Code CLI; config goes to ~/.kimi-code/config.toml',
  'DeepSeek Harness 桌面智能体，配置写入 cordis.patch.yml': 'DeepSeek Harness desktop agent; config goes to cordis.patch.yml',
  'Claude 桌面客户端，账号登录，只读取安装与配置信息': 'Claude desktop app; sign-in based, only reads install and config info',
  'OpenClaw 多模型终端代理，只读取现有 provider 配置': 'OpenClaw multi-model terminal agent; only reads existing provider config',
  'Nous Research Hermes Agent，只读取现有 provider 配置': 'Nous Research Hermes Agent; only reads existing provider config',
  'MiniMax Code 桌面/终端代理，只读取现有 provider 配置': 'MiniMax Code desktop/terminal agent; only reads existing provider config',
  'ANTHROPIC · Anthropic 官方 CLI 编程代理': 'ANTHROPIC · Anthropic official CLI coding agent',
  'ANTHROPIC · Claude 桌面客户端，账号登录，只读取安装与配置信息': 'ANTHROPIC · Claude desktop app, sign-in based, read-only detection',

  // ---------- MCP ----------
  'MCP 服务器': 'MCP servers',
  '统一管理 MCP 服务器，并同步到 Claude / Codex / Gemini / Qwen': 'Manage MCP servers centrally and sync to Claude / Codex / Gemini / Qwen',
  '添加 MCP': 'Add MCP',
  '添加后勾选要启用的应用，即会同步写入对应 CLI 配置。': 'After adding, check the apps to enable; their CLI configs are written automatically.',
  '检查连通性': 'Check connectivity',
  '从应用导入': 'Import from app',
  '应用到 CLI': 'Apply to CLI',
  '搜索名称、命令或地址': 'Search name, command or URL',
  '还没有 MCP 服务器': 'No MCP servers yet',
  '直接改应用配置里的同名项会被覆盖': 'Editing the same entry directly in app config will be overwritten',
  '该应用暂不支持写入 MCP': 'This app does not support writing MCP',
  '把「MCP」页启用的服务器写入本应用配置。': 'Write servers enabled on the MCP page into this app config.',
  '还没有配置供应商': 'No providers configured yet',
  '官方示例服务器，用来验证 MCP 链路是否打通。': 'Official sample server for verifying the MCP link.',
  '抓取网页并转成 Markdown，适合让模型读文档。': 'Fetch a page and convert it to Markdown so the model can read docs.',
  '持久化记忆：把偏好与事实存进知识图谱。': 'Persistent memory: store preferences and facts in a knowledge graph.',
  '查询本地 SQLite 数据库，支持只读模式。': 'Query a local SQLite database, read-only supported.',
  '浏览器自动化：截图、点击、抓取动态页面。': 'Browser automation: screenshots, clicks, dynamic pages.',
  '让模型读写本机指定目录的文件，最常用的基础能力。': 'Let the model read and write files in a chosen local directory.',
  '让模型查看提交历史、diff、分支状态。': 'Let the model inspect commit history, diffs and branch state.',
  '读写仓库、Issue、PR，需要 GitHub Token。': 'Read and write repos, issues and PRs; needs a GitHub token.',
  '读取频道消息、发送消息，需要 Bot Token。': 'Read and send channel messages; needs a bot token.',
  '网页与本地搜索，需要 Brave API Key。': 'Web and local search; needs a Brave API key.',
  '时区换算与当前时间，避免模型算错日期。': 'Time zone conversion and current time so the model gets dates right.',
  '结构化推理草稿，复杂任务拆解更稳。': 'Structured reasoning scratchpad for steadier task decomposition.',
  '收录公开开源的 MCP 服务器，一键安装到任意 CLI': 'Public open-source MCP servers, installable to any CLI',
  '这里的插件全部来自公开开源仓库（modelcontextprotocol/servers 等），只写入 MCP 配置，不下载闭源安装包、不收集任何数据。': 'Every plugin here comes from public open-source repos (modelcontextprotocol/servers etc). Only MCP config is written; no closed-source installers, no data collection.',
  '同步全部': 'Sync all',
  '立即同步': 'Sync now',

  // ---------- Skills ----------
  '一份技能，链接到多个 AI 工具': 'One skill, linked to multiple AI tools',
  '已安装的 Skills': 'Installed skills',
  '添加 Skill': 'Add skill',
  '从 ZIP 导入': 'Import from ZIP',
  '从发现里安装，或者导入本机已有的 Skill。': 'Install from Discover, or import an existing local skill.',
  '还没有 Skill': 'No skills yet',
  '去发现': 'Discover',
  '导入本机已有': 'Import local',
  '同步': 'Sync',
  '测试': 'Test',
  '重': 'Write',
  '写': 'Write',
  '技': 'Skill',

  // ---------- 提示词 ----------
  '沉淀常用指令，一键复制到任意 CLI': 'Keep your best prompts and copy them to any CLI',
  '全部提示词': 'All prompts',
  '添加提示词': 'Add prompt',
  '搜索标题、目录、首条消息或会话 ID': 'Search title, directory, first message or session ID',
  '代码': 'Code',
  '代码审查': 'Code review',
  '重构': 'Refactor',
  '重构计划': 'Refactor plan',
  '写测试': 'Write tests',
  'Bug 定位': 'Bug hunt',
  '技术方案对比': 'Tech comparison',
  '协作': 'Collaboration',
  '推理': 'Reasoning',
  '质量': 'Quality',
  '架构': 'Architecture',
  '调试': 'Debug',
  '测试': 'Test',

  // ---------- 会话 / 用量 ----------
  '浏览本机 CLI 的历史会话': 'Browse local CLI session history',
  '会话与用量': 'Sessions & usage',
  '会话详情': 'Session detail',
  '会话日志': 'Session log',
  '网关 + 会话日志': 'Gateway + session logs',
  '按天、按供应商、按模型统计请求与 Token': 'Requests and tokens by day, provider and model',
  '估算成本': 'Est. cost',
  '总请求数': 'Total requests',
  '计费 Tokens': 'Billed tokens',
  '缓存占输入比': 'Cache share of input',
  '趋势': 'Trend',
  '用量': 'Usage',
  '用量统计': 'Usage stats',
  '查看用量': 'View usage',
  '上一页': 'Prev',
  '下一页': 'Next',
  '模型': 'Model',

  // ---------- 网关 / 加速 ----------
  'OpenAI / Anthropic 兼容入口，自动故障转移': 'OpenAI / Anthropic compatible entry point with failover',
  '端口': 'Port',
  '打开网关': 'Open gateway',
  '网关状态': 'Gateway status',
  '在供应商处把 Base URL 指向这里、Key 随便填，即可让所有请求走本机网关，并自动故障转移。': 'Point a provider Base URL here with any key and every request routes through the local gateway with failover.',
  '按顺序尝试，失败或 429/5xx 时自动切到下一个': 'Tries in order and falls back on failure or 429/5xx',
  '故障转移顺序': 'Failover order',
  '未启动，可用于故障转移。': 'Stopped; available as failover.',
  '仅监听 127.0.0.1，不对公网开放': 'Listens on 127.0.0.1 only, never public',
  '镜像加速': 'Mirror acceleration',
  '镜像换源、测速与还原：不改网络出口，只换更快的源': 'Mirror switching, latency test and restore: same network path, faster source',
  '镜像测速': 'Mirror speed test',
  '下载加速地址': 'Download mirror',
  '全部测速': 'Test all',
  '一键换源': 'Switch mirrors',
  '换源': 'Switch',
  '还原': 'Restore',
  '未设置（使用官方源）': 'Not set (official source)',
  '点击右上角「全部测速」': 'Click Test all in the top right',
  '先测速，再换源；换源后重新打开终端生效': 'Test first, then switch; reopen the terminal to apply',
  '会依次请求各镜像的探测地址，只测连通与延迟': 'Probes each mirror endpoint in turn; connectivity and latency only',
  '在 GitHub 地址前加前缀': 'Prefixes GitHub URLs',
  '替换 huggingface.co': 'Replaces huggingface.co',
  '本页只修改 npm / pip / Docker 的下载源，': 'This page only changes npm / pip / Docker download sources, ',
  '不建立隧道、不修改系统代理、不绕过网络管控': 'No tunnels, no system proxy changes, no bypassing network controls',
  '国内镜像': 'China mirrors',
  'GitHub 下载': 'GitHub downloads',
  '国内源': 'China mirror',
  '备份': 'Backup',
  '备份与配置目录': 'Backup & config folders',
  '全选': 'Select all',
  '导入提示词（TXT）': 'Import prompts (TXT)',
  '选择 TXT 文件': 'Choose a TXT file',
  '标签（可选，逗号分隔）': 'Tags (optional, comma separated)',
  '还没有选择文件': 'No file chosen yet',
  '请先选择 TXT 文件': 'Choose a TXT file first',
  '文件里没有可用内容': 'No usable content in this file',
  '导入': 'Import',
  '删除选中': 'Delete selected',
  '一键清除': 'Clear all',
  '立即备份': 'Back up now',
  '备份保留数量': 'Backups to keep',
  '自动备份间隔': 'Auto backup interval',
  '备份文件包含本机配置中的 API Key，请只存放在本机并注意磁盘权限。':
    'Backups contain API keys from this machine. Keep them local and watch the folder permissions.',
  '切换前自动备份': 'Auto backup before switching',
  '导出诊断包': 'Export diagnostics',
  '问题反馈': 'Feedback',
  '本应用不上传任何数据；遇到问题就点右侧导出诊断包，把文件自己发给维护者':
    'Nothing is uploaded anywhere. Export a diagnostics file and send it to the maintainer yourself.',
  '免费声明': 'Free to use',
  '无账号、无会员、无积分、无次数限制': 'No account, no subscription, no credits, no usage cap',
  '全部免费': 'All free',
  '还原': 'Restore',

  // ---------- 通用状态 / 动作 ----------
  '加载中…': 'Loading…',
  '加载失败：': 'Failed to load: ',
  '继续': 'Continue',
  '继续优化': 'Keep optimizing',
  '关闭': 'Close',
  '确定': 'OK',
  '导入选中': 'Import selected',
  '移除': 'Remove',
  '添加': 'Add',
  '管理': 'Manage',
  '文档': 'Docs',
  '菜单': 'Menu',
  '账号': 'Account',
  '浏览器': 'Browser',
  '数据库': 'Database',
  '文件': 'File',
  '网页': 'Web',
  '记忆': 'Memory',
  '归档': 'Archive',
  '展开': 'Expand',
  '收起': 'Collapse',
  '全部': 'All',
  '个': '',
  '条': '',
  '代': '',
  '刚刚': 'just now',
  '暂无': 'None',
  '—': '—',
  '现在': 'now',
  '自定义供应商': 'Custom provider',
  '默认模型': 'Default model',
  '北京月之暗面科技有限公司': 'Moonshot AI',
  '接口': 'API',
  '密钥': 'Key',
  '字段': 'Field',
  '凭证': 'Credentials',
  '启用': 'Enable',
  '停用': 'Disable',
  '保存并应用': 'Save & apply',
  '保存并切换': 'Save & switch',
  '检测中…': 'Scanning…',
  '识别中…': 'Detecting…',
  '同步中…': 'Syncing…',
  '测速中…': 'Testing…',
  '导入中…': 'Importing…',
  '切换中…': 'Switching…',
  '删除这条记录？': 'Delete this record?',
  '确认删除': 'Confirm delete',
  '此操作不可撤销': 'This cannot be undone',
  '已写入': 'Written',
  '写入成功': 'Written',
  '写入失败': 'Write failed',
  '已备份到': 'Backed up to',
  '无权限': 'Permission denied',
};

/* 数字 / 时间等动态文案 */
const RULES = [
  [/^共 (\d+) 条：$/, (m) => `${m[1]} found:`],
  [/^已导入 (\d+) 条提示词$/, (m) => `Imported ${m[1]} ${m[1] === '1' ? 'prompt' : 'prompts'}`],
  [/^已选 (\d+) \/ (\d+) 项$/, (m) => `${m[1]} of ${m[2]} selected`],
  [/^已删除 (\d+) 个备份$/, (m) => `Deleted ${m[1]} ${m[1] === '1' ? 'backup' : 'backups'}`],
  [/^已清除 (\d+) 个备份$/, (m) => `Cleared ${m[1]} ${m[1] === '1' ? 'backup' : 'backups'}`],
  [/^诊断包已保存到「(.+)」$/, (m) => `Diagnostics saved to ${m[1]}`],
  [/^(\d+) 个 MCP$/, (m) => `${m[1]} MCP`],
  [/^(\d+) 个供应商$/, (m) => `${m[1]} ${m[1] === '1' ? 'provider' : 'providers'}`],
  [/^(\d+) 个供应商 · (\d+) 个模型$/, (m) => `${m[1]} provider · ${m[2]} models`],
  [/^(\d+) 个已安装$/, (m) => `${m[1]} installed`],
  [/^(\d+) 个服务器$/, (m) => `${m[1]} ${m[1] === '1' ? 'server' : 'servers'}`],
  [/^(\d+) 个会话 · (.+)$/, (m) => `${m[1]} ${m[1] === '1' ? 'session' : 'sessions'} · ${translateText(m[2]) || m[2]}`],
  [/^(\d+) 个插件$/, (m) => `${m[1]} plugins`],
  [/^(\d+) 个 CLI 已安装$/, (m) => `${m[1]} CLIs installed`],
  [/^(\d+) 个可用$/, (m) => `${m[1]} available`],
  [/^(\d+) 个预设可选$/, (m) => `${m[1]} presets available`],
  [/^(\d+) 项可选$/, (m) => `${m[1]} selectable`],
  [/^(\d+) 条 · (.+)$/, (m) => `${m[1]} · ${m[2]}`],
  [/^(\d+) 条$/, (m) => `${m[1]}`],
  [/^(\d+) 个$/, (m) => `${m[1]}`],
  [/^近 7 天 (.*) 次$/, (m) => `${m[1]} requests in 7 days`],
  [/^输入 (.*) \/ 输出 (.*)$/, (m) => `In ${m[1]} / Out ${m[2]}`],
  [/^移除 (\d+) 条记录$/, (m) => `Remove ${m[1]} records`],
  [/^全部 (\d+)$/, (m) => `All ${m[1]}`],
  [/^已安装 (\d+)$/, (m) => `Installed ${m[1]}`],
  [/^发现 (\d+)$/, (m) => `Discover ${m[1]}`],
  [/^导入本机已有 \((\d+)\)$/, (m) => `Import local (${m[1]})`],
  [/^全部提示词 (\d+)$/, (m) => `All prompts ${m[1]}`],
  [/^第 (\d+) \/ (\d+) 页$/, (m) => `Page ${m[1]} / ${m[2]}`],
  [/^(\d+) 分钟前$/, (m) => `${m[1]} min ago`],
  [/^(\d+) 小时前$/, (m) => `${m[1]} h ago`],
  [/^(\d+) 天前$/, (m) => `${m[1]} d ago`],
  [/^(.+) · 复制副本$/, (m) => `${m[1]} · Copy`],
  [/^(\d+) · (\d+) (分钟|小时|天)前$/, (m) => `${m[1]} · ${rel(m[2], m[3])}`],
  [/^近 (\d+) 天( ▾)?$/, (m) => `Last ${m[1]} days${m[2] || ''}`],
  [/^(\d+) 天$/, (m) => `${m[1]} d`],
];

function rel(n, unit) {
  const suffix = { 分钟: 'min', 小时: 'h', 天: 'd' }[unit] || '';
  return `${n} ${suffix} ago`;
}

function translateText(text) {
  if (!text || !CJK.test(text)) return null;
  if (Object.prototype.hasOwnProperty.call(DICT, text)) return DICT[text];
  for (const [re, fn] of RULES) {
    const m = text.match(re);
    if (m) return fn(m);
  }
  return null;
}

/** 翻译一段即将插入 DOM 的短文案（toast 等），未命中则原样返回。 */
export function t(text) {
  if (current !== 'en' || !text) return text;
  let out = text;
  for (let i = 0; i < 3; i++) {
    const hit = translateText(out.trim());
    if (!hit || hit === out) break;
    out = out.replace(out.trim(), hit);
  }
  return out;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT', 'SVG']);

/* 记住被替换前的原文，切回中文时逐字还原（静态文案不会随 render 重建） */
const origText = new WeakMap();
const origAttr = new WeakMap();
let origTitle = null;

export function restoreI18n(root = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const before = origText.get(n);
    if (before != null && n.nodeValue !== before) n.nodeValue = before;
  }
  for (const el of root.querySelectorAll('[placeholder], [title], [aria-label]')) {
    const saved = origAttr.get(el);
    if (!saved) continue;
    for (const attr of Object.keys(saved)) {
      if (el.getAttribute(attr) !== saved[attr]) el.setAttribute(attr, saved[attr]);
    }
  }
  if (origTitle && document.title !== origTitle) document.title = origTitle;
  if (root === document.body) origTitle = null;
}

export function applyI18n(root = document.body) {
  if (current !== 'en' || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[data-i18n-skip]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    const raw = node.nodeValue;
    if (!CJK.test(raw)) continue;
    let hit = translateText(raw.trim());
    // 动态串可能嵌套（如「13 sessions · 54 分钟前」），多翻一层
    for (let i = 0; i < 3 && hit && CJK.test(hit); i++) {
      const again = translateText(hit);
      if (!again || again === hit) break;
      hit = again;
    }
    if (hit == null) continue;
    if (!origText.has(node)) origText.set(node, raw);
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.match(/\s*$/)[0];
    node.nodeValue = lead + hit + trail;
  }
  const attrRoot = root === document.body ? document : root;
  for (const el of attrRoot.querySelectorAll('[placeholder], [title], [aria-label]')) {
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute(attr);
      if (!v || !CJK.test(v)) continue;
      const hit = translateText(v.trim());
      if (hit != null) {
        const saved = origAttr.get(el) || {};
        if (!(attr in saved)) saved[attr] = v;
        origAttr.set(el, saved);
        el.setAttribute(attr, hit);
      }
    }
  }
  if (root === document.body && CJK.test(document.title)) {
    const hit = translateText(document.title) || DICT[document.title];
    if (hit) {
      if (origTitle == null) origTitle = document.title;
      document.title = hit;
    }
  }
}
