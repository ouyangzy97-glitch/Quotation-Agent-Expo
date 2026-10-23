import { useEffect, useState } from 'react';
import {
  Terminal, Play, Loader2, History, Variable, FileCode2,
  ChevronDown, ChevronUp, ShieldCheck, Ship, Wrench, CheckSquare, Square, Coins, Users,
} from 'lucide-react';

const fmt = (n) =>
  typeof n === 'number'
    ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    : String(n ?? '—');

function ScriptSection({ title, icon, container, verIdx, onVer, runGroup, subtitle }) {
  const [open, setOpen] = useState(false);
  const versions = container.versions || [];
  const idx = Math.min(verIdx, Math.max(versions.length - 1, 0));
  const shown = versions.length ? versions[idx].script : container.script;
  const isLatest = !versions.length || idx === versions.length - 1;
  const program = shown.program || [];
  const items = program.filter((s) => s && s.item);
  const intermediates = program.filter((s) => s && !s.item);
  const gOutput = runGroup ? runGroup.output || {} : null;

  return (
    <div>
      <div className="flex items-center gap-2 border-y border-zinc-100 bg-zinc-50/70 px-5 py-2.5">
        {icon}
        <span className="text-xs font-semibold text-zinc-700">{title}</span>
        <span className="text-[11px] text-zinc-400">
          {items.length} 个费用项 · 脚本 v{versions.length ? versions[idx].version : 1}
        </span>
        {!isLatest && <span className="text-[11px] text-amber-600">历史版本（仅供查看）</span>}
      </div>
      {subtitle && (
        <div className="border-b border-zinc-100 bg-white px-5 py-2 text-[11px] leading-relaxed text-zinc-500">
          {subtitle}
        </div>
      )}
      <div className="divide-y divide-zinc-100">
        {items.map((it) => (
          <div key={it.name} className="px-5 py-3">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-zinc-900">{it.label || it.name}</span>
              {it.currency && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{it.currency}</span>
              )}
              <span className="ml-auto font-mono text-sm font-semibold text-zinc-900">
                {gOutput ? fmt(gOutput[it.name]) : '—'}
              </span>
            </div>
            {it.desc && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{it.desc}</p>}
            <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-400">{it.expr}</p>
          </div>
        ))}
        {!items.length && <p className="px-5 py-3 text-xs text-zinc-400">脚本无费用项</p>}
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-5 py-2.5 text-left text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        <FileCode2 className="h-3.5 w-3.5" />
        计算过程与脚本源码
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto px-5 pb-4">
          {versions.length > 1 && (
            <div className="mb-2 flex items-center gap-1.5 overflow-x-auto">
              <History className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              {versions.map((v, i) => (
                <button
                  key={i}
                  onClick={() => onVer(i)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${
                    i === idx ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:bg-zinc-100'
                  }`}
                >
                  {v.label || '版本 ' + (i + 1)}
                </button>
              ))}
            </div>
          )}
          {intermediates.length > 0 && (
            <pre className="whitespace-pre-wrap rounded-lg border border-zinc-100 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-500">
              {intermediates.map((s) => s.name + ' = ' + String(s.expr)).join('\n')}
            </pre>
          )}
          {shown.code && (
            <pre className={`mt-2 overflow-x-auto whitespace-pre rounded-lg border border-zinc-100 p-3 font-mono text-[11px] leading-relaxed ${
              isLatest ? 'bg-zinc-50 text-zinc-600' : 'bg-amber-50 text-amber-700'
            }`}>
              {shown.code}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function VarGrid({ vars, defaults, inputs, onChange, busy }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {vars.map((v) => (
        <label key={v.name} className="block">
          <span className="mb-1 block truncate text-[11px] text-zinc-500" title={v.name}>
            {v.label || v.name}
            {v.unit ? `（${v.unit}）` : ''}
          </span>
          <input
            type="number"
            step="any"
            value={inputs[v.name] != null ? inputs[v.name] : defaults[v.name] == null ? '' : defaults[v.name]}
            onChange={(e) => onChange(v.name, e.target.value === '' ? null : Number(e.target.value))}
            disabled={busy}
            className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs text-zinc-900 outline-none transition-colors focus:border-[#E8734A] disabled:opacity-60"
          />
          {v.description && <span className="mt-0.5 block text-[10px] leading-snug text-zinc-400">{v.description}</span>}
        </label>
      ))}
    </div>
  );
}

export default function PerServiceCalc({ quote, sessionId, onRun, busy }) {
  const cs = quote.calc_script || {};
  const transport = cs.transport || null;
  const routeGroups = Array.isArray(cs.transport_groups) ? cs.transport_groups : [];
  const grouped = routeGroups.length > 0;
  const routes = cs.transport_scripts || [];
  const services = cs.services || [];
  const verKey = cs.version || 1;

  // 分组模式：线路 → 所属脚本组 的索引
  const routeIndex = [];
  for (const g of routeGroups) {
    for (const r of g.routes || []) routeIndex.push({ name: r.name, group: g });
  }

  const latestSel = () => {
    const sel = {};
    if (transport) sel.__transport = Math.max((transport.versions || []).length - 1, 0);
    for (const g of routeGroups) sel['g:' + g.name] = Math.max((g.versions || []).length - 1, 0);
    for (const t of routes) sel[t.name] = Math.max((t.versions || []).length - 1, 0);
    for (const s of services) sel[s.name] = Math.max((s.versions || []).length - 1, 0);
    return sel;
  };
  const firstRoute = () => {
    if (grouped) return routeIndex.length ? routeIndex[0].name : null;
    return routes.length ? routes[0].name : null;
  };

  const [selRoute, setSelRoute] = useState(firstRoute);
  const [enabledMap, setEnabledMap] = useState(() =>
    Object.fromEntries(services.map((s) => [s.name, s.enabled !== false]))
  );
  const [versionSel, setVersionSel] = useState(latestSel);
  const [inputs, setInputs] = useState({});

  useEffect(() => {
    setEnabledMap(Object.fromEntries(services.map((s) => [s.name, s.enabled !== false])));
    setSelRoute(firstRoute());
    setVersionSel(latestSel());
    setInputs({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verKey, routeIndex.length, routes.length, services.length]);

  const selEntry = grouped ? (routeIndex.find((x) => x.name === selRoute) || null) : null;
  const selGroup = selEntry ? selEntry.group : null;
  const selRouteRec = selGroup ? ((selGroup.routes || []).find((r) => r.name === selRoute) || null) : null;
  const paramKeys = selRouteRec ? Object.keys(selRouteRec.params || {}) : [];

  const activeRoutes = routes.filter((t) => t.name === selRoute);
  const activeServices = services.filter((s) => enabledMap[s.name]);
  const activeScripts = [];
  if (grouped) {
    if (selGroup && selGroup.script) activeScripts.push(selGroup.script);
  } else {
    if (transport && transport.script) activeScripts.push(transport.script);
    for (const t of activeRoutes) activeScripts.push(t.script);
  }
  for (const s of activeServices) activeScripts.push(s.script);

  // 统一变量表单：各脚本同名变量合并去重
  const mergedVars = [];
  const seen = new Set();
  for (const sc of activeScripts) {
    for (const v of sc.variables || []) {
      if (v && v.name && !seen.has(v.name)) { seen.add(v.name); mergedVars.push(v); }
    }
  }
  const defaults = {};
  for (const sc of activeScripts) Object.assign(defaults, sc.test_input || {});
  if (grouped && selRouteRec) Object.assign(defaults, selRouteRec.params || {});

  // 分组模式：线路参数（来自报价原文）与业务输入分开展示
  const paramVars = grouped ? mergedVars.filter((v) => paramKeys.includes(v.name)) : [];
  const businessVars = grouped ? mergedVars.filter((v) => !paramKeys.includes(v.name)) : mergedVars;

  // 从对应报价单条目提取线路的补充信息，用于下拉选项区分同 OD 的多条线路
  const routeMeta = (t) => {
    if (!t) return '';
    const fee = (quote.transport_fees || []).find((f) => {
      const odFee = [f.origin, f.destination].filter(Boolean).join(' → ');
      return odFee && (t.name === odFee || t.name.startsWith(odFee + ' ·'));
    });
    const bits = [];
    if (fee && fee.mode) bits.push(fee.mode);
    if (fee && fee.supplier) bits.push(fee.supplier);
    if (fee && fee.unit_weight_price != null) bits.push('重量 ' + fee.unit_weight_price + (fee.weight_price_unit || ''));
    if (fee && fee.unit_volume_price != null) bits.push('体积 ' + fee.unit_volume_price + (fee.volume_price_unit || ''));
    if (!bits.length) {
      const script = t.group ? (t.group.script || {}) : (t.script || {});
      const item = ((script.program || []).filter((p) => p && p.item)[0]) || null;
      if (item && item.desc) bits.push(item.desc);
    }
    return bits.join(' · ');
  };
  const selMeta = grouped
    ? [selRouteRec ? routeMeta({ name: selRoute }) : '', selGroup ? selGroup.name : ''].filter(Boolean).join(' · ')
    : routeMeta(routes.find((r) => r.name === selRoute));

  const runs = quote.calc_runs || [];
  const lastRun = runs.length ? runs[runs.length - 1] : null;
  const output = lastRun && (lastRun.script_version || 1) === verKey ? lastRun : null;
  const groupByName = {};
  if (output) for (const g of output.groups || []) groupByName[g.name] = g;
  const transportGroup = output ? (output.groups || []).find((g) => g.kind === 'transport') || null : null;

  const run = () => {
    if (!onRun || !sessionId || busy || !mergedVars.length || !selRoute) return;
    const vals = {};
    for (const v of mergedVars) {
      const raw = inputs[v.name] != null ? inputs[v.name] : defaults[v.name];
      vals[v.name] = raw == null || raw === '' ? null : Number(raw);
    }
    onRun(sessionId, vals, [selRoute, ...activeServices.map((s) => s.name)]);
  };

  const routeOptions = grouped ? routeIndex : routes;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-zinc-100 bg-white px-5 py-3">
        <Terminal className="h-4 w-4 text-[#E8734A]" />
        <span className="text-sm font-semibold text-zinc-900">费用测算 · v{verKey}</span>
        <span className="text-[11px] text-zinc-400">
          {grouped
            ? `${routeIndex.length} 条线路 · ${routeGroups.length} 类共用脚本 + ${services.length} 个服务脚本`
            : `${(transport ? 1 : 0) + routes.length} 条运输线路脚本 + ${services.length} 个服务脚本`}
        </span>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700">
          <ShieldCheck className="h-3 w-3" /> 已通过沙箱验证
        </span>
      </div>

      {output && (
        <div className="border-b border-zinc-100 px-5 py-4">
          <div className="mb-2 flex items-center gap-2">
            <Coins className="h-3.5 w-3.5 text-[#E8734A]" />
            <span className="text-xs font-semibold text-zinc-700">测算结果</span>
            <span className="text-[11px] text-zinc-400">{new Date(output.date).toLocaleString('zh-CN')}</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-zinc-200">
            {(output.groups || []).filter((g) => g.kind === 'transport').map((g) => (
              <div key={g.name}>
                <div className="border-b border-zinc-100 bg-zinc-50/70 px-3 py-1.5 text-[11px] font-semibold text-zinc-500">
                  {g.name}
                  {g.group ? <span className="ml-1.5 font-normal text-zinc-400">脚本组：{g.group}</span> : null}
                </div>
                {(g.items || []).map((it) => (
                  <div key={it.name} className="flex items-baseline justify-between border-b border-zinc-100 px-3 py-1.5 text-xs">
                    <span className="text-zinc-700">{it.label || it.name}</span>
                    <span className="font-mono font-semibold text-zinc-900">
                      {fmt(g.output ? g.output[it.name] : null)} {it.currency || ''}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {(output.groups || []).some((g) => g.kind !== 'transport') && (
              <div>
                <div className="border-b border-zinc-100 bg-zinc-50/70 px-3 py-1.5 text-[11px] font-semibold text-zinc-500">
                  服务费
                </div>
                {(output.groups || []).filter((g) => g.kind !== 'transport').flatMap((g) => g.items || []).map((it) => (
                  <div key={it.name} className="flex items-baseline justify-between border-b border-zinc-100 px-3 py-1.5 text-xs">
                    <span className="text-zinc-700">{it.label || it.name}</span>
                    <span className="font-mono font-semibold text-zinc-900">
                      {fmt(output.groups.find((g) => (g.items || []).some((x) => x.name === it.name))?.output?.[it.name])} {it.currency || ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {Object.entries(output.totals || {}).map(([cur, val]) => (
              <div key={cur} className="flex items-baseline justify-between bg-zinc-50 px-3 py-2 text-sm">
                <span className="font-medium text-zinc-700">合计（{cur}）</span>
                <span className="font-mono font-semibold text-[#E8734A]">{fmt(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {routeOptions.length > 0 && (
        <div className="px-5 py-3">
          <div className="mb-2 flex items-center gap-2">
            <Ship className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs font-semibold text-zinc-700">参与测算的线路（单选）</span>
          </div>
          <select
            value={selRoute || ''}
            onChange={(e) => setSelRoute(e.target.value)}
            disabled={busy}
            className="w-full max-w-xs rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-[#E8734A] disabled:opacity-60"
          >
            {routeOptions.map((t) => {
              const meta = grouped
                ? [routeMeta({ name: t.name }), t.group.name].filter(Boolean).join(' · ')
                : routeMeta(t);
              return <option key={t.name} value={t.name}>{meta ? t.name + '（' + meta + '）' : t.name}</option>;
            })}
          </select>
          {selRoute && selMeta && (
            <p className="mt-1.5 text-[11px] text-zinc-400">当前选中：{selMeta}</p>
          )}
          {grouped && selGroup && (
            <div className="mt-2.5 rounded-lg border border-zinc-100 bg-zinc-50/70 px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-600">
                <Ship className="h-3.5 w-3.5 text-[#E8734A]" />
                {selGroup.name}
                <span className="ml-auto inline-flex items-center gap-1 font-normal text-zinc-400">
                  <Users className="h-3 w-3" /> 同组 {(selGroup.routes || []).length} 条线路共用
                </span>
              </div>
              {selGroup.logic_desc && (
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">计费逻辑：{selGroup.logic_desc}</p>
              )}
              {(selGroup.routes || []).length > 1 && (
                <p className="mt-0.5 text-[10px] leading-snug text-zinc-400">
                  同组线路：{(selGroup.routes || []).map((x) => x.name).join('、')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {services.length > 0 && (
        <div className="px-5 py-3">
          <div className="mb-2 flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs font-semibold text-zinc-700">参与测算的服务（默认全部启用）</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => {
              const on = !!enabledMap[s.name];
              return (
                <button
                  key={s.name}
                  onClick={() => setEnabledMap((m) => ({ ...m, [s.name]: !on }))}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    on
                      ? 'border-zinc-900 bg-zinc-900 text-white'
                      : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400'
                  }`}
                >
                  {on ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-y border-zinc-100 bg-white px-5 py-4">
        <div className="mb-2 flex items-center gap-2">
          <Variable className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-xs font-semibold text-zinc-700">{grouped ? '输入参数' : '统一输入变量'}</span>
          <span className="text-[11px] text-zinc-400">
            {mergedVars.length} 个
            {grouped ? '（线路参数已按报价原文预填，可临时调整做假设测算）' : '（各脚本同名变量已合并）'}
          </span>
        </div>
        {mergedVars.length ? (
          <>
            {grouped && paramVars.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 text-[11px] font-semibold text-zinc-600">线路参数（来自报价原文）</div>
                <VarGrid
                  vars={paramVars}
                  defaults={defaults}
                  inputs={inputs}
                  onChange={(n, val) => setInputs((p) => ({ ...p, [n]: val }))}
                  busy={busy}
                />
              </div>
            )}
            {grouped && businessVars.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-zinc-600">业务输入</div>
                <VarGrid
                  vars={businessVars}
                  defaults={defaults}
                  inputs={inputs}
                  onChange={(n, val) => setInputs((p) => ({ ...p, [n]: val }))}
                  busy={busy}
                />
              </div>
            )}
            {!grouped && (
              <VarGrid
                vars={mergedVars}
                defaults={defaults}
                inputs={inputs}
                onChange={(n, val) => setInputs((p) => ({ ...p, [n]: val }))}
                busy={busy}
              />
            )}
          </>
        ) : (
          <p className="text-xs text-zinc-400">请至少启用一条线路或一个服务后再测算</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={run}
            disabled={busy || !mergedVars.length || !selRoute}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#E8734A] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d4653f] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            测算
          </button>
          {output && (
            <span className="text-[11px] text-zinc-400">
              最近测算：{new Date(output.date).toLocaleString('zh-CN')}
              {output.enabled ? ` · 启用：${output.enabled.join('、')}` : ''}
            </span>
          )}
        </div>
      </div>

      {grouped && selGroup && (
        <ScriptSection
          key={selGroup.name}
          title={'共用脚本 · ' + selGroup.name}
          icon={<Ship className="h-3.5 w-3.5 text-zinc-500" />}
          container={selGroup}
          verIdx={versionSel['g:' + selGroup.name] || 0}
          onVer={(i) => setVersionSel((p) => ({ ...p, ['g:' + selGroup.name]: i }))}
          runGroup={output ? groupByName[selRoute] || null : null}
          subtitle={
            '该脚本由 ' + (selGroup.routes || []).length + ' 条线路共用，各线路差异通过上方「线路参数」表达；' +
            '修改计费逻辑会影响本组全部线路。'
          }
        />
      )}
      {!grouped && activeRoutes.map((t) => (
        <ScriptSection
          key={t.name}
          title={'运输费脚本 · ' + t.name}
          icon={<Ship className="h-3.5 w-3.5 text-zinc-500" />}
          container={t}
          verIdx={versionSel[t.name] || 0}
          onVer={(i) => setVersionSel((p) => ({ ...p, [t.name]: i }))}
          runGroup={output ? groupByName[t.name] || null : null}
        />
      ))}
      {!grouped && transport && (
        <ScriptSection
          title="运输费脚本"
          icon={<Ship className="h-3.5 w-3.5 text-zinc-500" />}
          container={transport}
          verIdx={versionSel.__transport || 0}
          onVer={(i) => setVersionSel((p) => ({ ...p, __transport: i }))}
          runGroup={transportGroup}
        />
      )}
      {activeServices.map((s) => (
        <ScriptSection
          key={s.name}
          title={'服务脚本 · ' + s.name}
          icon={<Wrench className="h-3.5 w-3.5 text-zinc-500" />}
          container={s}
          verIdx={versionSel[s.name] || 0}
          onVer={(i) => setVersionSel((p) => ({ ...p, [s.name]: i }))}
          runGroup={output ? groupByName[s.name] || null : null}
        />
      ))}

      {output && output.totals && !!Object.keys(output.totals).length && (
        <div className="border-t border-zinc-100">
          {Object.entries(output.totals).map(([cur, val]) => (
            <div key={cur} className="flex items-center justify-between bg-zinc-50 px-5 py-2.5">
              <span className="text-sm font-medium text-zinc-700">合计（{cur}）</span>
              <span className="font-mono text-sm font-semibold text-[#E8734A]">{fmt(val)}</span>
            </div>
          ))}
        </div>
      )}
      {!transport && !routes.length && !routeGroups.length && !services.length && (
        <p className="px-5 py-4 text-xs text-zinc-400">脚本为空</p>
      )}
    </div>
  );
}