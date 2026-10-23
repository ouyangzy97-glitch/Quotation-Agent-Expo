import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { llmJson } from '../../shared/llm.ts';
import { loadCorpus, retrieveContext } from '../../shared/retrieval.ts';
import { appendMessage } from '../../shared/chat.ts';
import { extractDocxText } from '../../shared/docx.ts';
import { extractSpreadsheetText } from '../../shared/excel.ts';

const SYS = `你是B2B物流供应商报价单识别专家。从报价单内容中提取费用信息，严格按以下规则：
1. 运输费：提取结构化字段 origin(起点), destination(终点), mode(运输方式), supplier(该线路的供应商/船公司/承运人,如 YML&ONE/YML,识别不到填""), unit_weight_price(单位重量价格,数字或null), weight_price_unit(如 USD/吨、元/kg), unit_volume_price(单位体积价格,数字或null), volume_price_unit(如 USD/m³、元/CBM), raw(该条费用的完整原文，一字不改)。起终点必须使用城市节点库中的规范城市名（原文中的别名、英文名、旧称要映射为规范名）；若城市不在城市节点库中，填原文写法并加入 unmatched_cities。
   运输费 raw 重构规则：文件转成文本后，表格常被逐格拆行——先列出标签（如 港口、海运费(每立方/每吨)、船期、船公司），再列出对应数值。你必须把同一线路的标签与数值逐一配对，将 raw 还原为一条可读、完整的单段描述，包含港口、方式说明、价格标签与数值、船期、船公司等全部信息，一项不漏；不得拆成多条。若同一目的港下列有多个船公司/供应商的价格（如"30 / 40"与"YML&ONE/YML"），按供应商拆分为多条运输费，各自记录价格与供应商。
2. 服务费：只提取两个字段 name(服务项目名称), raw(该费用项的完整内容，包含全部金额、币种、计价单位、计价条件与附注)。不提取任何其他结构化字段。
   raw 重构规则：文件转成文本后，表格常被逐格拆行——先连续列出某费用项的全部标签（如 币别/数量/计费方式/单价/金额，或中英文项目名），再连续列出对应的值（如 USD/1/Bill/25/25），同一费用项可能跨越多行。你必须把这些标签与其对应的值逐一配对，将 raw 还原为一条可读、完整的单段描述，例如："送货费 DELIVERY CHARGE，币别 USD，数量 1，计费方式 JOB，单价 134.20，金额 134.20"。要求：包含该费用项的全部标签、数值和附注，一项不漏；不要保留无意义的逐行拆分；同一费用项的所有碎片归入同一个服务项，绝不能拆成多个。
3. supplier_name 为报价单供应商名称，title 为报价单标题；识别不到填 ""。
4. 只输出 JSON：{"supplier_name":"","title":"","unmatched_cities":[],"transport":[{"origin":"","destination":"","mode":"","supplier":"","unit_weight_price":null,"weight_price_unit":"","unit_volume_price":null,"volume_price_unit":"","raw":""}],"service":[{"name":"","raw":""}]}。没有费用项时数组为空。`;

function buildChunks(content, maxChars, maxRows) {
  const lines = content.split('\n');
  const chunks = [];
  let cur = [];
  let curLen = 0;
  for (const line of lines) {
    if (cur.length && (cur.length >= maxRows || curLen + line.length > maxChars)) {
      chunks.push(cur.join('\n'));
      cur = [];
      curLen = 0;
    }
    cur.push(line);
    curLen += line.length + 1;
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks.length ? chunks : [content];
}

async function runPool(items, workers, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker));
  return results;
}

// 单分块识别：模型响应慢或分块过大导致超时（aborted due to timeout）时，按行界对半拆分并行重试
async function runChunkLlm(sys, chunk, depth = 0, modelKey = 'pro') {
  try {
    return [await llmJson(sys, chunk, 110000, modelKey)];
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    const isTimeout = /aborted|timed?\s*out/i.test(msg);
    const cutAt = chunk.length > 800 ? chunk.indexOf('\n', Math.ceil(chunk.length / 2)) : -1;
    const splittable = cutAt > 0 && cutAt < chunk.length - 1;
    if (isTimeout && depth < 3 && splittable) {
      const [ra, rb] = await Promise.all([
        runChunkLlm(sys, chunk.slice(0, cutAt), depth + 1, modelKey),
        runChunkLlm(sys, chunk.slice(cutAt + 1), depth + 1, modelKey),
      ]);
      return [...ra, ...rb];
    }
    throw new Error(isTimeout && !splittable
      ? '识别响应超时：请稍后重试，或在应用设置中调小 MAX_ROWS_PER_CHUNK / MAX_CHUNK_CHARACTERS 后重试'
      : msg);
  }
}

export default async function(req) {
  let session = null;
  let base44 = null;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const { session_id, text, file_url, file_uri, file_name, supplier_name } = body;
    if (!text && !file_url) return Response.json({ error: '需要提供报价单文字或文件' }, { status: 400 });

    if (session_id) {
      session = await base44.entities.ChatSession.get(session_id);
    } else {
      session = await base44.entities.ChatSession.create({
        title: file_name ? file_name.replace(/\.[^.]+$/, '') : String(text || '报价识别').slice(0, 20),
        stage: 'recognizing',
      });
    }
    await base44.entities.ChatSession.update(session.id, { stage: 'recognizing' });
    const llmModel = session.llm_model === 'flash' ? 'flash' : 'pro';
    await appendMessage(base44, session.id, 'user', text ? String(text).slice(0, 2000) : '上传报价单', null, file_name || null);

    let content = '';
    let sourceType = 'text';
    if (file_url) {
      sourceType = 'file';
      const lowerName = String(file_name || '').toLowerCase();
      if (lowerName.endsWith('.doc') && !lowerName.endsWith('.docx')) {
        throw new Error('暂不支持旧版 .doc 格式，请另存为 .docx 或 PDF 后重试');
      }
      if (['.xlsx', '.xls', '.csv'].some((ext) => lowerName.endsWith(ext))) {
        content = await extractSpreadsheetText(file_url);
      } else if (lowerName.endsWith('.docx')) {
        content = await extractDocxText(file_url);
      } else {
        try {
          const ext = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
            file_url,
            json_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
          });
          if (!ext || ext.status !== 'success' || !ext.output) {
            throw new Error('文件解析失败：' + (ext && ext.details ? ext.details : '不支持的格式，可改为直接粘贴报价文字'));
          }
          const out = ext.output;
          if (Array.isArray(out)) {
            content = out.map((row) => Object.entries(row || {}).map(([k, v]) => k + ': ' + v).join('; ')).join('\n');
          } else if (out && typeof out === 'object' && out.content) {
            content = String(out.content);
          } else {
            content = JSON.stringify(out);
          }
        } catch (e) {
          try {
            content = await extractDocxText(file_url);
          } catch (_) {
            throw new Error('文件解析失败：' + (e.message || '不支持的格式，可改为直接粘贴报价文字'));
          }
        }
      }
    } else {
      content = String(text);
    }

    const corpus = await loadCorpus(base44);
    const maxChars = Number(secrets.get('MAX_CHUNK_CHARACTERS')) || 40000;
    const maxRows = Number(secrets.get('MAX_ROWS_PER_CHUNK')) || 40;
    // Flash：并行分块数固定 6（llm_concurrency）；其他模型沿用既有配置
    const workers = llmModel === 'flash' ? 6 : Math.max(1, Number(secrets.get('EXTRACTION_CHUNK_WORKERS')) || 3);
    const chunks = buildChunks(content, maxChars, maxRows);

    // 每个分块各自检索命中的知识条目与城市，缩短提示词、降低干扰
    const usedAll = [];
    const results = await runPool(chunks, workers, async (chunk, i) => {
      const { context: ctx, usedKnowledge } = await retrieveContext(corpus, chunk, { model: llmModel });
      usedAll.push(...usedKnowledge);
      const suffix = chunks.length > 1 ? '\n\n当前是第 ' + (i + 1) + '/' + chunks.length + ' 个分块，只提取本块内容，各块结果稍后会自动合并。' : '';
      return runChunkLlm(SYS + '\n\n' + ctx + suffix, chunk, 0, llmModel);
    });

    const merged = { supplier_name: '', title: '', unmatched_cities: [], transport: [], service: [] };
    for (const r of results.flat()) {
      if (!r) continue;
      if (!merged.supplier_name && r.supplier_name) merged.supplier_name = r.supplier_name;
      if (!merged.title && r.title) merged.title = r.title;
      merged.transport.push(...(r.transport || []));
      merged.service.push(...(r.service || []));
      merged.unmatched_cities.push(...(r.unmatched_cities || []));
    }
    if (!merged.transport.length && !merged.service.length) {
      throw new Error('未能从内容中识别出任何费用项，请确认内容是供应商报价单');
    }

    // 在代码中确定性复算未命中城市，不依赖模型自报
    for (const t of merged.transport) {
      for (const k of ['origin', 'destination']) {
        if (t[k] && !corpus.cityNames.has(t[k])) merged.unmatched_cities.push(t[k]);
      }
    }

    const quote = await base44.entities.SupplierQuote.create({
      session_id: session.id,
      supplier_name: merged.supplier_name || supplier_name || (file_name ? file_name.replace(/\.[^.]+$/, '') : '未识别供应商'),
      title: merged.title || '报价单',
      status: 'draft',
      source_type: sourceType,
      file_name: file_name || null,
      file_uri: file_uri || null,
      transport_fees: merged.transport,
      service_fees: merged.service,
      corrections: [],
      versions: [{ date: new Date().toISOString(), label: '原始识别', transport: merged.transport, service: merged.service }],
      calc_script: null,
      calc_runs: [],
      raw_text: content.slice(0, 30000),
      unmatched_cities: merged.unmatched_cities.filter(Boolean),
    });

    await base44.entities.ChatSession.update(session.id, {
      quote_id: quote.id,
      stage: 'awaiting_confirm',
      supplier_name: quote.supplier_name,
    });

    const lines = [
      '已完成识别：运输费 ' + merged.transport.length + ' 条线路（起终点已对齐城市节点库），服务费 ' + merged.service.length + ' 项为原文保存。',
    ];
    if (merged.unmatched_cities.filter(Boolean).length) {
      lines.push('注意：以下城市不在城市节点库中，建议先在「城市节点」页面补充后输入修正意见重新识别：' + merged.unmatched_cities.filter(Boolean).join('、'));
    }
    lines.push('请检查识别结果：确认无误请点击「确认无误，进入测算」，或直接在下方输入修正意见。');
    await appendMessage(base44, session.id, 'assistant', lines.join('\n'), [
      { type: 'recognition', data: { transport: merged.transport, service: merged.service } },
    ]);

    return Response.json({ session_id: session.id, quote_id: quote.id });
  } catch (error) {
    try {
      if (session && base44) {
        await base44.entities.ChatSession.update(session.id, { stage: 'idle' });
        await appendMessage(base44, session.id, 'assistant', '处理失败：' + error.message + '。请调整后重试。');
      }
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
}