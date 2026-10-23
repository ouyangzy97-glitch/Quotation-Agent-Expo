// 知识库与城市节点库的检索增强（RAG）：
// 先按关键词匹配知识条目与城市，命中不足时用一次轻量大模型调用做语义筛选兜底；
// 检索异常时回退为全量注入，不阻断识别与问答。
import { llmJson } from './llm.ts';

const DEFAULT_MAX_ENTRIES = 12;
const SEMANTIC_FALLBACK_MIN = 3;
const SEMANTIC_POOL = 60;
const GENERAL_MAX = 10;

const norm = (s) => String(s || '').toLowerCase();

// 加载语料：启用的知识条目 + 城市节点（含规范名与别名）
export async function loadCorpus(base44) {
  const [kbPage, cityPage] = await Promise.all([
    base44.entities.KnowledgeEntry.filter({ enabled: true }, { limit: 500 }),
    base44.entities.CityNode.list({ limit: 500 }),
  ]);
  const kb = kbPage.items || [];
  const cities = cityPage.items || [];
  const cityNames = new Set();
  for (const c of cities) {
    if (c.city) cityNames.add(c.city);
    for (const a of c.aliases || []) if (a) cityNames.add(a);
  }
  return { kb, cities, cityNames };
}

// 明确的结构性数据操作（删除/新增条目、确认、直接改字段值）：无需知识库依据
export function isStructuralFeedback(feedback) {
  const t = String(feedback || '').trim();
  if (!t) return true;
  if (/^(删除|删掉|去掉|移除|新增|添加|加一[条个行]|确认|应用|同意)/.test(t)) return true;
  // 直接改某字段值：如「上海→汉堡体积价改为118」，且不涉及术语/计费规则
  if (/(改为|改成|应为|直接改成)/.test(t)
    && !/(术语|规则|计费|取大|取小|最低|四舍五入|换算|取整|逻辑|怎么算)/.test(t)) return true;
  return false;
}

// 跳过知识检索时仍注入城市节点库（保证起终点对齐），但不做知识条目匹配与语义兜底
export function cityOnlyContext(corpus) {
  const cityList = corpus ? (corpus.cities || []) : [];
  const cityLines = cityList.map((c) => {
    const alias = (c.aliases || []).join(' / ');
    return '- ' + c.city + '（' + (c.type === 'domestic' ? '国内' : '国外') + (c.country ? '，' + c.country : '') + '）' + (alias ? ' 别名：' + alias : '');
  });
  return '【城市节点库】起终点必须使用以下规范城市名（括号内为别名，需映射为规范名）：\n' +
    (cityLines.join('\n') || '（城市库为空，请提示专家先补充）');
}

// 术语映射条目的匹配词：术语与映射目标
function termKeys(entry) {
  const keys = new Set();
  for (const v of [entry.term, entry.mapped_value]) {
    for (const part of String(v || '').split(/[\s,，、;；/|]+/)) {
      const p = part.trim();
      if (p.length >= 2) keys.add(p.toLowerCase());
    }
  }
  return Array.from(keys);
}

// 规则条目的匹配词：引号片段与英文缩写词；提取不到的视为通用规则
function ruleKeys(entry) {
  const keys = new Set();
  const content = String(entry.content || '') + '\n' + String(entry.applies_to || '');
  for (const m of content.matchAll(/[「『"“']([^」』"”']{2,20})[」』"”']/g)) keys.add(m[1].toLowerCase());
  for (const m of content.matchAll(/[A-Za-z][A-Za-z0-9&./-]{1,15}/g)) keys.add(m[0].toLowerCase());
  return Array.from(keys);
}

// 纯函数：在语料上做关键词匹配，返回命中结果
export function matchCorpus(corpus, content) {
  const c = norm(content);
  const matchedCities = [];
  for (const city of corpus.cities || []) {
    const keys = [city.city, ...(city.aliases || [])].filter(Boolean);
    if (keys.some((k) => c.includes(norm(k)))) matchedCities.push(city);
  }
  const matched = [];
  const general = [];
  const rest = [];
  for (const e of corpus.kb || []) {
    const keys = e.kind === 'term_mapping' ? termKeys(e) : ruleKeys(e);
    if (!keys.length) general.push(e);
    else if (keys.some((k) => c.includes(k))) matched.push(e);
    else rest.push(e);
  }
  return { matchedCities, matched, general, rest };
}

// 计费逻辑条目的详细说明：变量、表达式、币种与单位
function calcLogicDetail(e) {
  const vars = (e.variables || []).map((v) => v.name + (v.default != null && v.default !== '' ? '(默认' + v.default + ')' : '')).join('、');
  const exprs = (e.expressions || []).map((x) => x.label + ' = ' + x.expr).join('；');
  const bits = [];
  if (vars) bits.push('变量：' + vars);
  if (exprs) bits.push('表达式：' + exprs);
  if (e.currency) bits.push('币种：' + e.currency);
  if (e.unit) bits.push('计价单位：' + e.unit);
  return bits.length ? '（' + bits.join('；') + '）' : '';
}

// 全量格式（回退用）
function fullCityLines(corpus) {
  return (corpus.cities || []).map((c) => {
    const alias = (c.aliases || []).join(' / ');
    return '- ' + c.city + '（' + (c.type === 'domestic' ? '国内' : '国外') + (c.country ? '，' + c.country : '') + '）' + (alias ? ' 别名：' + alias : '');
  });
}

function fullContext(corpus) {
  const kbLines = (corpus.kb || []).map((k) => {
    if (k.kind === 'term_mapping') return '- [术语映射/' + (k.category || 'other') + '] ' + k.term + ' → ' + (k.mapped_value || '');
    if (k.kind === 'calc_logic') return '- [计费逻辑/' + (k.category || 'other') + '] ' + (k.applies_to ? '适用：' + k.applies_to + '。' : '') + (k.content || '') + calcLogicDetail(k);
    return '- [' + (k.kind === 'correction' ? '修正经验' : '识别规则') + '] ' + (k.content || '');
  });
  return '【城市节点库】起终点必须使用以下规范城市名（括号内为别名，需映射为规范名）：\n' +
    (fullCityLines(corpus).join('\n') || '（城市库为空，请提示专家先补充）') +
    '\n\n【知识库】\n' + (kbLines.join('\n') || '（暂无）');
}

function kbLabel(e) {
  return e.kind === 'term_mapping' ? (e.term || '') : String(e.content || '').slice(0, 20);
}

// 语义兜底：从未命中条目中用一次轻量调用筛选相关编号
async function semanticFallback(candidates, content, modelKey) {
  const pool = candidates.slice(0, SEMANTIC_POOL);
  if (!pool.length) return [];
  const list = pool.map((e, i) => (i + 1) + '. ' + (e.kind === 'term_mapping'
    ? (e.term + ' → ' + (e.mapped_value || ''))
    : (e.kind === 'calc_logic'
      ? ('[计费逻辑] ' + (e.applies_to ? '适用：' + e.applies_to + '。' : '') + String(e.content || '').slice(0, 60))
      : String(e.content || '').slice(0, 80)))).join('\n');
  const SYS = '你是物流知识检索助手。给定报价内容片段与候选知识条目列表，只挑出与内容直接相关的条目编号（术语名出现在内容中、或规则明确适用于内容中的费用/场景）。没有相关就返回空数组。只输出 JSON：{"indices":[1,2]}';
  try {
    const r = await llmJson(SYS, '内容：\n' + String(content).slice(0, 6000) + '\n\n候选条目：\n' + list, 60000, modelKey);
    return (r && Array.isArray(r.indices) ? r.indices : []).map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= pool.length)
      .map((n) => pool[n - 1]);
  } catch {
    return []; // 语义兜底失败不影响主流程
  }
}

// 检索并拼装注入提示词的上下文；失败时回退全量注入
export async function retrieveContext(corpus, content, opts = {}) {
  const maxEntries = opts.maxEntries || DEFAULT_MAX_ENTRIES;
  const semanticMin = opts.semanticMin ?? SEMANTIC_FALLBACK_MIN;
  try {
    if (!corpus) return { context: '', usedKnowledge: [], fullFallback: true };
    const { matchedCities, matched, general, rest } = matchCorpus(corpus, content);

    let used = matched.slice(0, maxEntries);
    if (used.length < semanticMin && rest.length) {
      const extra = await semanticFallback(rest, content, opts.model);
      const seen = new Set(used.map(kbLabel));
      for (const e of extra) {
        if (used.length >= maxEntries) break;
        const label = kbLabel(e);
        if (!seen.has(label)) { seen.add(label); used.push(e); }
      }
    }
    used = [...new Set(used.map(kbLabel))].map((l) => used.find((e) => kbLabel(e) === l));

    // 通用规则始终保留
    const generalUse = general.slice(0, GENERAL_MAX);
    const kbUse = [...generalUse, ...used];
    const kbLines = kbUse.map((k) => {
      if (k.kind === 'term_mapping') return '- [术语映射/' + (k.category || 'other') + '] ' + k.term + ' → ' + (k.mapped_value || '');
      if (k.kind === 'calc_logic') return '- [计费逻辑/' + (k.category || 'other') + '] ' + (k.applies_to ? '适用：' + k.applies_to + '。' : '') + (k.content || '') + calcLogicDetail(k);
      return '- [' + (k.kind === 'correction' ? '修正经验' : '识别规则') + '] ' + (k.content || '');
    });

    // 城市按内容命中后注入（含完整别名）；一个都没命中时回退注入全量城市清单
    let cityList = matchedCities;
    if (!cityList.length) cityList = corpus.cities || [];
    const cityLines = cityList.map((c) => {
      const alias = (c.aliases || []).join(' / ');
      return '- ' + c.city + '（' + (c.type === 'domestic' ? '国内' : '国外') + (c.country ? '，' + c.country : '') + '）' + (alias ? ' 别名：' + alias : '');
    });

    const context = '【知识库（按当前内容检索命中 ' + kbUse.length + ' 条）】\n' + (kbLines.join('\n') || '（无相关条目）') +
      '\n\n【城市节点库（' + (matchedCities.length ? '按内容命中 ' + cityList.length + ' 个' : '未命中任何城市，已注入全量清单') + '）】起终点必须使用以下规范城市名（括号内为别名，需映射为规范名）：\n' +
      (cityLines.join('\n') || '（城市库为空，请提示专家先补充）');

    return { context, usedKnowledge: kbUse.map(kbLabel), matchedCities };
  } catch {
    return {
      context: corpus ? fullContext(corpus) : '',
      usedKnowledge: [],
      fullFallback: true,
    };
  }
}