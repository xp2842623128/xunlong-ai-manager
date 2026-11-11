# 测试工具

所有测试都在临时 HOME / 夹具目录中运行，不读取或修改真实用户配置。

```powershell
npm test
# 或单独运行
node tools\tests\test-app-adapters.mjs
node tools\tests\test-mcp.mjs
node tools\tests\test-backup.mjs
node tools\tests\audit-routes.mjs
```

| 脚本 | 覆盖内容 |
| --- | --- |
| `tests/test-app-adapters.mjs` | Kimi / Codex / Grok / DSH / OMP 写入、Kimi 托管块替换、4 个只读应用探测 |
| `tests/test-mcp.mjs` | Codex 顶层键保留、同名表不重复、跨应用不误删、停用清理 |
| `tests/test-backup.mjs` | 自动 `.bak` 恢复、多 CLI 备份、恢复现场不重名 |
| `tests/audit-routes.mjs` | 前端 API 调用与后端路由的静态一致性 |

测试不会写入 `%APPDATA%\XunlongAIManager`；若需要手工排查，测试输出会给出临时目录路径。
