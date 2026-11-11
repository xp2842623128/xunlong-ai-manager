# 打包资源

| 文件 | 用途 |
| --- | --- |
| `icon.png` | 512×512 主图标，窗口、任务栏和托盘使用 |
| `icon.ico` | Windows exe 文件图标，包含 16/24/32/48/64/128/256 多尺寸 |
| `make-icon.ps1` | 从 `icon.png` 重新生成 `icon.ico` |
| `rcedit.exe` | 打包时把图标和版本信息写入 exe |
| `pack.mjs` | 复制 Electron 运行时、应用与图标，生成 `dist/迅龙AI管家-win32-x64/` |

## 重新生成 exe 图标

改动 `icon.png` 后执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build\make-icon.ps1
npm.cmd run pack
```

`pack.mjs` 会调用 `rcedit.exe`，写入 `icon.ico`，并把产品名、文件版本、公司名等属性改成迅龙AI管家。打包前请先退出正在运行的 `迅龙AI管家.exe`，否则 Windows 会锁定文件。

## rcedit 来源

`rcedit.exe` 为 [electron/rcedit](https://github.com/electron/rcedit) v2.0.0 的官方 x64 构建，MIT License。它只在本机打包阶段运行，不随应用启动，也不会联网。
