import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { llmJson } from '../../shared/llm.ts';
import { loadCorpus, retrieveContext, isStructuralFeedback } from '../../shared/retrieval.ts';
import { evalProgram, outputLines } from '../../shared/calc.ts';
import { appendMessage } from '../../shared/chat.ts';

const SYS = `你是物流费用计算脚本修改专家。现有测算按脚本组织：每条运输线路一个独立脚本 + 每个服务费各一个独立脚本。专家提出反馈，请判断哪些脚本需要修改，并直接输出修改后的脚本（无需确认、直接生效）。
输出 JSON：
{
  "changed_transport": {"code":"...","variables":[...],"program":[...],"test_input":{...}} 或 null（仅当现有测算为旧版单运输费脚本时使用；按线路的多脚本结构一律用 updated_transports）,
  "updated_transports": [{"name":"上海 → 汉堡 · ABC","code":"...","variables":[...],"program":[...],"test_input":{...}}],
  "updated_services": [{"name":"报关费","code":"...","variables":[...],"program":[...],"test_input":{...}}],
  "removed_services": ["服务名"],
  "removed_transports": ["线路名"]
}
规则：
- changed_transport / updated_transports / updated_services 只输出被本次反馈影响的脚本；未受影响的脚本一律不要输出，保持原样。
- updated_transports 中的 name 必须与现有线路脚本名称完全一致；若反馈要求新增某条线路的脚本，name 按「起点 → 终点」（有供应商加 · 供应商）命名，系统会自动追加并默认启用。
- updated_services 中的 name 必须与现有服务费脚本名称一致；若反馈要求新增服务脚本，则 name 为新服务名，系统会自动追加并默认启用。
- removed_services 列出需要删除的服务脚本名称；removed_transports 列出需要删除的线路脚本名称。
- 修改脚本时保持该脚本内无关步骤与变量不变；同一业务量在不同脚本中保持相同变量名（系统会合并去重为统一输入表单）。
- program 中 item:true 为费用项步骤（label 中文费用名、currency 币种、desc 一句话计费规则说明），不要生成"合计/总计"步骤；每个脚本的 test_input 必须覆盖其全部变量。
- 表达式沙箱规则（违反会直接报错）：只能使用数字、+ - * /、括号、函数 max/min/round(x,小数位)/abs/floor/ceil、input.变量名，以及引用更早步骤的步骤名；不得出现循环、条件分支、字符串或注释。`;

const SYS_GROUPS = `你是物流费用计算脚本修改专家。现有运输费测算按「计费规则组」组织：同组线路共用一个脚本（计费逻辑），各线路的费率等数值差异保存在该线路的 params 参数中。专家提出反馈，请判断需要修改的是计费逻辑（脚本）还是某条线路的参数，并直接输出修改内容（无需确认、直接生效）。
输出 JSON：
{
  "updated_groups": [{"name":"组名","code":"...","variables":[...],"program":[...],"test_input":{...}}],
  "updated_params": [{"group":"组名","route":"线路名","params":{"费率变量名": 新数值}}],
  "added_routes": [{"group":"组名","name":"起点 → 终点 · 供应商","params":{"费率变量名": 数值}}],
  "removed_routes": ["线路名"],
  "updated_services": [{"name":"报关费","code":"...","variables":[...],"program":[...],"test_input":{...}}],
  "removed_services": ["服务名"]
}
规则：
- 反馈只涉及某条线路的价格/费率数值时用 updated_params，不要改动该组脚本；涉及多条线路的不同费率变化时逐条列出。
- 反馈改变计费规则本身（如取大改取小、增加最低收费、改变单位换算）时用 updated_groups，修改会影响该组全部线路，请在回复文本中说明。
- params 的键必须是该组脚本 variables 中已有的变量名（当前脚本结构已列出），不要发明新变量名。
- 新增线路时归入计费规则最匹配的组，params 必须覆盖该组脚本中全部费率类变量；若没有合适的组，请在 updated_groups 中新建该组。
- updated_groups / updated_services / removed_* 只输出受本次反馈影响的部分；未受影响的一律不要输出，保持原样。
- updated_services 的 name 必须与现有服务脚本名称一致；新增服务脚本时 name 为新服务名，系统会自动追加并默认启用。
- program 中 item:true 为费用项步骤（label 中文费用名、currency 币种、desc 一句话计费规则说明），不要生成"合计/总计"步骤；test_input 必须覆盖全部变量；修改脚本时保持无关步骤与变量不变，同一业务量保持相同变量名。
- 表达式沙箱规则（违反会直接报错）：只能使用数字、+ - * /、括号、函数 max/min/round(x,小数位)/abs/floor/ceil、input.变量名，以及引用更早步骤的步骤名；不得出现循环、条件分支、字符串或注释。`;

export default async function(req) {
  let session_id = null;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    session_id = body.session_id;
    const { feedback, needs_knowledge } = body;
    if (!session_id || !feedback) return Response.json({ error: '需要 session_id 和 feedback' }, { status: 400 });

    const session = await base44.entities.ChatSession.get(session_id);
    if (!session.quote_id) return Response.json({ error: '该会话还没有报价单' }, { status: 400 });
    const quote = await base44.entities.SupplierQuote.get(session.quote_id);
    const llmModel = session.llm_model === 'flash' ? 'flash' : 'pro';
    const cs = quote.calc_script;
    if (!cs) return Response.json({ error: '尚未生成测算脚本' }, { status: 400 });

    // 按任务判断是否检索知识库：结构性操作（如删除某服务脚本）不检索；
    // 是否涉及计费逻辑由意图路由判定（needs_knowledge），未经路由时默认检索
    const corpus = await loadCorpus(base44);
    const skipRetrieval = isStructuralFeedback(feedback) || needs_knowledge === false;
    const { context: knowledgeCtx } = skipRetrieval
      ? { context: '' }
      : await retrieveContext(
          corpus,
          feedback + '\n' + JSON.stringify({ transport: quote.transport_fees || [], service: quote.service_fees || [] }),
          { model: llmModel }
        );

    // 旧版单脚本格式：保持原有整体脚本行为
    if (Array.isArray(cs.program)) {
      const cur = cs;
      if (!Array.isArray(cur.program) || !cur.program.length) {
        return Response.json({ error: '尚未生成测算脚本' }, { status: 400 });
      }
      const userMsg = '当前测算脚本：\n' + JSON.stringify({
        script_code: cur.code,
        variables: cur.variables || [],
        program: cur.program,
        test_input: cur.test_input || {},
      }, null, 1)
        + '\n\n报价单数据（raw 为原文规则）：\n' + JSON.stringify({ transport: quote.transport_fees, service: quote.service_fees }, null, 1)
        + '\n\n专家反馈：\n' + feedback
        + '\n\n' + knowledgeCtx;
      const r = await llmJson(SYS_LEGACY(), userMsg, 110000, llmModel);
      if (!r || !Array.isArray(r.program) || !r.program.length) throw new Error('生成的新版脚本为空');

      const testInput = { ...(cur.test_input || {}), ...(r.test_input || {}) };
      const testOutput = evalProgram(r.program, testInput);
      const lines = outputLines(r.program, testOutput);

      const versions = [...(quote.calc_script_versions || [])];
      const nextVersion = versions.length + 1;
      const script = {
        code: r.script_code || '',
        variables: r.variables || [],
        program: r.program,
        test_input: testInput,
        version: nextVersion,
      };
      versions.push({
        version: nextVersion,
        date: new Date().toISOString(),
        label: '版本 ' + nextVersion,
        feedback: String(feedback).slice(0, 1000),
        script: { code: script.code, variables: script.variables, program: script.program, test_input: script.test_input },
      });

      await base44.entities.SupplierQuote.update(quote.id, {
        calc_script: script,
        calc_script_versions: versions,
        status: 'calculated',
      });
      await base44.entities.ChatSession.update(session_id, { stage: 'calculated' });

      await appendMessage(base44, session_id, 'assistant',
        '已根据反馈更新测算脚本（第 ' + nextVersion + ' 版），旧版脚本与测算记录已保留。点击卡片打开测算面板，录入变量即可重新测算：',
        [{ type: 'script', data: { verified: true, code: script.code, inputs: script.test_input, output: lines, variables: script.variables, items: script.program.filter((p) => p && p.item), version: nextVersion } }]);
      return Response.json({ ok: true, version: nextVersion });
    }

    // 计费规则组格式：同组线路共用脚本，线路差异为 params 参数
    if (Array.isArray(cs.transport_groups) && cs.transport_groups.length) {
      const now = new Date().toISOString();
      const packScript = (s) => ({
        code: s.code || '',
        variables: s.variables || [],
        program: s.program,
        test_input: s.test_input || {},
      });
      const userMsg = '当前脚本结构（transport_groups 为计费规则组：同组线路共用 script，各线路的费率等数值差异在 routes[].params 中）：\n'
        + JSON.stringify({
            transport_groups: (cs.transport_groups || []).map((g) => ({
              name: g.name,
              logic_desc: g.logic_desc,
              script: g.script,
              routes: (g.routes || []).map((rt) => ({ name: rt.name, params: rt.params })),
            })),
            services: (cs.services || []).map((s) => ({ name: s.name, enabled: s.enabled, script: s.script })),
          }, null, 1)
        + '\n\n报价单数据（raw 为原文规则）：\n' + JSON.stringify({ transport: quote.transport_fees, service: quote.service_fees }, null, 1)
        + '\n\n专家反馈：\n' + feedback
        + '\n\n' + knowledgeCtx;
      const r = await llmJson(SYS_GROUPS, userMsg, 110000, llmModel);
      const updatedGroups = ((r && Array.isArray(r.updated_groups)) ? r.updated_groups : []).filter((g) => g && g.name);
      const updatedParams = ((r && Array.isArray(r.updated_params)) ? r.updated_params : []).filter((p) => p && p.group && p.route);
      const addedRoutes = ((r && Array.isArray(r.added_routes)) ? r.added_routes : []).filter((x) => x && x.group && x.name);
      const removedRoutes = ((r && Array.isArray(r.removed_routes)) ? r.removed_routes : []);
      const updatedServices = ((r && Array.isArray(r.updated_services)) ? r.updated_services : []).filter((s) => s && s.name);
      const removed = ((r && Array.isArray(r.removed_services)) ? r.removed_services : []);
      if (!updatedGroups.length && !updatedParams.length && !addedRoutes.length && !removedRoutes.length && !updatedServices.length && !removed.length) {
        throw new Error('未识别出需要修改的内容，请更具体描述要修改的线路、费率或计费规则');
      }

      let groups = (cs.transport_groups || []).map((g) => JSON.parse(JSON.stringify(g)));
      const changedNames = [];
      const unifiedVersion = (cs.version || 1) + 1;

      // 计费逻辑变化：整组替换脚本，并重新验证组内每条线路参数仍然适用
      for (const ug of updatedGroups) {
        const g = groups.find((x) => x.name === ug.name);
        if (!g) throw new Error('未找到脚本组「' + ug.name + '」');
        if (!Array.isArray(ug.program) || !ug.program.length) throw new Error('脚本组「' + ug.name + '」的新脚本为空');
        const script = packScript(ug);
        try {
          evalProgram(ug.program, script.test_input || {});
        } catch (e) {
          throw new Error('脚本组「' + ug.name + '」验证失败：' + e.message);
        }
        const varNames = new Set((script.variables || []).map((v) => v && v.name));
        for (const rt of g.routes || []) {
          for (const k of Object.keys(rt.params || {})) {
            if (!varNames.has(k)) throw new Error('新脚本缺少线路参数变量 ' + k + '（线路「' + rt.name + '」）');
          }
          try {
            evalProgram(ug.program, { ...(script.test_input || {}), ...(rt.params || {}) });
          } catch (e) {
            throw new Error('线路「' + rt.name + '」与新脚本不匹配：' + e.message);
          }
        }
        const pv = (g.versions || []).length + 1;
        g.script = script;
        g.versions = [...(g.versions || []), { version: pv, date: now, label: '版本 ' + pv, feedback: String(feedback).slice(0, 1000), script }];
        changedNames.push('脚本组「' + g.name + '」（影响 ' + (g.routes || []).length + ' 条线路）');
      }

      // 仅某条线路费率变化：更新该线路 params，不动脚本
      for (const up of updatedParams) {
        const g = groups.find((x) => x.name === up.group);
        if (!g) throw new Error('未找到脚本组「' + up.group + '」');
        const rt = (g.routes || []).find((x) => x.name === up.route);
        if (!rt) throw new Error('未找到线路「' + up.route + '」');
        const varNames = new Set((g.script.variables || []).map((v) => v && v.name));
        const mergedParams = { ...(rt.params || {}), ...(up.params || {}) };
        for (const k of Object.keys(mergedParams)) {
          if (!varNames.has(k)) throw new Error('参数 ' + k + ' 不是脚本组「' + g.name + '」的变量');
        }
        try {
          evalProgram(g.script.program, { ...(g.script.test_input || {}), ...mergedParams });
        } catch (e) {
          throw new Error('线路「' + rt.name + '」参数验证失败：' + e.message);
        }
        rt.params = mergedParams;
        rt.history = [...(rt.history || []), { date: now, feedback: String(feedback).slice(0, 500), params: mergedParams }];
        changedNames.push('线路「' + rt.name + '」费率参数');
      }

      for (const ar of addedRoutes) {
        const g = groups.find((x) => x.name === ar.group);
        if (!g) throw new Error('未找到脚本组「' + ar.group + '」，无法新增线路');
        const varNames = new Set((g.script.variables || []).map((v) => v && v.name));
        const params = ar.params || {};
        for (const k of Object.keys(params)) {
          if (!varNames.has(k)) throw new Error('新增线路「' + ar.name + '」的参数 ' + k + ' 不是脚本组「' + g.name + '」的变量');
        }
        try {
          evalProgram(g.script.program, { ...(g.script.test_input || {}), ...params });
        } catch (e) {
          throw new Error('新增线路「' + ar.name + '」参数验证失败：' + e.message);
        }
        g.routes = [...(g.routes || []), { name: ar.name, enabled: true, params, history: [{ date: now, feedback: String(feedback).slice(0, 500), params }] }];
        changedNames.push('新增线路「' + ar.name + '」（归入「' + g.name + '」）');
      }

      const removedRSet = new Set(removedRoutes);
      for (const nm of removedRoutes) {
        if (groups.some((g) => (g.routes || []).some((x) => x.name === nm))) {
          changedNames.push('移除线路「' + nm + '」');
        }
      }
      groups = groups
        .map((g) => ({ ...g, routes: (g.routes || []).filter((x) => !removedRSet.has(x.name)) }))
        .filter((g) => (g.routes || []).length);

      // 服务脚本：处理方式与按线路格式相同
      let services = (cs.services || []).map((s) => JSON.parse(JSON.stringify(s)));
      for (const up of updatedServices) {
        if (!Array.isArray(up.program) || !up.program.length) throw new Error('服务「' + up.name + '」的测算脚本为空');
        evalProgram(up.program, up.test_input || {});
        const script = packScript(up);
        const existing = services.find((s) => s.name === up.name);
        if (existing) {
          const pv = (existing.versions || []).length + 1;
          existing.script = script;
          existing.versions = [...(existing.versions || []), { version: pv, date: now, label: '版本 ' + pv, feedback: String(feedback).slice(0, 1000), script }];
          changedNames.push('「' + up.name + '」');
        } else {
          services.push({ name: up.name, enabled: true, script, versions: [{ version: 1, date: now, label: '初始版本', feedback: String(feedback).slice(0, 1000), script }] });
          changedNames.push('新增「' + up.name + '」');
        }
      }
      const removedSet = new Set(removed);
      services = services.filter((s) => !removedSet.has(s.name));
      for (const nm of removed) changedNames.push('移除「' + nm + '」');

      const newCalc = { format: 'per_service', version: unifiedVersion, transport: cs.transport || null, transport_groups: groups, transport_scripts: cs.transport_scripts || [], services };
      const allVersions = [...(quote.calc_script_versions || [])];
      allVersions.push({
        version: unifiedVersion,
        date: now,
        label: '版本 ' + unifiedVersion,
        feedback: String(feedback).slice(0, 1000),
        script: newCalc,
      });

      await base44.entities.SupplierQuote.update(quote.id, {
        calc_script: newCalc,
        calc_script_versions: allVersions,
        status: 'calculated',
      });
      await base44.entities.ChatSession.update(session_id, { stage: 'calculated' });

      const items = [];
      for (const g of groups) items.push(...((g.script.program || []).filter((p) => p && p.item)));
      for (const s of services) items.push(...((s.script.program || []).filter((p) => p && p.item)));
      const mergedVars = [];
      const seen = new Set();
      const varSources = [...groups.map((g) => g.script), ...services.map((s) => s.script)];
      for (const sc of varSources) {
        for (const v of sc.variables || []) {
          if (v && v.name && !seen.has(v.name)) { seen.add(v.name); mergedVars.push(v); }
        }
      }

      await appendMessage(base44, session_id, 'assistant',
        '已根据反馈更新测算脚本（整体第 ' + unifiedVersion + ' 版），涉及：' + changedNames.join('、') + '。各脚本历史版本与线路参数记录已保留。点击卡片打开测算面板，选择线路即可查看对应脚本与计费逻辑：',
        [{ type: 'script', data: { verified: true, variables: mergedVars, items, version: unifiedVersion } }]);
      return Response.json({ ok: true, version: unifiedVersion });
    }

    // per_service 格式：仅更新受影响的脚本
    const userMsg = '当前脚本结构（transport 为旧版单运输费脚本，transport_scripts 为每条运输线路的独立脚本，services 为各服务费独立脚本）：\n'
      + JSON.stringify({
        transport: cs.transport,
        transport_scripts: (cs.transport_scripts || []).map((t) => ({ name: t.name, enabled: t.enabled, script: t.script })),
        services: (cs.services || []).map((s) => ({ name: s.name, enabled: s.enabled, script: s.script })),
      }, null, 1)
      + '\n\n报价单数据（raw 为原文规则）：\n' + JSON.stringify({ transport: quote.transport_fees, service: quote.service_fees }, null, 1)
      + '\n\n专家反馈：\n' + feedback
      + '\n\n' + knowledgeCtx;
    const r = await llmJson(SYS, userMsg, 110000, llmModel);
    const changedTransport = r && r.changed_transport;
    const updatedTransports = ((r && Array.isArray(r.updated_transports)) ? r.updated_transports : []).filter((t) => t && t.name);
    const updatedServices = ((r && Array.isArray(r.updated_services)) ? r.updated_services : []).filter((s) => s && s.name);
    const removed = ((r && Array.isArray(r.removed_services)) ? r.removed_services : []);
    const removedTransports = ((r && Array.isArray(r.removed_transports)) ? r.removed_transports : []);
    if (!changedTransport && !updatedTransports.length && !updatedServices.length && !removed.length && !removedTransports.length) {
      throw new Error('未识别出需要修改的脚本，请更具体描述要修改哪条线路或哪个服务费脚本');
    }

    const now = new Date().toISOString();
    const packScript = (s) => ({
      code: s.code || '',
      variables: s.variables || [],
      program: s.program,
      test_input: s.test_input || {},
    });

    let transport = cs.transport ? JSON.parse(JSON.stringify(cs.transport)) : null;
    let services = (cs.services || []).map((s) => JSON.parse(JSON.stringify(s)));
    const unifiedVersion = (cs.version || 1) + 1;
    const changedNames = [];

    if (changedTransport) {
      if (!Array.isArray(changedTransport.program) || !changedTransport.program.length) throw new Error('修改后的运输费脚本为空');
      evalProgram(changedTransport.program, changedTransport.test_input || {});
      const script = packScript(changedTransport);
      const pv = ((transport && transport.versions) || []).length + 1;
      const versionsList = transport && transport.versions ? transport.versions : [];
      const newT = { script, versions: [...versionsList, { version: pv, date: now, label: '版本 ' + pv, feedback: String(feedback).slice(0, 1000), script }] };
      if (!transport) {
        changedNames.push('新增运输费脚本');
      } else {
        changedNames.push('运输费脚本');
      }
      transport = newT;
    }

    let transports = (cs.transport_scripts || []).map((t) => JSON.parse(JSON.stringify(t)));
    for (const up of updatedTransports) {
      if (!Array.isArray(up.program) || !up.program.length) throw new Error('线路「' + up.name + '」的测算脚本为空');
      evalProgram(up.program, up.test_input || {});
      const script = packScript(up);
      const existing = transports.find((t) => t.name === up.name);
      if (existing) {
        const pv = (existing.versions || []).length + 1;
        existing.script = script;
        existing.versions = [...(existing.versions || []), { version: pv, date: now, label: '版本 ' + pv, feedback: String(feedback).slice(0, 1000), script }];
        changedNames.push('线路「' + up.name + '」');
      } else {
        transports.push({ name: up.name, enabled: true, script, versions: [{ version: 1, date: now, label: '初始版本', feedback: String(feedback).slice(0, 1000), script }] });
        changedNames.push('新增线路「' + up.name + '」');
      }
    }
    const removedTSet = new Set(removedTransports);
    transports = transports.filter((t) => !removedTSet.has(t.name));
    for (const nm of removedTransports) changedNames.push('移除线路「' + nm + '」');

    for (const up of updatedServices) {
      if (!Array.isArray(up.program) || !up.program.length) throw new Error('服务「' + up.name + '」的测算脚本为空');
      evalProgram(up.program, up.test_input || {});
      const script = packScript(up);
      const existing = services.find((s) => s.name === up.name);
      if (existing) {
        const pv = (existing.versions || []).length + 1;
        existing.script = script;
        existing.versions = [...(existing.versions || []), { version: pv, date: now, label: '版本 ' + pv, feedback: String(feedback).slice(0, 1000), script }];
        changedNames.push('「' + up.name + '」');
      } else {
        services.push({ name: up.name, enabled: true, script, versions: [{ version: 1, date: now, label: '初始版本', feedback: String(feedback).slice(0, 1000), script }] });
        changedNames.push('新增「' + up.name + '」');
      }
    }
    const removedSet = new Set(removed);
    services = services.filter((s) => !removedSet.has(s.name));
    for (const nm of removed) changedNames.push('移除「' + nm + '」');

    const newCalc = { format: 'per_service', version: unifiedVersion, transport, transport_scripts: transports, services };
    const allVersions = [...(quote.calc_script_versions || [])];
    allVersions.push({
      version: unifiedVersion,
      date: now,
      label: '版本 ' + unifiedVersion,
      feedback: String(feedback).slice(0, 1000),
      script: { format: 'per_service', transport, transport_scripts: transports, services },
    });

    await base44.entities.SupplierQuote.update(quote.id, {
      calc_script: newCalc,
      calc_script_versions: allVersions,
      status: 'calculated',
    });
    await base44.entities.ChatSession.update(session_id, { stage: 'calculated' });

    // 卡片汇总
    const items = [];
    if (transport) items.push(...transport.script.program.filter((p) => p && p.item));
    for (const t of transports) items.push(...t.script.program.filter((p) => p && p.item));
    for (const s of services) items.push(...s.script.program.filter((p) => p && p.item));
    const mergedVars = [];
    const seen = new Set();
    const varSources = [
      ...(transport ? [transport.script] : []),
      ...transports.map((t) => t.script),
      ...services.map((s) => s.script),
    ];
    for (const sc of varSources) {
      for (const v of sc.variables || []) {
        if (v && v.name && !seen.has(v.name)) { seen.add(v.name); mergedVars.push(v); }
      }
    }

    await appendMessage(base44, session_id, 'assistant',
      '已根据反馈更新测算脚本（整体第 ' + unifiedVersion + ' 版），涉及：' + changedNames.join('、') + '。各脚本历史版本与测算记录已保留。点击卡片打开测算面板，录入变量即可重新测算：',
      [{ type: 'script', data: { verified: true, variables: mergedVars, items, version: unifiedVersion } }]);
    return Response.json({ ok: true, version: unifiedVersion });
  } catch (error) {
    // 失败信息写入对话流，避免界面停在「正在更新测算脚本」无任何反应
    if (session_id) {
      try {
        const svc = createClientFromRequest(req);
        await appendMessage(svc, session_id, 'assistant',
          '测算脚本更新失败：' + (error && error.message ? error.message : '未知错误') + '。请换一种说法描述要修改的内容，例如指明具体线路或服务费名称后重试。');
      } catch { /* 写入失败时静默处理 */ }
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function SYS_LEGACY() {
  return `你是物流费用计算脚本修改专家。专家对现有测算脚本提出反馈，请直接输出修改后的完整新版脚本（无需确认、直接生效）。
输出 JSON（与现有脚本格式一致）：
{
  "script_code": "与 program 逻辑完全一致的 JS 源码，形如 function calculate(input) { ... return { ... } }",
  "variables": [{"name": "weight_kg", "label": "货物重量", "unit": "kg", "description": "用途说明", "required": true, "default": 1000}],
  "program": [
    {"name": "ocean_freight", "expr": "max(input.weight_kg / 1000 * 40, input.volume_cbm * 30)", "item": true, "label": "海运费", "currency": "USD", "desc": "计费规则说明"},
    {"name": "weight_tons", "expr": "input.weight_kg / 1000"}
  ],
  "test_input": {"weight_kg": 1000}
}
规则：
- 只修改与反馈相关的公式/变量/费用项，其余步骤、变量与顺序保持不变。
- 新增或删除变量、费用项时，同步更新 variables、program 与 test_input。
- item:true 的步骤为费用项（label 中文费用名、currency 币种、desc 一句话说明），其余为中间步骤；不要生成"合计/总计"步骤。
- 表达式沙箱规则（违反会直接报错）：只能使用数字、+ - * /、括号、函数 max/min/round(x,小数位)/abs/floor/ceil、input.变量名，以及引用更早步骤的步骤名；不得出现循环、条件分支、字符串或注释。
- test_input 必须覆盖全部变量。`;
}