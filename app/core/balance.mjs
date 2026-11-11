import { CLI } from './paths.mjs';

const TIMEOUT = 15000;

async function getJson(url, headers) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers, signal: c.signal, redirect: 'error' });
    const text = await res.text();
    if (text.length > 1024 * 1024) throw new Error('余额接口返回内容过大');
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { ok: res.ok, status: res.status, data, text };
  } finally {
    clearTimeout(t);
  }
}

/**
 * 查询供应商余额 / 额度。
 * 仅使用官方公开接口，Key 只在本地内存中使用，不上传任何服务器。
 */
export async function queryBalance(provider) {
  const base = (provider.baseUrl || '').replace(/\/+$/, '');
  const key = provider.apiKey || '';
  const auth = { Authorization: `Bearer ${key}` };
  let host = '';
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    host = '';
  }
  const hostMatches = (domain) => host === domain || host.endsWith(`.${domain}`);
  const checkedAt = new Date().toISOString();

  // 自定义 / 关闭用量查询
  if (provider.usageQuery) {
    if (provider.usageQuery.mode === 'off') {
      return { ok: false, provider: provider.name, message: '该供应商已关闭用量查询。', checkedAt };
    }
    if (provider.usageQuery.mode === 'custom' && provider.usageQuery.url) {
      let customUrl;
      try {
        customUrl = new URL(provider.usageQuery.url);
      } catch {
        return { ok: false, provider: provider.name, message: '自定义余额查询 URL 无效。', checkedAt };
      }
      if (customUrl.protocol !== 'https:') {
        return { ok: false, provider: provider.name, message: '自定义余额查询只允许 HTTPS，避免 Key 明文外发。', checkedAt };
      }
      const headers = { Authorization: `Bearer ${key}` };
      try {
        const extra = JSON.parse(provider.usageQuery.headers || '{}');
        Object.assign(headers, extra);
      } catch {}
      const r = await getJson(customUrl.toString(), headers);
      if (!r.ok) return fail(r, checkedAt);
      const path = String(provider.usageQuery.path || '').split('.').filter(Boolean);
      let v = r.data;
      for (const k of path) v = v?.[k];
      const num = Number(v);
      return {
        ok: Number.isFinite(num),
        provider: provider.name,
        balance: Number.isFinite(num) ? num : 0,
        currency: provider.usageQuery.currency || 'CNY',
        detail: r.data,
        message: Number.isFinite(num) ? '' : '未能从返回内容中取到数值，请检查字段路径',
        checkedAt,
      };
    }
  }
  try {
    if (hostMatches('deepseek.com')) {
      const r = await getJson('https://api.deepseek.com/user/balance', auth);
      if (!r.ok) return fail(r, checkedAt);
      const info = r.data?.balance_infos?.[0] || {};
      return {
        ok: true,
        provider: provider.name,
        balance: Number(info.total_balance ?? 0),
        currency: info.currency || 'CNY',
        available: r.data?.is_available !== false,
        detail: r.data?.balance_infos || [],
        checkedAt,
      };
    }

    if (hostMatches('siliconflow.cn')) {
      const r = await getJson('https://api.siliconflow.cn/v1/user/info', auth);
      if (!r.ok) return fail(r, checkedAt);
      const d = r.data?.data || r.data || {};
      const bal = d.totalBalance ?? d.balance ?? d.chargeBalance;
      return {
        ok: true,
        provider: provider.name,
        balance: Number(bal ?? 0),
        currency: 'CNY',
        available: true,
        detail: d,
        checkedAt,
      };
    }

    if (hostMatches('openrouter.ai')) {
      const r = await getJson('https://openrouter.ai/api/v1/credits', auth);
      if (!r.ok) return fail(r, checkedAt);
      const d = r.data?.data || {};
      const remain = Number(d.total_credits ?? 0) - Number(d.total_usage ?? 0);
      return {
        ok: true,
        provider: provider.name,
        balance: remain,
        currency: 'USD',
        available: remain > 0,
        detail: d,
        checkedAt,
      };
    }

    if (hostMatches('novita.ai')) {
      const r = await getJson('https://api.novita.ai/v3/user/balance', auth);
      if (!r.ok) return fail(r, checkedAt);
      return {
        ok: true,
        provider: provider.name,
        balance: Number(r.data?.availableBalance ?? 0),
        currency: 'USD',
        available: Number(r.data?.availableBalance ?? 0) > 0,
        detail: r.data,
        checkedAt,
      };
    }

    if (hostMatches('moonshot.cn') || hostMatches('moonshot.ai')) {
      const r = await getJson('https://api.moonshot.cn/v1/users/me/balance', auth);
      if (!r.ok) return fail(r, checkedAt);
      const d = r.data?.data || {};
      return {
        ok: true,
        provider: provider.name,
        balance: Number(d.available_balance ?? 0),
        currency: 'CNY',
        available: Number(d.available_balance ?? 0) > 0,
        detail: d,
        checkedAt,
      };
    }

    if (hostMatches('stepfun.com')) {
      const r = await getJson('https://api.stepfun.com/v1/accounts', auth);
      if (!r.ok) return fail(r, checkedAt);
      const d = r.data?.data || r.data || {};
      return {
        ok: true,
        provider: provider.name,
        balance: Number(d.balance ?? d.available_balance ?? 0),
        currency: 'CNY',
        available: true,
        detail: d,
        checkedAt,
      };
    }

    return {
      ok: false,
      provider: provider.name,
      message: '该供应商未提供公开余额查询接口，请到官网控制台查看。',
      checkedAt,
    };
  } catch (err) {
    return {
      ok: false,
      provider: provider.name,
      message: `查询失败：${err.message || err}`,
      checkedAt,
    };
  }
}

function fail(r, checkedAt) {
  return {
    ok: false,
    status: r.status,
    message:
      r.status === 401
        ? 'Key 无效或已过期（401）'
        : r.status === 403
          ? '无权限查询余额（403）'
          : `接口返回 HTTP ${r.status}`,
    checkedAt,
  };
}

export function appLabel(app) {
  return CLI[app]?.label || app;
}
