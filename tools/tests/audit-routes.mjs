/**
 * 静态一致性检查：前端调用的 /api 路径是否有后端路由。
 * 运行：node tools/tests/audit-routes.mjs
 */
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../../app/ui/app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../../app/server.mjs', import.meta.url), 'utf8');

const calls = new Set();
for (const m of ui.matchAll(/\bapi\(\s*[`'"]([^`'"]+)[`'"]/g)) {
  const raw = m[1];
  if (!raw.startsWith('/') || raw.includes('${')) continue;
  calls.add(`/api${raw.split('?')[0].replace(/\$\{[^}]+\}/g, ':id')}`);
}

const routes = new Set();
for (const m of server.matchAll(/^\s*'((?:GET|POST|PUT|DELETE))\s+([^']+)'/gm)) {
  routes.add(`${m[1]} ${m[2].replace(/\\\//g, '/')}`);
}

const routePaths = new Set([...routes].map((r) => r.split(' ')[1]));
const missing = [...calls].filter((c) => {
  const normalized = c.replace(/\/:id/g, '/:id');
  if (routePaths.has(normalized)) return false;
  return ![...routePaths].some((r) => {
    const a = r.split('/').filter(Boolean);
    const b = normalized.split('/').filter(Boolean);
    return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
  });
});
console.log('前端 API 调用：', calls.size);
console.log('后端路由：', routes.size);
console.log(missing.length ? `未匹配：\n${missing.join('\n')}` : '未匹配：无');
