import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { llmJson } from '../../shared/llm.ts';
import { loadCorpus, retrieveContext } from '../../shared/retrieval.ts';
import { appendMessage } from '../../shared/chat.ts';

const SYS = `你是物流报价工作台的助手，负责解答用户关于当前报价单内容的问题。只基于下方给出的报价单数据、原文与相关知识库条目回答，不要修改任何数据。
回答要求：
- 如知识库条目与问题相关（术语解释、计费规则），应引用其内容辅助解释。
- 用中文回答，简洁清晰，可用短列表。
- 如果用户问某项费用的描述怎么理解：先引用该项的原文，再按国际物流行业惯例解释该术语/条款的含义及可能的计费影响（如按什么条件触发、对哪些环节收费、换算关系与取整规则如何生效）。
- 如果报价单中没有相关信息，如实说明，不要编造。
- 不要提出修改建议，也不要执行或建议执行测算。
输出 JSON：{"answer":"给用户的完整回答","fee_name":"本次回答所针对的服务费名称，必须与服务费列表中的 name 完全一致；未针对任何一项具体服务费时为空字符串"}`;

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { session_id, feedback } = await req.json();
    if (!session_id || !feedback) return Response.json({ error: '需要 session_id 和 feedback' }, { status: 400 });

    const session = await base44.entities.ChatSession.get(session_id);
    if (!session.quote_id) return Response.json({ error: '该会话还没有报价单' }, { status: 400 });
    const quote = await base44.entities.SupplierQuote.get(session.quote_id);
    const llmModel = session.llm_model === 'flash' ? 'flash' : 'pro';

    const transport = (quote.transport_fees || []).slice(0, 20).map((x) =>
      JSON.stringify({ origin: x.origin, destination: x.destination, supplier: x.supplier, currency: x.currency, price: x.price, raw: String(x.raw || '').slice(0, 300) }));
    const services = (quote.service_fees || []).slice(0, 30).map((x) =>
      JSON.stringify({ name: x.name, raw: String(x.raw || '') }));

    const msgPage = await base44.entities.ChatMessage.filter({ session_id }, { sort: '-created_date', limit: 6 });
    const recent = (msgPage.items || []).reverse().map((m) =>
      (m.role === 'user' ? '用户：' : '助手：') + String(m.text || '').slice(0, 150));

    // 检索依据：用户提问 + 报价单服务费名称与原文
    const corpus = await loadCorpus(base44);
    const retrieveBasis = String(feedback) + '\n' + services.join('\n');
    const { context: knowledgeCtx, usedKnowledge } = await retrieveContext(corpus, retrieveBasis, { model: llmModel });

    const payload = [
      '报价单：' + (quote.supplier_name || '') + (quote.title ? ' / ' + quote.title : ''),
      '运输费数据：\n' + (transport.join('\n') || '（无）'),
      '服务费数据：\n' + (services.join('\n') || '（无）'),
      '相关知识库条目（术语映射与规则，可直接引用其中解释）：\n' + (knowledgeCtx || '（无）'),
      '报价单原文（截断）：\n' + String(quote.raw_text || '').slice(0, 4000),
      '最近对话：\n' + (recent.join('\n') || '（无）'),
      '用户问题：' + String(feedback).slice(0, 800),
    ].join('\n\n');

    const r = await llmJson(SYS, payload, 110000, llmModel);
    let answer = String((r && r.answer) || '').trim() || '抱歉，暂时无法回答该问题。';
    // 记录本次分析所针对的费用项，便于后续「将分析应用到描述」时精确引用
    const feeName = r && String(r.fee_name || '').trim();
    await appendMessage(base44, session_id, 'assistant', answer,
      feeName ? [{ type: 'analysis', data: { fee_name: feeName, answer } }] : []);
    return Response.json({ ok: true, answer });
  } catch (error) {
    return Response.json({ error: error && error.message ? error.message : String(error) }, { status: 500 });
  }
}