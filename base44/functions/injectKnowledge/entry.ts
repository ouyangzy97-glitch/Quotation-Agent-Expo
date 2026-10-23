import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { appendMessage } from '../../shared/chat.ts';

const KINDS = ['term_mapping', 'rule', 'calc_logic', 'correction'];
const CATEGORIES = ['supplier_alias', 'city_alias', 'fee_item', 'other'];

// 只接收知识库条目的合法字段，长度做上限截断
function pickEntry(e) {
  const src = e || {};
  const out = {};
  if (KINDS.includes(src.kind)) out.kind = src.kind;
  if (CATEGORIES.includes(src.category)) out.category = src.category;
  for (const k of ['term', 'mapped_value', 'content', 'applies_to', 'currency', 'unit']) {
    if (typeof src[k] === 'string') out[k] = src[k].slice(0, 2000);
  }
  if (Array.isArray(src.variables)) {
    out.variables = src.variables.filter((v) => v && v.name).slice(0, 12).map((v) => ({
      name: String(v.name).slice(0, 60),
      label: String(v.label || v.name).slice(0, 100),
      unit: String(v.unit || '').slice(0, 30),
      default: v.default != null ? v.default : '',
    }));
  }
  if (Array.isArray(src.expressions)) {
    out.expressions = src.expressions.filter((x) => x && x.expr).slice(0, 12).map((x) => ({
      label: String(x.label || '').slice(0, 100),
      expr: String(x.expr).slice(0, 500),
    }));
  }
  return out;
}

export default async function(req) {
  let session_id = null;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    session_id = body.session_id;
    const drafts = Array.isArray(body.drafts) ? body.drafts.slice(0, 20) : [];
    if (!session_id || !drafts.length) return Response.json({ error: '需要 session_id 和 drafts' }, { status: 400 });

    const session = await base44.entities.ChatSession.get(session_id);
    if (!session) return Response.json({ error: '会话不存在' }, { status: 404 });

    let created = 0;
    let updated = 0;
    for (const d of drafts) {
      const entry = pickEntry(d.entry);
      if (!entry.kind || Object.keys(entry).length < 2) continue;
      if (d.action === 'create') {
        await base44.entities.KnowledgeEntry.create({ ...entry, source: 'manual', enabled: true });
        created++;
      } else if (d.action === 'update' && d.target_id) {
        const existing = await base44.entities.KnowledgeEntry.get(d.target_id).catch(() => null);
        if (!existing) continue;
        await base44.entities.KnowledgeEntry.update(d.target_id, entry);
        updated++;
      }
    }

    if (created + updated === 0) {
      await appendMessage(base44, session_id, 'assistant',
        '没有可注入的知识条目（草稿均已跳过或未匹配到原条目），知识库未变更。');
      return Response.json({ ok: true, created: 0, updated: 0 });
    }
    await base44.entities.ChatSession.update(session_id, { pending_knowledge: null });
    await appendMessage(base44, session_id, 'assistant',
      '已注入知识库：新增 ' + created + ' 条、更新 ' + updated + ' 条（均为专家确认后写入）。可在「知识库」页面查看和维护。');
    return Response.json({ ok: true, created, updated });
  } catch (error) {
    if (session_id) {
      try {
        await appendMessage(base44, session_id, 'assistant',
          '知识注入失败：' + (error && error.message ? error.message : '未知错误') + '，草稿已保留，请稍后重试。');
      } catch { /* 忽略 */ }
    }
    return Response.json({ error: error && error.message ? error.message : String(error) }, { status: 500 });
  }
}