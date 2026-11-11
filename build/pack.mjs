import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(ROOT, 'dist');
const TARGET = path.join(DIST_ROOT, '迅龙AI管家-win32-x64');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');

function copyDir(src, dest, skip = []) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(ELECTRON_DIST)) {
  console.error('未找到 Electron 运行时，请先执行 pnpm install 并下载 Electron。');
  process.exit(1);
}

if (fs.existsSync(TARGET)) fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

// 1. Electron 运行时
copyDir(ELECTRON_DIST, TARGET, ['resources']);

// 2. resources/app
const APP_OUT = path.join(TARGET, 'resources', 'app');
fs.mkdirSync(APP_OUT, { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const runtimePkg = {
  name: pkg.name,
  productName: pkg.productName,
  version: pkg.version,
  description: pkg.description,
  type: 'module',
  main: 'app/electron/main.cjs',
};
fs.writeFileSync(path.join(APP_OUT, 'package.json'), JSON.stringify(runtimePkg, null, 2));

copyDir(path.join(ROOT, 'app'), path.join(APP_OUT, 'app'), ['node_modules']);

// 3. 图标
const icon = path.join(ROOT, 'build', 'icon.png');
if (fs.existsSync(icon)) {
  fs.mkdirSync(path.join(APP_OUT, 'build'), { recursive: true });
  fs.copyFileSync(icon, path.join(APP_OUT, 'build', 'icon.png'));
}

// 4. 重命名可执行文件
const exeSrc = path.join(TARGET, 'electron.exe');
const exeDest = path.join(TARGET, '迅龙AI管家.exe');
if (fs.existsSync(exeSrc)) fs.renameSync(exeSrc, exeDest);

// 5. exe 图标与文件属性（Electron 运行时默认是原子图标）
const rcedit = path.join(ROOT, 'build', 'rcedit.exe');
const ico = path.join(ROOT, 'build', 'icon.ico');
if (!fs.existsSync(rcedit)) {
  console.error('未找到 build/rcedit.exe，无法替换 exe 图标。');
  process.exit(1);
}
if (!fs.existsSync(ico)) {
  console.error('未找到 build/icon.ico，无法替换 exe 图标。');
  process.exit(1);
}
const productVersion = String(pkg.version || '1.1.0');
const fileVersion = /^\d+(?:\.\d+){3}$/.test(productVersion) ? productVersion : `${productVersion}.0`;
const patch = spawnSync(
  rcedit,
  [
    exeDest,
    '--set-icon', ico,
    '--set-file-version', fileVersion,
    '--set-product-version', productVersion,
    '--set-version-string', 'FileDescription', '迅龙AI管家',
    '--set-version-string', 'ProductName', '迅龙AI管家',
    '--set-version-string', 'CompanyName', '迅龙AI管家',
    '--set-version-string', 'LegalCopyright', 'Copyright © 2026 迅龙AI管家',
    '--set-version-string', 'OriginalFilename', '迅龙AI管家.exe',
    '--set-version-string', 'InternalName', 'xunlong-ai-manager',
  ],
  { windowsHide: true, stdio: 'inherit' },
);
if (patch.error) {
  console.error('调用 rcedit 失败：', patch.error.message);
  process.exit(1);
}
if (patch.status !== 0) {
  console.error('rcedit 写入 exe 图标/版本信息失败，退出码：', patch.status);
  process.exit(patch.status || 1);
}

// 6. 使用说明
const readme = `迅龙AI管家 v${pkg.version}

启动：双击「迅龙AI管家.exe」
数据目录：%APPDATA%\\XunlongAIManager
本地面板：启动后自动打开，端口见数据目录下的 runtime.json

无账号、无会员、无积分、无任何付费墙。
`;
fs.writeFileSync(path.join(TARGET, '使用说明.txt'), readme, 'utf8');

console.log('打包完成：', exeDest);
console.log('大小：', (fs.statSync(exeDest).size / 1024 / 1024).toFixed(1), 'MB');
