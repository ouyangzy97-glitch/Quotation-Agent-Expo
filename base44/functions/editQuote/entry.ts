import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { loadCityNames } from '../../shared/llm.ts';
import { appendMessage } from '../../shared/chat.ts';

function summarize(item) {
  if (!item) return '';
  if (item.origin || item.destination) return [item.origin, item.destination].filter(Boolean).join(' → ');
  return item.name || item.raw || '';
}

function fieldChanges(oldItem, newItem, scope) {
  const changes = [];
  const keys = new Set([...Object.keys(oldItem || {}), ...Object.keys(newItem || {})]);
  for (const k of keys) {
    const b = oldItem ? oldItem[k] : undefined;
    const a = newItem ? newItem[k] : undefined;
    if (String(b ?? '') !== String(a ?? '')) {
      changes.push({ scope, field: k, before: b == null || b === '' ? '' : String(b), after: a == null ? '' : String(a) });
    }
  }
  return changes;
}

function diffArray(oldArr, newArr, keyFn, label) {
  const changes = [];
  const oldPool = (oldArr || []).map((item) => ({ item, key: keyFn(item) }));
  const used = new Set();
  for (const n of newArr || []) {
    let found = -1;
    for (let i = 0; i < oldPool.length; i++) {
      if (!used.has(i) && oldPool[i].key === keyFn(n)) { found = i; break; }
    }
    if (found >= 0) {
      used.add(found);
      changes.push(...fieldChanges(oldPool[found].item, n, label + '·' + (summarize(n) || '未命名')));
    } else {
      changes.push({ scope: '新增' + label, field: '新增条目', before: '', after: summarize(n) });
    }
  }
  oldPool.forEach((o, i) => {
    if (!used.has(i)) changes.push({ scope: '删除' + label, field: '删除条目', before: summarize(o.item), after: '' });
  });
  return changes;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { session_id, transport, service } = await req.json();
    if (!session_id || !Array.isArray(transport) || !Array.isArray(service)) {
      return Response.json({ error: '需要 session_id 和 transport/service 数组' }, { status: 400 });
    }

    const session = await base44.entities.ChatSession.get(session_id);
    if (!session.quote_id) return Response.json({ error: '该会话还没有识别结果' }, { status: 400 });
    const quote = await base44.entities.SupplierQuote.get(session.quote_id);
    if (quote.pending_changes && quote.pending_changes.date) {
      return Response.json({ error: '当前有待确认的修改建议，请先在对话中确认后再编辑' }, { status: 400 });
    }

    const newTransport = transport.map((t) => ({ ...t }));
    const newService = service.map((s) => ({ ...s }));
    const changes = [
      ...diffArray(quote.transport_fees || [], newTransport, (t) => [t.origin || '', t.destination || '', t.mode || ''].join('|'), '运输费'),
      ...diffArray(quote.service_fees || [], newService, (s) => s.name || '', '服务费'),
    ];

    // 按最新城市节点库重新计算未命中的起终点城市
    const cityNames = await loadCityNames(base44);
    const citySet = new Set(cityNames);
    const unmatched = new Set();
    for (const t of newTransport) {
      for (const k of ['origin', 'destination']) {
        if (t[k] && !citySet.has(t[k])) unmatched.add(t[k]);
      }
    }

    const priorVersions = Array.isArray(quote.versions) ? quote.versions : [];
    const versions = priorVersions.length
      ? priorVersions.slice()
      : [{ date: quote.created_date, label: '原始识别', transport: quote.transport_fees, service: quote.service_fees }];
    versions.push({
      date: new Date().toISOString(),
      label: '修正版 v' + versions.length,
      transport: newTransport,
      service: newService,
    });

    const corrections = [...(quote.corrections || [])];
    corrections.push({ date: new Date().toISOString(), feedback: '详情面板内直接编辑', changes });

    await base44.entities.SupplierQuote.update(quote.id, {
      transport_fees: newTransport,
      service_fees: newService,
      versions,
      corrections,
      unmatched_cities: Array.from(unmatched),
    });

    await base44.entities.ChatSession.update(session_id, { stage: 'awaiting_confirm' });

    await appendMessage(base44, session_id, 'assistant',
      '已在详情面板中直接修改识别内容，共 ' + changes.length + ' 处变更，生成新版（原始版本已保留，详情面板可切换查看）。请继续检查，确认无误请点击「确认无误，进入测算」：',
      [
        { type: 'recognition', data: { transport: newTransport, service: newService, versions } },
      ]);
    return Response.json({ ok: true, changes });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}