import http from 'node:http';
import { Readable, Transform } from 'node:stream';
import { getState } from './store.mjs';
import { record } from './usage.mjs';

const MAX_BODY = 16 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function requestTimeout() {
  const value = Number(getState().settings.requestTimeout);
  return Number.isFinite(value) ? Math.max(5000, Math.min(600000, value)) : 120000;
}

function shouldLog() {
  const state = getState();
  return state.settings.logRequests !== false && state.gateway.logRequests !== false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function extractUsage(json) {
  const u = json?.usage || {};
  return {
    input: Number(u.input_tokens ?? u.prompt_tokens ?? 0),
    output: Number(u.output_tokens ?? u.completion_tokens ?? 0),
  };
}

/** 从 SSE 流里尽量提取 usage */
class UsageTap extends Transform {
  constructor() {
    super();
    this.tail = '';
    this.input = 0;
    this.output = 0;
  }
  _transform(chunk, enc, cb) {
    const text = this.tail + chunk.toString('utf8');
    this._scanText(text);
    this.tail = text.slice(-16000);
    cb(null, chunk);
  }
  _flush(cb) {
    this._scanText(this.tail);
    cb();
  }
  _scanText(text) {
    for (const m of text.matchAll(/"(input_tokens|prompt_tokens)"\s*:\s*(\d+)/g)) {
      this.input = Math.max(this.input, Number(m[2]));
    }
    for (const m of text.matchAll(/"(output_tokens|completion_tokens)"\s*:\s*(\d+)/g)) {
      this.output = Math.max(this.output, Number(m[2]));
    }
  }
}

export class Gateway {
  constructor() {
    this.server = null;
    this.port = null;
    this.startedAt = null;
    this.counter = { requests: 0, errors: 0 };
  }

  status() {
    return {
      running: Boolean(this.server),
      port: this.port,
      startedAt: this.startedAt,
      requests: this.counter.requests,
      errors: this.counter.errors,
      endpoints: this.server
        ? {
            openai: `http://127.0.0.1:${this.port}/v1`,
            anthropic: `http://127.0.0.1:${this.port}`,
            health: `http://127.0.0.1:${this.port}/health`,
          }
        : null,
    };
  }

  candidates(protocol) {
    const state = getState();
    const enabled = state.providers.filter((p) => p.enabled !== false);
    const order = state.gateway.order || [];
    const rank = (p) => {
      const i = order.indexOf(p.id);
      return i === -1 ? 999 : i;
    };
    return enabled
      .filter((p) => p.protocol === protocol && p.baseUrl)
      .sort((a, b) => rank(a) - rank(b) || new Date(a.createdAt) - new Date(b.createdAt));
  }

  async start(port) {
    await this.stop();
    const listenPort = Number(port) || getState().settings.gatewayPort || 8317;
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        this.counter.errors += 1;
        if (!res.headersSent) {
          res.writeHead(err.status || 500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: { message: String(err.message || err), type: 'gateway_error' } }));
        } else {
          try {
            res.end();
          } catch {}
        }
      });
    });
    this.server = server;
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, '127.0.0.1', resolve);
      });
    } catch (err) {
      this.server = null;
      try { server.close(); } catch {}
      throw err;
    }
    this.port = server.address().port;
    this.startedAt = new Date().toISOString();
    return this.status();
  }

  async stop() {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    this.port = null;
    this.startedAt = null;
    try { s.closeAllConnections?.(); } catch {}
    await new Promise((resolve) => s.close(resolve));
  }

  async handle(req, res) {
    const origin = req.headers.origin;
    if (origin) {
      if (!isLocalOrigin(origin)) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: '只接受本机来源的浏览器请求', type: 'forbidden' } }));
        return;
      }
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
    }
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, ...this.status() }));
      return;
    }

    if (url.pathname === '/v1/models' && req.method === 'GET') {
      const state = getState();
      const seen = new Set();
      const data = [];
      for (const p of state.providers) {
        if (p.enabled === false) continue;
        for (const m of p.models?.length ? p.models : [p.model].filter(Boolean)) {
          if (seen.has(m)) continue;
          seen.add(m);
          data.push({ id: m, object: 'model', owned_by: p.name });
        }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ object: 'list', data }));
      return;
    }

    const isAnthropic = url.pathname.startsWith('/v1/messages');
    const isOpenAI = url.pathname.startsWith('/v1/chat/completions') || url.pathname.startsWith('/v1/responses');
    if (!isAnthropic && !isOpenAI) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: '未知路由，支持 /v1/messages、/v1/chat/completions、/v1/responses', type: 'not_found' } }));
      return;
    }

    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_BODY) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: '请求体过大（上限 16MB）', type: 'payload_too_large' } }));
      return;
    }
    const raw = await readBody(req);
    let body = {};
    try {
      body = JSON.parse(raw.toString('utf8') || '{}');
    } catch {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: '请求体不是合法 JSON', type: 'invalid_request' } }));
      return;
    }

    const protocol = isAnthropic ? 'anthropic' : 'openai';
    const stream = Boolean(body.stream);
    const list = this.candidates(protocol);

    if (!list.length) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: `没有可用的 ${protocol} 供应商，请先在「供应商」页面添加并启用，再在「网关」中排序。`,
            type: 'no_provider',
          },
        }),
      );
      return;
    }

    const started = Date.now();
    let lastError = null;
    const retryCount = Math.max(0, Math.min(10, Number(getState().settings.retryCount) || 0));
    const attempts = list.slice(0, Math.max(1, Math.min(list.length, retryCount + 1)));

    for (const provider of attempts) {
      const payload = { ...body };
      if (provider.forceModel && provider.model) payload.model = provider.model;

      try {
        const result = await this.forward(provider, url.pathname + url.search, payload, stream, req, res, protocol);
        if (result.committed) {
          this.counter.requests += 1;
          return;
        }
        if (result.ok) {
          this.counter.requests += 1;
          const usage = extractUsage(result.data);
          if (shouldLog()) {
            try {
              record({
                providerId: provider.id,
                providerName: provider.name,
                app: provider.app,
                model: payload.model || provider.model || '',
                input: usage.input,
                output: usage.output,
                latency: Date.now() - started,
                status: result.status,
                stream: false,
                source: 'gateway',
              });
            } catch (err) {
              console.error('[gateway] 写入用量失败：', err.message);
            }
          }
          return;
        }
        lastError = result;
        const status = Number(result.status) || 0;
        const requestError = status === 400 || status === 413 || status === 422;
        if (requestError) break;
      } catch (err) {
        lastError = { status: 0, message: String(err.message || err) };
      }
    }

    this.counter.errors += 1;
    const status = lastError?.status && lastError.status >= 400 ? lastError.status : 502;
    if (shouldLog()) {
      try {
        record({
          providerId: attempts[0]?.id,
          providerName: attempts[0]?.name || '',
          app: attempts[0]?.app || '',
          model: body.model || '',
          input: 0,
          output: 0,
          latency: Date.now() - started,
          status,
          stream,
          source: 'gateway',
          error: lastError?.message || lastError?.text || 'upstream_error',
        });
      } catch (err) {
        console.error('[gateway] 写入用量失败：', err.message);
      }
    }
    if (!res.headersSent) {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: [lastError?.message, lastError?.text].filter(Boolean).join(' · ').slice(0, 800) || '所有供应商均不可用',
            type: 'upstream_error',
            attempts: attempts.length,
          },
        }),
      );
    }
  }

  async forward(provider, pathname, payload, stream, req, res, protocol) {
    const base = provider.baseUrl.replace(/\/+$/, '');
    const baseHasV1 = /\/v1$/i.test(base);
    let upstreamPath;
    if (pathname.startsWith('/v1/messages')) {
      upstreamPath = baseHasV1 ? '/messages' : '/v1/messages';
    } else if (pathname.startsWith('/v1/chat/completions')) {
      upstreamPath = baseHasV1 ? '/chat/completions' : '/v1/chat/completions';
    } else if (pathname.startsWith('/v1/responses')) {
      upstreamPath = baseHasV1 ? '/responses' : '/v1/responses';
    } else {
      upstreamPath = pathname;
    }
    const url = base + upstreamPath + (pathname.includes('?') ? pathname.slice(pathname.indexOf('?')) : '');
    const headers = {
      'content-type': 'application/json',
      accept: stream ? 'text/event-stream' : 'application/json',
    };
    if (protocol === 'anthropic') {
      headers['x-api-key'] = provider.apiKey || '';
      headers['anthropic-version'] = req.headers['anthropic-version'] || '2023-06-01';
      if (req.headers['anthropic-beta']) headers['anthropic-beta'] = req.headers['anthropic-beta'];
      headers.authorization = `Bearer ${provider.apiKey || ''}`;
    } else {
      headers.authorization = `Bearer ${provider.apiKey || ''}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), stream ? 600000 : requestTimeout());

    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        return { ok: false, status: upstream.status, text: text.slice(0, 2000), message: `HTTP ${upstream.status}` };
      }

      if (stream && upstream.body) {
        const streamStart = Date.now();
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const tap = new UsageTap();
        const source = Readable.fromWeb(upstream.body);
        let ended = false;
        const finish = () => {
          if (ended) return;
          ended = true;
          clearTimeout(timeout);
          if (shouldLog()) {
            try {
              record({
                providerId: provider.id,
                providerName: provider.name,
                app: provider.app,
                model: payload.model || provider.model || '',
                input: tap.input,
                output: tap.output,
                latency: Date.now() - streamStart,
                status: 200,
                stream: true,
                source: 'gateway',
              });
            } catch (err) {
              console.error('[gateway] 写入用量失败：', err.message);
            }
          }
        };
        const abort = () => {
          if (ended) return;
          ended = true;
          clearTimeout(timeout);
          this.counter.errors += 1;
          try { source.destroy(); } catch {}
          try { tap.destroy(); } catch {}
          try { controller.abort(); } catch {}
        };
        res.once('close', () => {
          if (!res.writableEnded) abort();
        });
        res.once('error', abort);
        source.on('error', abort);
        tap.on('error', abort);
        tap.on('end', finish);
        source.pipe(tap).pipe(res);
        return { ok: true, committed: true };
      }

      const data = await upstream.json();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
      return { ok: true, status: 200, data };
    } finally {
      if (!stream) clearTimeout(timeout);
    }
  }
}

export const gateway = new Gateway();
