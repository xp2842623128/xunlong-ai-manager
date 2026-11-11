import { getState, mutate, uidFor } from './store.mjs';

const SEEDS = [
  {
    title: '代码审查',
    tags: ['代码', '质量'],
    content:
      '请以资深工程师的视角审查以下代码，按严重程度（阻塞 / 重要 / 建议）列出问题，给出文件与行号，并说明修复方式。重点关注：正确性、边界条件、并发与资源释放、错误处理、可测试性。\n\n```\n{{code}}\n```',
  },
  {
    title: '重构计划',
    tags: ['重构'],
    content:
      '阅读 {{path}} 目录，先给我一份模块边界与数据流的侦察笔记，再给出分阶段重构计划：每阶段的目标、改动文件、验证方式、回滚方案。不要一次性大改。',
  },
  {
    title: 'Bug 定位',
    tags: ['调试'],
    content:
      '现象：{{symptom}}\n复现步骤：{{steps}}\n期望：{{expected}}\n\n请先提出 3 个最可能的根因假设，并为每个假设设计最小验证实验（命令 / 日志 / 断点），确认后再改代码。',
  },
  {
    title: '写测试',
    tags: ['测试'],
    content:
      '为 {{module}} 补单元测试：先列出行为契约与边界条件，再写最小失败用例，最后实现。测试需可重复、不依赖网络与时间。',
  },
  {
    title: '技术方案对比',
    tags: ['架构'],
    content:
      '在约束（{{constraints}}）下比较方案 A（{{a}}）与方案 B（{{b}}）：实现复杂度、运行成本、可维护性、失败模式、迁移成本。给出明确推荐与理由，不要罗列泛泛优缺点。',
  },
];

export function listPrompts() {
  const state = getState();
  if (!state.meta.promptsSeeded) {
    if (!state.prompts.length) {
      const now = new Date().toISOString();
      state.prompts = SEEDS.map((s) => ({ id: uidFor('prm'), ...s, createdAt: now, updatedAt: now }));
    }
    state.meta.promptsSeeded = true;
    mutate(() => {});
  }
  return getState().prompts;
}

export function upsertPrompt(input) {
  return mutate((state) => {
    const now = new Date().toISOString();
    const title = String(input.title || '未命名提示词').trim().slice(0, 200);
    const content = String(input.content || '').slice(0, 100000);
    const tags = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean).slice(0, 20) : [];
    const category = String(input.category || '').trim().slice(0, 40);
    if (input.id) {
      const idx = state.prompts.findIndex((p) => p.id === input.id);
      if (idx === -1) throw new Error('提示词不存在');
      state.prompts[idx] = { ...state.prompts[idx], ...input, title, content, tags, category, updatedAt: now };
      return state.prompts[idx];
    }
    const item = {
      id: uidFor('prm'),
      title,
      tags,
      category,
      content,
      createdAt: now,
      updatedAt: now,
    };
    state.prompts.unshift(item);
    return item;
  });
}

export function setPromptCategory(id, category) {
  return mutate((state) => {
    const item = state.prompts.find((p) => p.id === id);
    if (!item) throw new Error('提示词不存在');
    const key = String(category || '').trim().slice(0, 40);
    if (key) item.category = key;
    else delete item.category;
    item.updatedAt = new Date().toISOString();
    return { ok: true, id, category: key };
  });
}

export function removePrompt(id) {
  return mutate((state) => {
    const before = state.prompts.length;
    state.prompts = state.prompts.filter((p) => p.id !== id);
    return before !== state.prompts.length;
  });
}
