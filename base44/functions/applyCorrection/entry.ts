import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { appendMessage } from '../../shared/chat.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { session_id } = await req.json();
    if (!session_id) return Response.json({ error: '需要 session_id' }, { status: 400 });

    const session = await base44.entities.ChatSession.get(session_id);
    if (!session.quote_id) return Response.json({ error: '该会话还没有识别结果' }, { status: 400 });
    const quote = await base44.entities.SupplierQuote.get(session.quote_id);
    const pending = quote.pending_changes;
    if (!pending || !pending.date) return Response.json({ error: '当前没有待确认的修改建议' }, { status: 400 });

    const priorVersions = Array.isArray(quote.versions) ? quote.versions : [];
    const versions = priorVersions.length
      ? priorVersions.slice()
      : [{ date: quote.created_date, label: '原始识别', transport: quote.transport_fees, service: quote.service_fees }];
    versions.push({
      date: new Date().toISOString(),
      label: '修正版 v' + versions.length,
      transport: pending.transport || quote.transport_fees,
      service: pending.service || quote.service_fees,
    });

    const corrections = [...(quote.corrections || [])];
    corrections.push({ date: pending.date, feedback: pending.feedback || '', changes: pending.changes || [] });

    const update = {
      transport_fees: pending.transport || quote.transport_fees,
      service_fees: pending.service || quote.service_fees,
      corrections,
      versions,
      pending_changes: null,
      unmatched_cities: (pending.unmatched_cities || quote.unmatched_cities || []).filter(Boolean),
    };
    if (pending.supplier_name) update.supplier_name = pending.supplier_name;
    await base44.entities.SupplierQuote.update(quote.id, update);

    await base44.entities.ChatSession.update(session_id, { stage: 'awaiting_confirm' });

    await appendMessage(base44, session_id, 'assistant',
      '已应用修改，共 ' + (pending.changes || []).length + ' 处变更，生成新版识别结果（原始版本已保留，详情面板可切换查看）。请继续检查，确认无误请点击「确认无误，进入测算」：',
      [
        { type: 'recognition', data: { transport: update.transport_fees, service: update.service_fees, versions } },
      ]);
    return Response.json({ ok: true, changes: pending.changes || [] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}