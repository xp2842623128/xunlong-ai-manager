import crypto from 'node:crypto';
import fs from 'node:fs';
import { FILES, ensureDirs, readJson, writeJsonAtomic } from './paths.mjs';

const uid = (prefix = 'p') => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

export function defaultState() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    providers: [],
    settings: {
      theme: 'light',
      language: 'zh',
      gatewayPort: 8317,
      autoStart: false,
      silentStart: false,
      closeToTray: true,
      trayStyle: 'quick',
      defaultTerminal: 'Windows Terminal',
      balanceDisplay: 'remain',
      autoStartGateway: false,
      requestTimeout: 120000,
      retryCount: 2,
      backupInterval: '24 小时',
      backupKeep: 20,
      logRequests: true,
      maskKeys: true,
      proxy: '',
      telemetry: false,
    },
    gateway: {
      strategy: 'priority',
      order: [],
      routeByProtocol: true,
      logRequests: true,
    },
    mcpServers: [],
    prompts: [],
    skills: [],
    meta: {
      lastBackup: null,
      installedAt: new Date().toISOString(),
      edition: 'free',
    },
  };
}

let cache = null;

export function getState() {
  if (cache) return cache;
  ensureDirs();
  const exists = fs.existsSync(FILES.config);
  const loaded = readJson(FILES.config, null);
  const base = defaultState();
  if (!loaded || typeof loaded !== 'object') {
    if (exists) {
      try {
        fs.renameSync(FILES.config, `${FILES.config}.corrupt-${Date.now()}`);
      } catch {}
    }
    cache = base;
    saveState();
    return cache;
  }
  cache = {
    ...base,
    ...loaded,
    settings: {
      ...base.settings,
      ...(loaded.settings && typeof loaded.settings === 'object' && !Array.isArray(loaded.settings) ? loaded.settings : {}),
    },
    gateway: {
      ...base.gateway,
      ...(loaded.gateway && typeof loaded.gateway === 'object' && !Array.isArray(loaded.gateway) ? loaded.gateway : {}),
    },
    meta: { ...base.meta, ...(loaded.meta && typeof loaded.meta === 'object' && !Array.isArray(loaded.meta) ? loaded.meta : {}) },
    providers: Array.isArray(loaded.providers)
      ? loaded.providers.filter((p) => p && typeof p === 'object').map((p) => (p.id ? p : { ...p, id: uid('prov') }))
      : [],
    mcpServers: Array.isArray(loaded.mcpServers) ? loaded.mcpServers.filter((p) => p && typeof p === 'object') : [],
    prompts: Array.isArray(loaded.prompts) ? loaded.prompts.filter((p) => p && typeof p === 'object') : [],
    skills: Array.isArray(loaded.skills) ? loaded.skills : [],
  };
  return cache;
}

export function reloadState() {
  cache = null;
  return getState();
}

export function saveState(next) {
  if (next) cache = next;
  if (!cache) return;
  writeJsonAtomic(FILES.config, cache);
}

export function mutate(fn) {
  const state = getState();
  const result = fn(state);
  saveState(state);
  return result;
}

export function newProvider(patch = {}) {
  const now = new Date().toISOString();
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, activatedAt: _activatedAt, ...safePatch } = patch || {};
  return {
    id: uid('prov'),
    name: '未命名供应商',
    app: 'claude',
    protocol: 'anthropic',
    group: '',
    baseUrl: '',
    apiKey: '',
    model: '',
    models: [],
    website: '',
    keyUrl: '',
    note: '',
    presetId: null,
    enabled: true,
    ...safePatch,
    createdAt: now,
    updatedAt: now,
  };
}

export function findProvider(id) {
  return getState().providers.find((p) => p.id === id) || null;
}

export function listProviders(app) {
  const list = getState().providers;
  return (app ? list.filter((p) => p.app === app) : list).map(publicProvider);
}

/** 返回给前端时默认遮罩密钥，避免明文暴露在界面 */
export function publicProvider(p, { reveal = false } = {}) {
  const key = typeof p.apiKey === 'string' ? p.apiKey : p.apiKey == null ? '' : String(p.apiKey);
  let masked = key;
  if (!reveal && key) {
    masked = key.length < 16 ? `••••${key.slice(-2)}` : `${key.slice(0, 4)}${'•'.repeat(Math.max(6, Math.min(18, key.length - 8)))}${key.slice(-4)}`;
  }
  return { ...p, apiKey: masked, hasKey: Boolean(key), keyTail: key ? key.slice(-4) : '' };
}

export function uidFor(prefix) {
  return uid(prefix);
}

