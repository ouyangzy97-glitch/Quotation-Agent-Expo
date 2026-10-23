import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { llmJson } from '../../shared/llm.ts';
import { appendMessage } from '../../shared/chat.ts';

// 各会话阶段允许路由到的操作（answer_question 在任何可反馈阶段都可用）
const STAGE_ACTIONS = {
  awaiting_confirm: ['correct_quote', 'calc', 'answer_question', 'distill_knowledge'],
  awaiting_apply: ['apply', 'correct_quote', 'answer_question', 'distill_knowledge'],
  calculated: ['update_script', 'regen_script', 'correct_quote', 'run_calc', 'answer_question', 'distill_knowledge'],
  done: ['update_script', 'regen_script', 'correct_quote', 'run_calc', 'answer_question', 'distill_knowledge'],
};

const STAGE_DESC = {
  idle: '待输入（还没有识别结果）',
  recognizing: '识别进行中',
  awaiting_confirm: '识别结果待确认（可确认进入测算，或提出修正意见）',
  awaiting_apply: '修改建议待确认（可应用建议，或提出新的修正意见）',
  calculating: '测算脚本生成中',
  calculated: '测算脚本已生成（可执行测算、修改识别数据或修改脚本）',
  done: '已完成测算并存档（可执行测算、修改识别数据或修改脚本）',
  clarifying: '上一次反馈意图不明，等待用户回答澄清问题',
};

const SYS = `你是物流报价工作台的意图路由器。根据会话阶段、报价单状态、最近对话和用户最新反馈，判断用户想做哪一类操作，只输出 JSON。
可用操作含义：
- correct_quote：修改报价单识别数据。指向识别内容本身的反馈都属于此类：某条线路价格不对、起终点城市写错、缺一条费用、多了一条、服务费名称或描述（含把分析/解释写入描述）有误、供应商名称或标题不对等。
- calc：确认识别结果无误并进入测算脚本生成。
- apply：应用已生成的修改建议（确认修改生效）。
- update_script：修改测算脚本/计价逻辑。指向"怎么算"的反馈都属于此类：公式、取大取小、最低收费、四舍五入、按重量还是体积、变量定义、币种换算、某项费用不应计入等。
- run_calc：执行测算，或要求用某些输入参数执行测算。
- regen_script：推倒重来，忽略现有脚本，从报价单原文从头重新生成一版全新的测算脚本。用户明确要求"重新生成/从头写/推倒重来"脚本时选此操作，而不是 update_script；若明确说明只针对运输费用，附 scope 为 "transport"，否则 scope 为 "all"。
- answer_question：用户在提问，想了解报价内容而不修改任何数据。例如询问某项服务费的描述怎么理解、某条款/术语是什么意思、某个字段的含义、当前报价包含哪些费用、某线路的价格是多少、测算脚本当前是怎么算的等。疑问句或"帮我解释/说明一下"且不包含修改诉求时选此操作。
- distill_knowledge：用户要求把本轮对话的反馈、经验或现有测算脚本整理沉淀为知识库条目（如"整理反馈注入知识库"、"将现有的计算脚本整理到知识库"）。
- clarify：无法可靠判断用户想做什么时使用。
判定原则：
- 先区分"操作"与"提问"：包含明确修改动作或确认指令的按对应操作处理；单纯询问含义、解释、查询数据内容的选 answer_question。
- 优先看反馈指向的对象：指向识别数据的内容（哪条线路、哪个价格、哪条费用描述）→ correct_quote；指向计算方式（怎么算、按什么规则取值）→ update_script。
- 例如"把上海到汉堡的体积价改成118"是改识别数据；"体积价和重量价改成只按体积算"是改脚本；"按重量1000kg算一下"是执行测算。
- 结合最近对话理解指代（如"刚才那条""第二条线路"）。
- 只允许在下方给出的可选项中选择；都不合适或拿不准时选 clarify。
- needs_knowledge：本次操作是否需要知识库依据。仅当操作为 correct_quote/update_script 且反馈涉及术语含义、计费规则、取值或换算逻辑（如取大取小、最低收费、四舍五入、按重量还是体积、币种换算）或费用描述的理解时为 true；删除/新增条目、直接修改价格/城市/名称等字段值、执行测算、重新生成脚本、应用建议、确认操作一律为 false。
输出 JSON：{"action":"可选项之一","needs_knowledge":true或false,"clarify_question":"当且仅当 action 为 clarify 时，用一句简短的中文开放问题询问用户具体想做什么，不要给出固定选项，不要重复罗列操作"}`;

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { session_id, feedback } = await req.json();
    if (!session_id || !feedback) return Response.json({ error: '需要 session_id 和 feedback' }, { status: 400 });

    const session = await base44.entities.ChatSession.get(session_id);
    const quote = session.quote_id
      ? await base44.entities.SupplierQuote.get(session.quote_id).catch(() => null)
      : null;
    const llmModel = session.llm_model === 'flash' ? 'flash' : 'pro';

    // 会话还没有报价单：直接进入识别流程，无需判断
    if (!quote) return Response.json({ action: 'parse' });

    const t = String(feedback).trim();

    // 确定性快捷路由：明确的确认指令直接命中，避免额外等待
    if (session.stage === 'awaiting_confirm' && /确认无误|无误|进入测算|没有问题|没问题|^确认$|^同意$/.test(t)) {
      return Response.json({ action: 'calc' });
    }
    if (session.stage === 'awaiting_apply' && /确认修改|同意修改|^确认$|^同意$/.test(t)) {
      return Response.json({ action: 'apply' });
    }

    // 澄清中：以用户对澄清问题的回答为准，重新在原阶段的选项内判断
    const pending = session.pending_intent || null;
    const baseStage = session.stage === 'clarifying' && pending && pending.stage
      ? pending.stage
      : session.stage;
    const allowed = STAGE_ACTIONS[baseStage] || STAGE_ACTIONS.calculated;

    // 确定性快捷路由：要求推倒重来、从头重新生成脚本时，直接走重新生成，不当作脚本微调
    const combined = t + (pending ? ' ' + String(pending.feedback || '') : '');
    if ((baseStage === 'calculated' || baseStage === 'done')
      && /重新生成|重新识别|重新写|从头|推倒|重做/.test(combined) && /脚本|测算/.test(combined)) {
      if (session.stage === 'clarifying') {
        await base44.entities.ChatSession.update(session_id, { stage: baseStage, pending_intent: null });
      }
      return Response.json({
        action: 'regen_script',
        needs_knowledge: false,
        scope: /运输/.test(combined) ? 'transport' : 'all',
      });
    }

    if (session.stage !== 'clarifying' && session.stage !== 'done' && session.stage !== 'calculated'
      && session.stage !== 'awaiting_confirm' && session.stage !== 'awaiting_apply') {
      // 识别/测算进行中等瞬态阶段不接受反馈
      return Response.json({ action: 'none' });
    }

    // 确定性快捷路由：要求把对话反馈/测算脚本整理进知识库
    if (/整理|沉淀|注入|归档/.test(t) && /知识/.test(t)) {
      if (session.stage === 'clarifying') {
        await base44.entities.ChatSession.update(session_id, { stage: baseStage, pending_intent: null });
      }
      return Response.json({ action: 'distill_knowledge', needs_knowledge: false });
    }

    // 上下文：报价摘要 + 最近对话
    const msgPage = await base44.entities.ChatMessage.filter({ session_id }, { sort: '-created_date', limit: 8 });
    const recent = (msgPage.items || []).reverse().map((m) =>
      (m.role === 'user' ? '用户：' : '助手：') + String(m.text || '').slice(0, 200));

    const quoteSummary = {
      supplier: quote.supplier_name,
      title: quote.title,
      status: quote.status,
      transport_routes: (quote.transport_fees || []).map((x) =>
        [x.origin, x.destination].filter(Boolean).join('→') || (x.raw || '').slice(0, 40)).slice(0, 10),
      service_fees: (quote.service_fees || []).map((x) => x.name).filter(Boolean).slice(0, 20),
      has_calc_script: !!quote.calc_script,
      has_pending_changes: !!quote.pending_changes,
    };

    const payload = [
      '会话阶段：' + baseStage + '（' + (STAGE_DESC[baseStage] || baseStage) + '）',
      '本次允许的操作：' + allowed.join('、') + '，以及拿不准时的 clarify。',
      '报价单摘要：' + JSON.stringify(quoteSummary),
      pending ? '此前未澄清的反馈：' + String(pending.feedback || '').slice(0, 500) : '',
      pending && Array.isArray(pending.history) && pending.history.length
        ? '此前澄清记录：' + pending.history.join(' | ').slice(0, 400) : '',
      '最近对话：\n' + (recent.join('\n') || '（无）'),
      '用户最新反馈：' + t,
    ].filter(Boolean).join('\n\n');

    const r = await llmJson(SYS, payload, 110000, llmModel);
    let action = r && r.action;

    // 合并原始反馈与澄清回答，作为后续操作的完整依据
    const mergedFeedback = pending ? String(pending.feedback || '') + '\n（澄清回答：' + t + '）' : t;

    // 澄清中的回答若仍不明确，继续追问（合并原始反馈，最多自然收敛）
    if (action === 'clarify' || !allowed.includes(action)) {
      const question = (r && r.clarify_question) || '请问你想修改报价识别数据，还是调整测算脚本，或是执行测算？请补充说明。';
      const history = [...((pending && pending.history) || []), t].slice(-3);
      await base44.entities.ChatSession.update(session_id, {
        stage: 'clarifying',
        pending_intent: { stage: baseStage, feedback: mergedFeedback.slice(0, 2000), history },
      });
      await appendMessage(base44, session_id, 'assistant', question);
      return Response.json({ action: 'clarify' });
    }

    // 已解析出明确意图：恢复原阶段并清除待澄清状态，并把合并后的完整反馈交给后续流程
    if (session.stage === 'clarifying') {
      await base44.entities.ChatSession.update(session_id, { stage: baseStage, pending_intent: null });
    }
    return Response.json({
      action,
      needs_knowledge: !!(r && r.needs_knowledge),
      feedback: mergedFeedback,
      scope: r && r.scope === 'transport' ? 'transport' : 'all',
    });
  } catch (error) {
    return Response.json({ error: error && error.message ? error.message : String(error) }, { status: 500 });
  }
}