import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { llmJson } from '../../shared/llm.ts';
import { loadCorpus, retrieveContext, isStructuralFeedback, cityOnlyContext } from '../../shared/retrieval.ts';
import { appendMessage } from '../../shared/chat.ts';

function summarize(item) {
  if (!item) return '';
  if (item.origin || item.destination) return [item.origin, item.destination].filter(Boolean).join(' → ');
  return item.name || item.raw || '';
}

// 确定性校验「应用分析结论」后的新描述：
// 1) 原描述中的全部数值与币种信息必须逐项保留；2) 必须实质性体现分析结论
//（存在来自分析、且原描述中没有的连续片段），避免模型只复述原文。
function validateApplied(beforeRaw, analysisAnswer, cand) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[*#`>]/g, '');
  if (!cand || norm(cand) === norm(beforeRaw)) return false;
  const nums = String(beforeRaw).match(/\d+(?:\.\d+)?/g) || [];
  for (const n of nums) {
    if (!String(cand).includes(n)) return false;
  }
  for (const cur of ['USD', 'EUR', 'CNY', 'RMB']) {
    if (String(beforeRaw).includes(cur) && !String(cand).includes(cur)) return false;
  }
  const afterN = norm(cand);
  const beforeN = norm(beforeRaw);
  const ansN = norm(analysisAnswer);
  for (const seg of ansN.split(/[。；;！？\n]/)) {
    const s2 = seg.replace(/\s+/g, '');
    for (let i = 0; i + 8 <= s2.length; i += 2) {
      const w = s2.slice(i, i + 8);
      if (afterN.includes(w) && !beforeN.includes(w)) return true;
    }
  }
  return false;
}

export default async function(req) {
  let session = null;
  let base44 = null;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { session_id, feedback, needs_knowledge } = await req.json();
    if (!session_id || !feedback) return Response.json({ error: '需要 session_id 和 feedback' }, { status: 400 });

    session = await base44.entities.ChatSession.get(session_id);
    if (!session.quote_id) return Response.json({ error: '该会话还没有识别结果' }, { status: 400 });
    const quote = await base44.entities.SupplierQuote.get(session.quote_id);
    const prevStage = session.stage || 'awaiting_confirm';
    const llmModel = session.llm_model === 'flash' ? 'flash' : 'pro';
    let r = null;

    // 「把分析应用到描述」类反馈：定位对应的分析结论，单独传入并强制融合
    const t0 = String(feedback).trim();
    const wantsAnalysis = /分析|理解|结论/.test(t0) && /应用|融入|写入|采纳|结合|放到|放入|合并/.test(t0);
    if (wantsAnalysis) {
      const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
      const svcs = (quote.service_fees || []);
      // 收集最近的分析回答（answerQuestion 会以 analysis 块记录费用项与结论）
      const msgPage = await base44.entities.ChatMessage.filter({ session_id }, { sort: '-created_date', limit: 30 });
      const analyses = [];
      for (const m of (msgPage.items || [])) {
        for (const b of (m.blocks || [])) {
          if (b && b.type === 'analysis' && b.data && b.data.answer) {
            analyses.push({ fee_name: String(b.data.fee_name || ''), answer: String(b.data.answer) });
          }
        }
      }
      // 定位目标费用项：先按反馈文本直接匹配，再退回用最近一次分析定位
      let targetIdx = svcs.findIndex((s) => s && s.name && norm(t0).includes(norm(s.name)));
      if (targetIdx < 0 && analyses.length && analyses[0].fee_name) {
        const idx2 = svcs.findIndex((s) => s && s.name && (norm(s.name) === norm(analyses[0].fee_name)
          || norm(s.name).includes(norm(analyses[0].fee_name))
          || norm(analyses[0].fee_name).includes(norm(s.name))));
        if (idx2 >= 0) targetIdx = idx2;
      }
      const analysis = (targetIdx >= 0 && svcs[targetIdx]
        ? analyses.find((a) => a.fee_name && (norm(a.fee_name) === norm(svcs[targetIdx].name)
            || norm(svcs[targetIdx].name).includes(norm(a.fee_name))))
        : null) || analyses[0] || null;
      if (targetIdx < 0 || !analysis) {
        await appendMessage(base44, session_id, 'assistant',
          '未找到可应用的分析结论。请先就该项费用提问（例如「码头操作费的描述怎么理解」），得到分析后再输入「将分析应用到描述」；也可以直接把分析内容粘贴给我。');
        return Response.json({ ok: false, error: 'no_analysis' });
      }

      const item = svcs[targetIdx];
      const before = String(item.raw || '');
      const APPLY_SYS = `你是物流报价识别修正专家。用户要求把一段分析结论融入某项服务费的描述（raw）。
输出 JSON：{"new_raw":"修改后的完整描述"}
要求：
- new_raw 必须是一段完整、连贯、可直接阅读的单段中文描述，不是要点列表。
- 必须逐字保留原描述中的全部数值、币种（如 USD）与计价方式信息（如每100KG、1CBM=300KG、取整取大等），一项不漏。
- 必须把「分析结论」的实质内容（换算关系、计费逻辑、影响说明）融入描述，使描述本身即解释该费用如何计费；不允许只复述原描述，也不允许只复述分析。
- 不新增原描述与分析中都没有的金额或条款。`;
      const payload = [
        '费用项名称：' + (item.name || ''),
        '【一、当前描述（其中的数值、币种与计价方式必须全部保留）】\n' + before,
        '【二、分析结论（必须把其实质内容融入新描述）】\n' + analysis.answer.slice(0, 3000),
        '【三、用户本次要求】\n' + t0,
      ].join('\n\n');

      let newRaw = '';
      for (let attempt = 0; attempt < 2 && !newRaw; attempt++) {
        const r2 = await llmJson(APPLY_SYS, payload + (attempt ? '\n\n上一次输出未通过校验：请逐条自查「全部数值与币种保留」和「实质性融入分析结论」后重新输出。' : ''), 110000, llmModel);
        const cand = String((r2 && r2.new_raw) || '').trim();
        if (validateApplied(before, analysis.answer, cand)) newRaw = cand;
      }
      if (!newRaw) {
        try { await base44.entities.ChatSession.update(session_id, { stage: prevStage }); } catch (_) {}
        await appendMessage(base44, session_id, 'assistant',
          '无法可靠地把分析结论融入该项描述（两次生成均未同时满足：保留原报价全部数值与币种信息、实质性体现分析结论）。为避免生成误导性建议，本次未创建修改建议；可尝试把要应用的结论明确写成一句话后再应用。');
        return Response.json({ ok: false, error: 'verification_failed' });
      }
      // 走与普通修正一致的确认/应用链路（确认后才生效并生成新版本）
      r = { changes: [{ target: 'service', index: targetIdx, scope: '服务费·' + (item.name || ''), field: 'raw', before, after: newRaw }] };
    }

    const corpus = await loadCorpus(base44);
    const citySet = corpus.cityNames;
    // 按任务判断是否检索知识库：结构性数据操作（删除/新增条目、直接改字段值）不检索；
    // 是否涉及术语/计费规则由意图路由判定（needs_knowledge），未经路由时默认检索
    const skipRetrieval = isStructuralFeedback(feedback) || needs_knowledge === false;
    const retrieveBasis = feedback + '\n' + JSON.stringify({ transport: quote.transport_fees || [], service: quote.service_fees || [] });
    const { context: ctx } = skipRetrieval
      ? { context: cityOnlyContext(corpus) }
      : await retrieveContext(corpus, retrieveBasis, { model: llmModel });

    const SYS = `你是物流报价识别修正专家。专家对识别结果给出了反馈，请据此生成修改建议（暂不生效，确认后才应用）。
为加快响应，只输出需要修改的条目（changes），未变化的数据一律不要重复输出。
changes 支持以下条目格式：
- 修改已有条目的字段：{"target":"transport"或"service","index":条目序号（见输入中每条前的 index）,"scope":"位置描述，如 运输费·上海→汉堡 或 服务费·送货费","field":"字段名","before":"修改前的值（取自当前数据，无则为空字符串）","after":"修改后的值"}
- 新增运输费条目：{"target":"transport_add","scope":"新增运输费","item":{"origin":"","destination":"","mode":"","supplier":"","unit_weight_price":0,"weight_price_unit":"","unit_volume_price":0,"volume_price_unit":"","raw":""}}
- 新增服务费条目：{"target":"service_add","scope":"新增服务费","item":{"name":"","raw":""}}
- 删除条目：{"target":"transport_del"或"service_del","index":条目序号,"scope":"删除运输费·xxx"或"删除服务费·xxx"}
- 修改报价单标题或供应商名称：{"target":"quote","scope":"标题"或"供应商名称","field":"title"或"supplier_name","before":"原值","after":"新值"}
字段规则：
- 运输费 origin/destination 必须使用城市节点库中的规范城市名（别名需映射）；城市不在库中则填原文写法；supplier 为该线路供应商/船公司。
- 服务费只有 name 与 raw 两个字段，没有金额/币种/计价单位等独立字段，一切金额、币种、计价单位、条款都写在 raw 里。当专家要求把某段分析、解释或理解应用到某项服务费的描述时，必须修改该项的 raw 字段：保留原报价中已有的全部数值、币种与计价单位，并把专家认可的分析融入描述，绝不改到 unit 等其他字段。raw 必须是完整单段可读描述，全部数值和附注一项不漏；运输费的 unit_weight_price/unit_volume_price 为纯数值。
只输出 JSON：{"changes":[...]}`;
    const userMsg = '当前识别结果（transport/service 中每条前的 index 是条目序号，供修改定位）：\n' + JSON.stringify({
      supplier_name: quote.supplier_name,
      title: quote.title,
      transport: (quote.transport_fees || []).map((t, i) => ({ index: i, ...t })),
      service: (quote.service_fees || []).map((s, i) => ({ index: i, ...s })),
    }) + '\n\n专家反馈：\n' + feedback + '\n\n' + ctx;
    if (!r) r = await llmJson(SYS, userMsg, 110000, llmModel);

    // 在代码中确定性地套用变更，避免模型重复输出全部数据导致超时
    const newTransport = JSON.parse(JSON.stringify(quote.transport_fees || []));
    const newService = JSON.parse(JSON.stringify(quote.service_fees || []));
    let newSupplier = quote.supplier_name || '';
    let newTitle = quote.title || '';
    const applyChanges = [];
    for (const c of (r.changes || [])) {
      const t = c && c.target;
      if (t === 'transport_add' || t === 'service_add') {
        const item = c.item || {};
        (t === 'transport_add' ? newTransport : newService).push(item);
        applyChanges.push({ scope: c.scope || (t === 'transport_add' ? '运输费' : '服务费'), field: '新增条目', before: '', after: summarize(item) });
      } else if (t === 'transport_del' || t === 'service_del') {
        const arr = t === 'transport_del' ? newTransport : newService;
        const item = arr[Number(c.index)];
        if (item) {
          const s = summarize(item);
          arr.splice(Number(c.index), 1);
          applyChanges.push({ scope: c.scope || (t === 'transport_del' ? '运输费' : '服务费'), field: '删除条目', before: s, after: '' });
        }
      } else if (t === 'quote') {
        if (c.field === 'supplier_name') {
          applyChanges.push({ scope: '供应商名称', field: 'supplier_name', before: newSupplier, after: c.after });
          newSupplier = c.after;
        } else if (c.field === 'title') {
          applyChanges.push({ scope: '标题', field: 'title', before: newTitle, after: c.after });
          newTitle = c.after;
        }
      } else if ((t === 'transport' || t === 'service') && c.field) {
        const arr = t === 'transport' ? newTransport : newService;
        const item = arr[Number(c.index)];
        if (item) {
          const before = item[c.field];
          if (typeof before === 'number') {
            const n = parseFloat(String(c.after).replace(/[^0-9.\-]/g, ''));
            item[c.field] = isNaN(n) ? before : n;
          } else {
            item[c.field] = c.after;
          }
          applyChanges.push({ scope: c.scope || (t === 'transport' ? '运输费' : '服务费'), field: c.field, before: String(before), after: String(item[c.field]) });
        }
      }
    }

    // 按最新城市节点库重新计算未命中的起终点城市
    const unmatched = new Set();
    for (const t of newTransport) {
      for (const k of ['origin', 'destination']) {
        if (t[k] && !citySet.has(t[k])) unmatched.add(t[k]);
      }
    }

    await base44.entities.SupplierQuote.update(quote.id, {
      pending_changes: {
        date: new Date().toISOString(),
        feedback: String(feedback).slice(0, 2000),
        supplier_name: newSupplier,
        title: newTitle,
        unmatched_cities: Array.from(unmatched),
        transport: newTransport,
        service: newService,
        changes: applyChanges,
      },
    });

    await base44.entities.ChatSession.update(session_id, { stage: 'awaiting_apply' });

    await appendMessage(base44, session_id, 'assistant',
      '已根据专家反馈形成修改建议，共 ' + applyChanges.length + ' 处变更（尚未生效）。点击卡片可查看修改内容；确认无误请点击「确认修改」或直接输入「确认修改」，如需调整请继续输入新的意见：',
      [
        { type: 'proposal', data: { proposal: true, changes: applyChanges, feedback: String(feedback).slice(0, 500) } },
      ]);
    return Response.json({ ok: true, changes: applyChanges });
  } catch (error) {
    try {
      if (session && base44) {
        await base44.entities.ChatSession.update(session.id, { stage: 'awaiting_confirm' });
        await appendMessage(base44, session.id, 'assistant', '形成修改建议失败：' + error.message + '。请调整后重试。');
      }
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
}