const { app, BrowserWindow, shell, Menu, Tray, nativeImage, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const UI_DIR = path.join(ROOT, 'app', 'ui');
const APP_SCHEME = 'app';
const APP_HOST = 'xunlong';

// Must run before app.whenReady(). A standard, secure scheme gives the UI a
// normal origin (app://xunlong) and allows fetch('/api/...') from the renderer.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

app.setAppUserModelId('cn.xunlong.aimanager');
app.setName('迅龙AI管家');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

const STARTUP_LOG = path.join(app.getPath('userData'), 'startup.log');

function startupLog(...parts) {
  try {
    fs.appendFileSync(STARTUP_LOG, `${new Date().toISOString()} ${parts.join(' ')}\n`);
  } catch {
    /* 日志失败不影响主流程 */
  }
}

process.on('uncaughtException', (err) => startupLog('uncaughtException', err?.stack || String(err)));
process.on('unhandledRejection', (err) => startupLog('unhandledRejection', err?.stack || String(err)));
startupLog('main start', process.execPath, process.argv.join(' '));

// app://xunlong 直接读本地文件并走进程内 API，UI 不依赖本机监听的 TCP 端口。
// （本机安全软件可能拦截未放行的程序访问 127.0.0.1，走自定义协议就没有这个问题。）
function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS },
  });
}

function textResponse(status, text, contentType = 'text/plain; charset=utf-8') {
  return new Response(text, { status, headers: { 'content-type': contentType, ...SECURITY_HEADERS } });
}

function isInsideDir(parent, child) {
  const rel = path.relative(parent, child);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

async function handleAppRequest(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return textResponse(400, 'bad request');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname || '/');
  } catch {
    return textResponse(400, 'bad request');
  }

  if (pathname.startsWith('/api/')) {
    if (!dispatchApi) return jsonResponse(503, { error: '服务尚未就绪' });
    const method = String(request.method || 'GET').toUpperCase();
    let body = {};
    if (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
      const raw = await request.text();
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          return jsonResponse(400, { error: '请求体不是合法的 JSON' });
        }
      }
    }
    try {
      const result = await dispatchApi(method, pathname + url.search, body);
      return jsonResponse(200, result ?? { ok: true });
    } catch (err) {
      const status = err?.status || 500;
      return jsonResponse(status, { error: String(err?.message || err) });
    }
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse(405, 'method not allowed');

  const rel = pathname.replace(/^[/\\]+/, '') || 'index.html';
  const file = path.resolve(UI_DIR, rel);
  if (!isInsideDir(UI_DIR, file) || path.basename(file).startsWith('.')) return textResponse(403, 'forbidden');

  try {
    const buf = await fs.promises.readFile(file);
    return new Response(request.method === 'HEAD' ? null : buf, {
      status: 200,
      headers: { 'content-type': mimeFor(file), 'cache-control': 'no-store', ...SECURITY_HEADERS },
    });
  } catch {
    if (path.extname(rel)) return textResponse(404, 'not found');
    try {
      const html = await fs.promises.readFile(path.join(UI_DIR, 'index.html'));
      return new Response(html, {
        status: 200,
        headers: { 'content-type': MIME['.html'], ...SECURITY_HEADERS },
      });
    } catch {
      return textResponse(404, 'not found');
    }
  }
}

function registerAppProtocol() {
  if (appProtocolReady) return;
  protocol.handle(APP_SCHEME, handleAppRequest);
  appProtocolReady = true;
  startupLog('app protocol registered');
}

let win = null;
let tray = null;
let startServer = null;
let dispatchApi = null;
let appPort = null;
let quitting = false;
let appProtocolReady = false;
let readSettings = () => ({});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

function iconPath() {
  return path.join(ROOT, 'build', 'icon.png');
}

async function createWindow({ silent = null } = {}) {
  startupLog('createWindow start');
  if (!startServer) {
    const mod = await import('../server.mjs');
    startServer = mod.startServer;
    dispatchApi = mod.dispatchApi;
    startupLog('server module imported');
  }
  // UI 优先走 app://，本机端口只留给外部浏览器/工具使用
  registerAppProtocol();
  if (!appPort) {
    startupLog('startServer begin');
    const started = await startServer({ port: Number(process.env.XUNLONG_PORT) || 0 });
    appPort = started.port;
    startupLog('startServer done', appPort);
  }
  const port = appPort;
  const store = await import('../core/store.mjs');
  readSettings = () => store.getState().settings || {};
  const hideOnStart = silent === null ? Boolean(readSettings().silentStart) : silent;
  startupLog('store imported', `hideOnStart=${hideOnStart}`);

  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#ffffff',
    title: '迅龙AI管家',
    show: false,
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  startupLog('BrowserWindow created');
  Menu.setApplicationMenu(null);
  const uiUrl = `${APP_SCHEME}://${APP_HOST}/`;
  startupLog('loadURL begin', uiUrl);
  win.loadURL(uiUrl).then(
    () => startupLog('loadURL resolved', uiUrl),
    (err) => startupLog('loadURL rejected', err?.message || String(err)),
  );
  win.webContents.on('did-start-loading', () => startupLog('did-start-loading'));
  win.webContents.on('dom-ready', () => startupLog('dom-ready'));
  win.webContents.on('did-finish-load', () => startupLog('did-finish-load', win?.webContents.getURL()));
  let httpFallbackTried = false;
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    startupLog('did-fail-load', code, desc, url);
    // app:// 万一不可用，退回本机端口（受安全软件放行情况影响）
    if (!httpFallbackTried && String(url || '').startsWith(`${APP_SCHEME}://`)) {
      httpFallbackTried = true;
      startupLog('loadURL fallback http', port);
      win?.loadURL(`http://127.0.0.1:${port}`).catch((err) => startupLog('fallback failed', err?.message));
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => startupLog('render-process-gone', JSON.stringify(details)));
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) startupLog('console', level, message, `${sourceId}:${line}`);
  });
  win.once('ready-to-show', () => {
    startupLog('ready-to-show');
    if (!hideOnStart || !tray) win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      const allowed = new Set([`${APP_SCHEME}://${APP_HOST}`, `http://127.0.0.1:${port}`]);
      if (!allowed.has(target.origin)) {
        event.preventDefault();
        if (/^https?:/i.test(url)) shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  win.on('close', (event) => {
    if (!quitting && readSettings().closeToTray !== false && tray) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    win = null;
  });

  try {
    const img = nativeImage.createFromPath(iconPath());
    if (!img.isEmpty()) {
      tray = new Tray(img.resize({ width: 16, height: 16 }));
      tray.setToolTip('迅龙AI管家');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: '打开面板',
            click: () => {
              if (win) {
                win.show();
                win.focus();
              } else {
                createWindow({ silent: false });
              }
            },
          },
          { label: `本地端口：${port}`, enabled: false },
          { type: 'separator' },
          {
            label: '退出',
            click: () => {
              quitting = true;
              app.quit();
            },
          },
        ]),
      );
      tray.on('double-click', () => {
        if (win) {
          win.show();
          win.focus();
        }
      });
    }
  } catch {
    /* 托盘失败不影响主流程 */
  }
}

app.whenReady().then(() => {
  startupLog('app ready');
  return createWindow();
}).catch((err) => startupLog('createWindow failed', err?.stack || String(err)));

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow({ silent: false });
});
