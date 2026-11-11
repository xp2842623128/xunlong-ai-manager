# 品牌与图标资产

| 文件 | 用途 |
| --- | --- |
| `logo.svg` | 矢量标志源文件（龙首 + 闪电） |
| `logo.png` | 主标志位图 |
| `logo-card.png` | 1200×1200 品牌卡，用于商店/宣传图 |
| `logo-600.png` | 600×600 方形品牌图 |
| `logo-source.jpg` | 标志设计源图 |
| `dragons/` | 早期龙形图标探索稿（SVG） |

应用窗口、任务栏和托盘使用 `build/icon.png`；`build/icon.ico` 是写入 exe 的多尺寸文件图标（16–256 px，由 `build/make-icon.ps1` 生成）；`app/ui/logo.png` 是界面内使用的小尺寸标志。

## 来源与许可

- `dragons/dragon-head.svg` 来自 [game-icons.net](https://game-icons.net/) 的 `dragon-head`，按 **CC BY 3.0** 使用并在此标注来源。
- 其余龙形 SVG 为同一设计方向的探索稿，随本项目代码一起提供。
- 第三方产品名称与商标归各自权利人；本项目不使用原软件的图标或素材。
