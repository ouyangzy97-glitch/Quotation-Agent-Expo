import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { llmJson } from '../../shared/llm.ts';
import { loadCorpus, retrieveContext } from '../../shared/retrieval.ts';
import { evalProgram } from '../../shared/calc.ts';
import { appendMessage } from '../../shared/chat.ts';

const COMMON_RULES = `
规则：
- 每个脚本的 variables 只声明该脚本自身需要的业务输入变量；同一业务量在不同脚本中必须使用相同变量名（如重量统一 weight_kg、体积统一 volume_cbm），系统会自动把各脚本变量合并去重为统一输入表单。
- 每个脚本的 program 至少包含一个 item:true 的费用项步骤（label 中文费用名、currency 币种、desc 一句话中文计费规则说明），可按需增加非 item 中间步骤；步骤按依赖顺序排列，后面可引用前面步骤名；不要生成"合计/总计"步骤，合计由系统按币种自动计算。
- 每个脚本的 test_input 必须覆盖其全部变量。
- expr 表达式沙箱规则（违反会直接报错）：只能使用数字、+ - * /、括号、函数 max/min/round(x,小数位)/abs/floor/ceil、input.变量名，以及引用更早步骤的步骤名；每个 expr 必须输出一个有限数值；不得出现循环、条件分支、字符串或注释。
- 原文规则中的"取大/取小"、"最低收费"、"四舍五入"都必须在表达式中体现。
- 如果某项费用只是固定金额（原文中已给出金额与计价单位），variables 可以为空数组，expr 直接写固定数字。
- 若知识库中提供了相关的「计费逻辑」条目（含计费规则说明、变量与表达式），必须遵循其计费规则与表达式形式，并沿用其变量命名；费率等数值仍取报价单原文。`;

const SYS_GROUPING = `你是物流计费规则分析专家。下面是一份报价单的全部运输线路条目。请把计费逻辑完全相同的线路归为一组，组内线路将共用一个测算脚本，线路间的费率等数值差异作为每条线路的参数单独保存。
输出 JSON：
{
  "groups": [
    {"name": "简短中文组名，体现共用计费规则", "logic_desc": "一句话描述该组共用计费逻辑（计价维度、取大/取小、最低收费等）", "route_indexes": [0, 2]}
  ]
}
规则：
- 分组只看计费逻辑是否完全一致：计价维度、单位换算、取大/取小、最低收费、阶梯或附加条件；价格金额、币种、供应商不同不影响分组（这些作为线路参数）。
- 保守原则：只要不能确定两条线路的计费规则完全相同，就分成两组；宁可多组，绝不错并。
- 每条线路必须恰好属于一组，route_indexes 使用给定条目的 index；不要遗漏，也不要虚构线路。`;

const SYS_TRANSPORT_GROUPS = `你是物流费用计算脚本生成器。下面给出若干「计费规则组」，同组线路共用一个脚本，各线路之间的数值差异通过线路参数（params）提供。
输出 JSON：
{
  "groups": [
    {
      "name": "与给定组名完全一致",
      "code": "与 program 逻辑完全一致的 JS 源码，形如 function calculate(input) { ... return { ... } }，用于存档备查",
      "variables": [{"name": "weight_kg", "label": "货物重量", "unit": "kg", "description": "用于重量计费的货物毛重", "required": true, "default": 1000}],
      "program": [{"name": "ocean_freight", "expr": "max(input.weight_kg / 1000 * input.weight_price, input.volume_cbm * input.volume_price)", "item": true, "label": "海运费", "currency": "USD", "desc": "重量价与体积价取大"}, {"name": "weight_tons", "expr": "input.weight_kg / 1000"}],
      "test_input": {"weight_kg": 1000, "weight_price": 40, "volume_price": 30},
      "routes": [
        {"name": "与给定线路名完全一致", "params": {"weight_price": 40, "volume_price": 30}}
      ]
    }
  ]
}
${COMMON_RULES}
- 脚本中把组内线路存在差异的数值（各费率、最低收费、附加费等）声明为 variables 的一部分并在 expr 中用 input.变量名 引用；各线路的这些数值全部通过 params 提供，不要硬编码在 expr 中。
- params 的键必须是该组 variables 中已声明的变量名，值必须是原文中该线路的真实数值；即使组内某些数值完全相同，也必须写入每条线路的 params。
- routes 中每条线路的 name 必须与给定线路名完全一致，不要遗漏任何一条。`;

const SYS_SERVICES = `你是物流费用计算脚本生成器。请为下面列出的每一个服务费项目各生成一个独立脚本（name 必须与给定名称完全一致，不要遗漏，也不要增加给定列表之外的脚本）。同一服务费若含多项子费用，可在其 program 中放多个 item 步骤。
输出 JSON：
{
  "services": [
    {"name": "报关费", "code": "function calculate(input) { ... }", "variables": [{"name": "declaration_count", "label": "报关票数", "unit": "票", "description": "需报关的票数", "required": true, "default": 1}], "program": [{"name": "customs_fee", "expr": "input.declaration_count * 300", "item": true, "label": "报关费", "currency": "CNY", "desc": "每票 300 元"}], "test_input": {"declaration_count": 1}}
  ]
}
${COMMON_RULES}`;

const SERVICE_BATCH_SIZE = 4;
const GROUP_BATCH_SIZE = 3;

export default async function(req) {
  const base44 = createClientFromRequest(req);
  return handler(req, base44);
}

async function handler(req, base44) {
  let session_id = null;
  let restoreStage = 'awaiting_confirm';
  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    session_id = body.session_id;
    if (!session_id) return Response.json({ error: '需要 session_id' }, { status: 400 });

    const session = await base44.entities.ChatSession.get(session_id);
    if (!session.quote_id) return Response.json({ error: '该会话还没有识别结果' }, { status: 400 });
    const quote = await base44.entities.SupplierQuote.get(session.quote_id);
    const llmModel = session.llm_model === 'flash' ? 'flash' : 'pro';

    // scope=transport：只重新生成运输脚本组，服务费脚本保持不变
    let scope = body.scope === 'transport' ? 'transport' : 'all';
    const prevCalc = quote.calc_script || null;
    if (scope === 'transport' && !(prevCalc && (Array.isArray(prevCalc.transport_groups) || Array.isArray(prevCalc.transport_scripts)))) scope = 'all';
    restoreStage = scope === 'transport' || prevCalc ? 'calculated' : 'awaiting_confirm';

    await base44.entities.ChatSession.update(session_id, { stage: 'calculating' });

    const transportFees = quote.transport_fees || [];
    const serviceFees = (quote.service_fees || []).filter((s) => s && s.name);
    if (!transportFees.length && !serviceFees.length) throw new Error('报价单中没有可测算的费用条目');

    // 按报价内容检索知识库，辅助生成更准确的计费逻辑
    const corpus = await loadCorpus(base44);
    const { context: knowledgeCtx } = await retrieveContext(
      corpus,
      JSON.stringify({ transport: transportFees, service: serviceFees }),
      { model: llmModel }
    );
    const knowledgeSuffix = '\n\n' + knowledgeCtx;

    // 线路唯一名称（含供应商等去重后缀）
    const routeLabels = [];
    const usedRouteNames = new Set();
    for (const t of transportFees) {
      let label = [t.origin, t.destination].filter(Boolean).join(' → ') || '线路';
      if (t.supplier) label += ' · ' + t.supplier;
      if (usedRouteNames.has(label)) label += ' #' + (routeLabels.length + 1);
      usedRouteNames.add(label);
      routeLabels.push(label);
    }
    // 精简提示词：原文只保留关键片段，避免推理模型处理超长上下文
    const routePayload = transportFees.map((t, i) => ({
      index: i,
      name: routeLabels[i],
      fee: { ...t, raw: String(t.raw || '').slice(0, 600) },
    }));

    // 1) 计费规则分组（保守拆分）：无法确认相同即单独成组；分组失败时每条线路单独成组
    let rawGroups = null;
    if (transportFees.length) {
      try {
        const g = await llmJson(
          SYS_GROUPING + knowledgeSuffix,
          '运输线路条目：\n' + JSON.stringify(routePayload, null, 1),
          240000,
          llmModel
        );
        rawGroups = Array.isArray(g && g.groups) ? g.groups : null;
      } catch { rawGroups = null; }
    }
    const groupDefs = [];
    const assigned = new Set();
    for (const grp of rawGroups || []) {
      const idxs = (grp && Array.isArray(grp.route_indexes) ? grp.route_indexes : [])
        .map(Number)
        .filter((i) => Number.isInteger(i) && i >= 0 && i < transportFees.length && !assigned.has(i));
      if (!idxs.length || !grp.name) continue;
      idxs.forEach((i) => assigned.add(i));
      groupDefs.push({
        name: String(grp.name).slice(0, 60),
        logic_desc: String(grp.logic_desc || '').slice(0, 500),
        routes: idxs,
      });
    }
    // 保守兜底：未被任何组覆盖的线路单独成组
    for (let i = 0; i < transportFees.length; i++) {
      if (!assigned.has(i)) groupDefs.push({ name: '线路规则 · ' + routeLabels[i], logic_desc: '', routes: [i] });
    }

    // 2) 各组共用脚本 + 线路参数（分批并行） & 服务费脚本
    const gBatches = [];
    for (let i = 0; i < groupDefs.length; i += GROUP_BATCH_SIZE) gBatches.push(groupDefs.slice(i, i + GROUP_BATCH_SIZE));
    const sBatches = [];
    if (scope === 'all') {
      for (let i = 0; i < serviceFees.length; i += SERVICE_BATCH_SIZE) sBatches.push(serviceFees.slice(i, i + SERVICE_BATCH_SIZE));
    }
    const tasks = [
      ...gBatches.map((batch) =>
        llmJson(
          SYS_TRANSPORT_GROUPS + knowledgeSuffix,
          '请为以下计费规则组各生成一个共用脚本，并为组内每条线路从原文提取 params：\n' + JSON.stringify(
            batch.map((grp) => ({
              name: grp.name,
              logic_desc: grp.logic_desc,
              routes: grp.routes.map((i) => ({ name: routeLabels[i], fee: transportFees[i] })),
            })),
            null,
            1
          ),
          240000,
          llmModel
        )
      ),
      ...sBatches.map((batch) =>
        llmJson(SYS_SERVICES + knowledgeSuffix, '请为以下服务费各生成一个脚本：\n' + JSON.stringify(batch, null, 1), 240000, llmModel)
      ),
    ];
    const results = await Promise.all(tasks);

    const retGroups = results.slice(0, gBatches.length)
      .flatMap((r) => (Array.isArray(r && r.groups) ? r.groups : []));
    if (transportFees.length && !retGroups.length) {
      throw new Error('生成的运输费用脚本为空');
    }
    const retMap = new Map();
    for (const g of retGroups) if (g && g.name) retMap.set(String(g.name).trim(), g);

    const now = new Date().toISOString();
    const packScript = (s) => ({
      code: s.code || '',
      variables: s.variables || [],
      program: s.program,
      test_input: s.test_input || {},
    });

    const packedGroups = [];
    for (const grp of groupDefs) {
      const g = retMap.get(grp.name) || retMap.get(grp.name.trim());
      if (!g || !Array.isArray(g.program) || !g.program.length) {
        throw new Error('脚本组「' + grp.name + '」生成失败或为空');
      }
      const script = packScript(g);
      try {
        evalProgram(g.program, script.test_input || {});
      } catch (e) {
        throw new Error('脚本组「' + grp.name + '」验证失败：' + e.message);
      }
      const varNames = new Set((script.variables || []).map((v) => v && v.name));
      const routes = grp.routes.map((i) => {
        const r = (Array.isArray(g.routes) ? g.routes : []).find((x) => x && x.name === routeLabels[i]);
        const params = (r && r.params) || {};
        for (const k of Object.keys(params)) {
          if (!varNames.has(k)) throw new Error('线路「' + routeLabels[i] + '」的参数 ' + k + ' 不是该组脚本变量');
        }
        // 保守原则：多条线路共用脚本时，每条线路必须提供线路参数，否则中止而非错并
        if (grp.routes.length > 1 && !Object.keys(params).length) {
          throw new Error('线路「' + routeLabels[i] + '」缺少线路参数，无法与其他线路共用脚本，请重试或修正报价描述');
        }
        try {
          evalProgram(g.program, { ...(script.test_input || {}), ...params });
        } catch (e) {
          throw new Error('线路「' + routeLabels[i] + '」参数验证失败：' + e.message);
        }
        return { name: routeLabels[i], enabled: true, params };
      });
      packedGroups.push({
        name: (String(g.name || grp.name).trim().slice(0, 60)) || grp.name,
        logic_desc: grp.logic_desc,
        enabled: true,
        script,
        versions: [{ version: 1, date: now, label: '初始版本', feedback: '', script }],
        routes,
      });
    }

    // scope=transport：服务费脚本原样保留（含启用状态与历史版本）
    const keepServices = scope === 'transport'
      ? (prevCalc.services || []).map((s) => JSON.parse(JSON.stringify(s)))
      : null;
    const rawServices = results.slice(gBatches.length)
      .flatMap((r2) => (Array.isArray(r2 && r2.services) ? r2.services : []));
    const nameSet = new Set(serviceFees.map((s) => s.name));
    const services = rawServices.filter((s) => s && s.name);
    const packed = scope === 'transport'
      ? keepServices
      : (() => {
          const out = [];
          for (const s of services) {
            if (!nameSet.has(s.name)) continue; // 过滤模型臆造的服务
            if (!Array.isArray(s.program) || !s.program.length) continue;
            try {
              evalProgram(s.program, s.test_input || {});
            } catch (e) {
              throw new Error('服务「' + s.name + '」脚本验证失败：' + e.message);
            }
            const script = packScript(s);
            out.push({
              name: s.name,
              enabled: true,
              script,
              versions: [{ version: 1, date: now, label: '初始版本', feedback: '', script }],
            });
          }
          return out;
        })();
    if (!packedGroups.length && !packed.length) {
      throw new Error('生成的测算脚本为空');
    }

    const version = scope === 'transport' ? (prevCalc.version || 1) + 1 : 1;
    const scriptSnapshot = { format: 'per_service', transport: null, transport_groups: packedGroups, transport_scripts: [], services: packed };
    const versionEntry = {
      version,
      date: now,
      label: scope === 'transport' ? '版本 ' + version : '初始版本',
      feedback: scope === 'transport' ? '重新生成运输费用脚本' : '',
      script: scriptSnapshot,
    };
    const calcScript = { format: 'per_service', version, transport: null, transport_groups: packedGroups, transport_scripts: [], services: packed };
    await base44.entities.SupplierQuote.update(quote.id, {
      status: 'calculated',
      calc_script: calcScript,
      calc_script_versions: scope === 'transport'
        ? [...(quote.calc_script_versions || []), versionEntry]
        : [versionEntry],
    });
    await base44.entities.ChatSession.update(session_id, { stage: 'calculated' });

    // 卡片汇总：各脚本的费用项，变量合并去重
    const items = [];
    for (const t of packedGroups) items.push(...t.script.program.filter((p) => p && p.item));
    for (const s of packed) items.push(...s.script.program.filter((p) => p && p.item));
    const mergedVars = [];
    const seen = new Set();
    const varSources = [...packedGroups.map((t) => t.script), ...packed.map((s) => s.script)];
    for (const sc of varSources) {
      for (const v of sc.variables || []) {
        if (v && v.name && !seen.has(v.name)) { seen.add(v.name); mergedVars.push(v); }
      }
    }

    const routeCount = packedGroups.reduce((n, g) => n + g.routes.length, 0);
    const transportPart = routeCount
      ? routeCount + ' 条运输线路按计费规则归为 ' + packedGroups.length + ' 类共用脚本（线路费率等差异保存为线路参数）'
      : '';
    const summary = [transportPart, packed.length ? packed.length + ' 个服务脚本' : '']
      .filter(Boolean)
      .join('，另有 ');
    const doneText = scope === 'transport'
      ? '已重新生成运输脚本（整体第 ' + version + ' 版）：' + summary + '，原服务费脚本保持不变，全部脚本与线路参数已在沙箱验证通过。点击卡片打开测算面板，选择线路即可查看对应脚本与计费逻辑：'
      : '已生成测算代码：' + summary + '，已在沙箱中逐个验证通过。点击卡片打开测算面板，选择线路即可查看对应脚本与计费逻辑，录入参数后可执行测算并存档：';
    await appendMessage(base44, session_id, 'assistant', doneText,
      [{ type: 'script', data: { verified: true, variables: mergedVars, items, version } }]);
    return Response.json({ ok: true });
  } catch (error) {
    // 失败时恢复会话状态，并把错误写进对话流，避免界面卡在「测算中」无任何反应
    if (session_id) {
      try {
        await base44.entities.ChatSession.update(session_id, { stage: restoreStage });
        await appendMessage(base44, session_id, 'assistant',
          '测算脚本生成失败：' + (error && error.message ? error.message : '未知错误') + '。会话已恢复原状态，请稍后重试；若多次失败，请检查费用描述是否过长或稍后再试。');
      } catch { /* 状态恢复失败时静默处理 */ }
    }
    return Response.json({ error: error && error.message ? error.message : String(error) }, { status: 500 });
  }
}