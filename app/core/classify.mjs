/**
 * 统一的分类：技能 / MCP / 插件 / 提示词共用一套分类键。
 * 自动分类只做关键词匹配，用户手动选过的分类优先。
 */
export const CATEGORIES = [
  { key: 'dev', label: '开发', words: ['code', 'repo', 'git', 'build', 'compile', 'test', 'debug', 'lint', 'refactor', 'review', 'deploy', 'ci', '代码', '测试', '重构', '调试', '审查', '评审', '构建', '部署'] },
  { key: 'docs', label: '文档', words: ['doc', 'readme', 'pdf', 'markdown', 'wiki', 'note', 'write', '文档', '笔记', '写作', '总结', '说明', '教程'] },
  { key: 'data', label: '数据', words: ['sql', 'sqlite', 'database', 'db', 'csv', 'excel', 'query', 'chart', '数据', '数据库', '查询', '统计', '表格', '报表'] },
  { key: 'web', label: '浏览/网页', words: ['browser', 'puppeteer', 'playwright', 'fetch', 'http', 'web', 'scrape', 'crawl', 'search', '网页', '浏览器', '爬取', '抓取', '搜索'] },
  { key: 'collab', label: '协作', words: ['slack', 'issue', 'pull request', 'notion', 'jira', 'mail', 'email', 'team', '协作', '团队', '通知', '邮件', '任务'] },
  { key: 'sys', label: '系统/文件', words: ['file', 'filesystem', 'shell', 'process', 'system', 'disk', 'os', '目录', '文件', '系统', '进程', '磁盘'] },
  { key: 'ai', label: 'AI/模型', words: ['ai', 'llm', 'model', 'embedding', 'memory', 'rag', 'vector', 'prompt', '模型', '记忆', '向量', '提示词'] },
  { key: 'other', label: '其他', words: [] },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export function categoryLabel(key) {
  return (CATEGORIES.find((c) => c.key === key) || {}).label || '其他';
}

/** 关键词自动分类；命中词越多得分越高，平手取靠前分类。 */
export function autoCategory(...parts) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  if (!text) return 'other';
  let best = 'other';
  let bestScore = 0;
  for (const cat of CATEGORIES) {
    if (!cat.words.length) continue;
    let score = 0;
    for (const w of cat.words) {
      if (!w) continue;
      const word = w.toLowerCase();
      if (text.includes(word)) score += word.length >= 3 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat.key;
    }
  }
  return best;
}

/** 手动值优先，非法/空值回落到自动分类。 */
export function resolveCategory(manual, ...parts) {
  const key = String(manual || '').trim();
  if (key && CATEGORY_KEYS.includes(key)) return key;
  return autoCategory(...parts);
}
