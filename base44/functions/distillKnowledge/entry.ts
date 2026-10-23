import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { llmJson } from '../../shared/llm.ts';
import { appendMessage } from '../../shared/chat.ts';

const KINDS = ['term_mapping', 'rule', 'calc_logic', 'correction'];
const CATEGORIES = ['supplier_alias', 'city_alias', 'fee_item', 'other'];

const SYS = `你是物流知识库整理专家。给定一段报价工作对话记录（以及可能的测算脚本与修正历史），请把其中值得长期沉淀的内容整理成知识库草稿。
可用的知识类型（kind）与所需字段：
- term_mapping：术语映射。category 可选 supplier_alias（供应商别名）/ city_alias（城市别名）/ fee_item（费用项目）/ other。需要 term（术语原文）与 mapped_value（映射目标值）。
- rule：识别规则。category 可选 fee_item / other。需要 content（规则说明）。
- calc_logic：计费逻辑。category 可选 fee_item / other。需要 applies_to（适用条件，如"海运整箱，按重量与体积取大"）与 content（计费规则说明）；可选 variables（数组，每项 {name,label,unit,default}，变量名用英文小写下划线）、expressions（数组，每项 {label,expr}，expr 只允许数字、+ - * /、括号、函数 max/min/round(x,小数位)/abs/floor/ceil 与变量名）、currency（币种，如 USD）、unit（计价单位，如 每票）。
- correction：修正经验。category 固定 other。需要 content（经验说明）。
整理要求：
- 只整理值得长期沉淀的知识：术语别名、识别注意事项、通用计费规则、脚本背后的计费逻辑、专家修正经验。
- 不要把只对当前报价单有意义的具体价格/线路数据整理成知识（这些属于报价数据）；但计费方式本身（取大取小、最低收费、单位换算、阶梯计费等）应整理为 calc_logic，变量与表达式从脚本中提炼，费率数值不写入表达式（作为线路参数由报价数据提供）。
- 来自专家对话反馈的按其内容归类；来自测算脚本的整理为 calc_logic。
- 每条草稿 reason 用一句话说明来源（如"来自专家反馈：……"、"来自测算脚本：线路组××"）。
- 最多 8 条；没有值得整理的内容时返回空数组。
输出 JSON：{"drafts":[{"kind":"...","category":"...","term":"","mapped_value":"","content":"","applies_to":"","variables":[],"expressions":[],"currency":"","unit":"","reason":""}]}`;

// 提取文本关键词：引号片段 + 英文词 + 中文二元组（用于与现有条目做重复比对）
function textKeys(text) {
  const keys = new Set();
  const t = String(text || '').toLowerCase();
  for (const m of t.matchAll(/[「『"“']([^」』"”']{2,20})[」』"”']/g)) keys.add(m[1]);
  for (const m of t.matchAll(/[a-z][a-z0-9_&./-]{1,15}/g)) keys.add(m[0]);
  for (const run of String(t).matchAll(/[\u4e00-\u9fff]{2,12}/g)) {
    const s = run[0];
    for (let i = 0; i + 2 <= s.length && i < 30; i++) keys.add(s.slice(i, i + 2));
  }
  return keys;
}

function entryText(e) {
  return [e.term, e.mapped_value, e.content, e.applies_to].join('\n');
}

function dupLabel(e) {
  if (e.kind === 'term_mapping') return (e.term || '') + ' → ' + (e.mapped_value || '');
  if (e.kind === 'calc_logic') return (e.applies_to ? '适用：' + e.applies_to + '。' : '') + String(e.content || '').slice(0, 50);
  return String(e.content || '').slice(0, 60);
}

// 与同类型现有条目比对：草稿关键词被条目覆盖的比例达到阈值即视为可能重复
function findDuplicates(draft, entries) {
  const dk = textKeys([draft.term, draft.mapped_value, draft.content, draft.applies_to].join('\n'));
  if (!dk.size) return [];
  const scored = [];
  for (const e of entries) {
    if (e.kind !== draft.kind) continue;
    const ek = textKeys(entryText(e));
    if (!ek.size) continue;
    let hit = 0;
    for (const k of dk) if (ek.has(k)) hit++;
    const score = hit / dk.size;
    if (score >= 0.35) scored.push({ id: e.id, score, label: dupLabel(e) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((x) => ({ id: x.id, label: x.label }));
}

function sanitizeDraft(d, i) {
  if (!d || !KINDS.includes(d.kind)) return null;
  const out = {
    id: 'd' + (i + 1),
    kind: d.kind,
    category: CATEGORIES.includes(d.category) ? d.category : 'other',
    term: String(d.term || '').slice(0, 200),
    mapped_value: String(d.mapped_value || '').slice(0, 200),
    content: String(d.content || '').slice(0, 2000),
    applies_to: String(d.applies_to || '').slice(0, 500),
    variables: Array.isArray(d.variables)
      ? d.variables.filter((v) => v && v.name).slice(0, 12).map((v) => ({
          name: String(v.name).slice(0, 60),
          label: String(v.label || v.name).slice(0, 100),
          unit: String(v.unit || '').slice(0, 30),
          default: v.default != null ? v.default : '',
        }))
      : [],
    expressions: Array.isArray(d.expressions)
      ? d.expressions.filter((x) => x && x.expr).slice(0, 12).map((x) => ({
          label: String(x.label || '').slice(0, 100),
          expr: String(x.expr).slice(0, 500),
        }))
      : [],
    currency: String(d.currency || '').slice(0, 20),
    unit: String(d.unit || '').slice(0, 50),
    reason: String(d.reason || '').slice(0, 200),
  };
  if (out.kind === 'term_mapping' && !out.term) return null;
  if (out.kind !== 'term_mapping' && !out.content) return null;
  return out;
}

// 测算脚本摘要：把组/服务的变量与费用表达式提炼出来供 LLM 整理
function scriptDigest(quote) {
  const cs = quote && quote.calc_script;
  if (!cs) return '';
  const lines = [];
  const groups = cs.transport_groups || [];
  for (const g of groups) {
    lines.push('线路组「' + g.name + '」：' + (g.logic_desc || ''));
    const sc = g.script || {};
    for (const v of sc.variables || []) lines.push('  变量 ' + v.name + '（' + (v.label || '') + (v.unit ? '，' + v.unit : '') + '）');
    for (const p of sc.program || []) if (p && p.item) lines.push('  费用 ' + (p.label || p.name) + ' = ' + p.expr + (p.desc ? '（' + p.desc + '）' : ''));
  }
  for (const s of cs.services || []) {
    lines.push('服务「' + s.name + '」：');
    const sc = s.script || {};
    for (const v of sc.variables || []) lines.push('  变量 ' + v.name + '（' + (v.label || '') + (v.unit ? '，' + v.unit : '') + '）');
    for (const p of sc.program || []) if (p && p.item) lines.push('  费用 ' + (p.label || p.name) + ' = ' + p.expr + (p.desc ? '（' + p.desc + '）' : ''));
  }
  return lines.join('\n');
}

export default async function(req) {
  let session_id = null;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    session_id = body.session_id;
    if (!session_id) return Response.json({ error: '需要 session_id' }, { status: 400 });

    const session = await base44.entities.ChatSession.get(session_id);
    if (!session) return Response.json({ error: '会话不存在' }, { status: 404 });
    const llmModel = session.llm_model === 'flash' ? 'flash' : 'pro';
    const quote = session.quote_id
      ? await base44.entities.SupplierQuote.get(session.quote_id).catch(() => null)
      : null;

    // 本轮全部内容：对话记录 + 测算脚本 + 修正历史
    const msgPage = await base44.entities.ChatMessage.filter({ session_id }, { sort: 'created_date', limit: 60 });
    const transcript = (msgPage.items || []).map((m) =>
      (m.role === 'user' ? '用户：' : '助手：') + String(m.text || '').slice(0, 300));
    if (!transcript.length) throw new Error('本轮对话没有可整理的内容');

    const digestParts = [];
    const sDigest = scriptDigest(quote);
    if (sDigest) digestParts.push('【当前测算脚本】\n' + sDigest);
    if (quote && Array.isArray(quote.corrections) && quote.corrections.length) {
      digestParts.push('【专家修正历史（最近 5 条）】\n' + quote.corrections.slice(-5)
        .map((c) => '- ' + String(c.feedback || '').slice(0, 200)).join('\n'));
    }

    const payload = '【对话记录】\n' + transcript.join('\n') + '\n\n' + (digestParts.join('\n\n') || '（无脚本与修正记录）');
    const r = await llmJson(SYS, payload, 110000, llmModel);
    const raw = Array.isArray(r && r.drafts) ? r.drafts : [];
    const cleaned = raw.map(sanitizeDraft).filter(Boolean).slice(0, 8);
    if (!cleaned.length) {
      await appendMessage(base44, session_id, 'assistant',
        '本轮对话中没有找到值得沉淀进知识库的内容（术语映射、识别规则、计费逻辑或修正经验），未生成草稿。');
      return Response.json({ ok: true, count: 0 });
    }

    // 重复检测：与现有知识库条目按关键词重合度比对，标记候选供专家选择更新或新增
    const entriesPage = await base44.entities.KnowledgeEntry.list({ limit: 500 });
    const entries = entriesPage.items || [];
    for (const d of cleaned) d.duplicates = findDuplicates(d, entries);

    const draftPayload = { date: new Date().toISOString(), drafts: cleaned };
    await base44.entities.ChatSession.update(session_id, { pending_knowledge: draftPayload });
    await appendMessage(base44, session_id, 'assistant',
      '已根据本轮对话与测算脚本整理出 ' + cleaned.length + ' 条知识库草稿，与现有条目可能重复的已标记。点击卡片打开审核面板，逐条编辑并选择「新增条目」或「更新原条目」，确认后才会写入知识库：',
      [{ type: 'knowledge_draft', data: draftPayload }]);
    return Response.json({ ok: true, count: cleaned.length });
  } catch (error) {
    if (session_id) {
      try {
        await appendMessage(base44, session_id, 'assistant',
          '知识整理失败：' + (error && error.message ? error.message : '未知错误') + '，请稍后重试或补充更多对话内容。');
      } catch { /* 状态恢复失败时静默处理 */ }
    }
    return Response.json({ error: error && error.message ? error.message : String(error) }, { status: 500 });
  }
}