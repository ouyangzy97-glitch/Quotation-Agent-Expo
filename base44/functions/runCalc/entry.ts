import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { evalProgram } from '../../shared/calc.ts';
import { appendMessage } from '../../shared/chat.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { session_id, inputs, enabled } = await req.json();
    if (!session_id) return Response.json({ error: '需要 session_id' }, { status: 400 });

    const session = await base44.entities.ChatSession.get(session_id);
    if (!session.quote_id) return Response.json({ error: '该会话还没有报价单' }, { status: 400 });
    const quote = await base44.entities.SupplierQuote.get(session.quote_id);
    const cs = quote.calc_script;
    if (!cs) return Response.json({ error: '尚未生成测算脚本，请先确认识别结果' }, { status: 400 });

    let run;
    if (Array.isArray(cs.program)) {
      // 旧版单脚本格式：保持原行为
      if (!Array.isArray(cs.program) || !cs.program.length) {
        return Response.json({ error: '尚未生成测算脚本，请先确认识别结果' }, { status: 400 });
      }
      const usedInputs = inputs && Object.keys(inputs).length ? inputs : cs.test_input;
      const output = evalProgram(cs.program, usedInputs);
      run = { date: new Date().toISOString(), script_version: cs.version || 1, inputs: usedInputs, output };
    } else {
      // per_service 格式：运输费脚本 + 各启用服务脚本分别执行，结果按币种汇总
      const groupDefs = [];
      const enabledList = Array.isArray(enabled) && enabled.length ? new Set(enabled) : null;
      if (cs.transport && cs.transport.script && Array.isArray(cs.transport.script.program) && cs.transport.script.program.length) {
        groupDefs.push({ name: '运输费', kind: 'transport', script: cs.transport.script });
      }
      // 计费规则组：同组线路共用脚本，线路差异为 params 参数
      for (const g of cs.transport_groups || []) {
        if (!g || !g.script || !Array.isArray(g.script.program) || !g.script.program.length) continue;
        for (const r of g.routes || []) {
          if (!r || !r.name) continue;
          if (enabledList ? enabledList.has(r.name) : r.enabled !== false) {
            groupDefs.push({ name: r.name, kind: 'transport', script: g.script, params: r.params || {}, group: g.name });
          }
        }
      }
      // 旧版每线路一脚本格式（兼容保留）
      for (const t of cs.transport_scripts || []) {
        if (!t || !t.script || !Array.isArray(t.script.program) || !t.script.program.length) continue;
        if (enabledList ? enabledList.has(t.name) : t.enabled !== false) {
          groupDefs.push({ name: t.name, kind: 'transport', script: t.script });
        }
      }
      for (const s of cs.services || []) {
        if (!s || !s.script || !Array.isArray(s.script.program) || !s.script.program.length) continue;
        if (enabledList ? enabledList.has(s.name) : s.enabled !== false) {
          groupDefs.push({ name: s.name, kind: 'service', script: s.script });
        }
      }
      if (!groupDefs.length) return Response.json({ error: '没有可执行的测算脚本，请至少启用一条线路或一个服务' }, { status: 400 });

      const hasFormInputs = inputs && Object.keys(inputs).length > 0;
      const usedInputs = hasFormInputs ? inputs : (() => {
        const merged = {};
        for (const g of groupDefs) Object.assign(merged, g.script.test_input || {}, g.params || {});
        return merged;
      })();

      const groups = groupDefs.map((g) => {
        // 每条线路用「脚本默认值 + 线路参数」求解；表单录入的值优先（可临时调整费率做假设测算）
        const routeInput = { ...(g.script.test_input || {}), ...(g.params || {}) };
        const finalInput = hasFormInputs ? { ...routeInput, ...inputs } : routeInput;
        const output = evalProgram(g.script.program, finalInput);
        const items = g.script.program.filter((p) => p && p.item);
        return { name: g.name, kind: g.kind, items, output, group: g.group || null };
      });
      const totals = {};
      for (const g of groups) {
        for (const it of g.items) {
          const v = g.output[it.name];
          if (v == null) continue;
          const cur = it.currency || 'CNY';
          totals[cur] = Math.round(((totals[cur] || 0) + Number(v)) * 1e6) / 1e6;
        }
      }
      run = {
        date: new Date().toISOString(),
        script_version: cs.version || 1,
        inputs: usedInputs,
        enabled: groups.map((g) => g.name),
        groups,
        totals,
      };
    }

    const runs = [...(quote.calc_runs || [])];
    runs.push(run);
    await base44.entities.SupplierQuote.update(quote.id, { calc_runs: runs, status: 'archived' });
    await base44.entities.ChatSession.update(session_id, { stage: 'done' });

    await appendMessage(base44, session_id, 'assistant', '测算完成，结果已存档备查。费用明细请查看右侧「费用测算」面板，可修改输入参数再次执行。', []);
    return Response.json({ ok: true, run });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}