import { useEffect, useState } from 'react';
import {
  Terminal, Play, Loader2, History, Variable, FileCode2,
  ChevronDown, ChevronUp, ShieldCheck,
} from 'lucide-react';
import PerServiceCalc from './PerServiceCalc';

const fmt = (n) =>
  typeof n === 'number'
    ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    : String(n ?? '—');

// 旧版单脚本格式（calc_script = {code, variables, program, test_input, version}）的测算面板，保持原行为。
function LegacyCalc({ quote, sessionId, onRun, busy }) {
  const script = quote.calc_script || {};
  const versions = (quote.calc_script_versions || []).map((v) => ({ ...v, script: v.script || {} }));
  const curVersion = script.version || 1;
  const lastIdx = versions.length ? versions.length - 1 : 0;

  const [versionIdx, setVersionIdx] = useState(lastIdx);
  const [inputs, setInputs] = useState(() => ({ ...(script.test_input || {}) }));
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    setVersionIdx(lastIdx);
    setInputs({ ...((quote.calc_script || {}).test_input || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastIdx]);

  const shownVersion = versions[Math.min(versionIdx, lastIdx)] || null;
  const shown = shownVersion
    ? shownVersion.script
    : { code: script.code, program: script.program, test_input: script.test_input, variables: script.variables || [] };
  const isLatest = versionIdx === lastIdx;

  const program = shown.program || [];
  const hasItemFlags = program.some((s) => s && s.item !== undefined);
  const items = hasItemFlags ? program.filter((s) => s && s.item) : program;
  const intermediates = hasItemFlags ? program.filter((s) => s && !s.item) : [];
  const variables = (shown.variables && shown.variables.length)
    ? shown.variables
    : Object.keys(shown.test_input || {}).map((k) => ({ name: k, label: k, unit: '', required: true }));

  const runs = quote.calc_runs || [];
  const lastRun = runs.length ? runs[runs.length - 1] : null;
  const curRun = lastRun && (lastRun.script_version || 1) === curVersion ? lastRun : null;
  const output = isLatest && curRun ? curRun.output || {} : null;

  const totals = {};
  if (output) {
    for (const it of items) {
      const v = output[it.name];
      if (v == null) continue;
      const cur = it.currency || 'CNY';
      totals[cur] = Math.round(((totals[cur] || 0) + Number(v)) * 1e6) / 1e6;
    }
  }

  const run = () => {
    if (onRun && sessionId && isLatest) onRun(sessionId, inputs);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-zinc-100 bg-white px-5 py-3">
        <Terminal className="h-4 w-4 text-[#E8734A]" />
        <span className="text-sm font-semibold text-zinc-900">费用测算脚本 · v{curVersion}</span>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700">
          <ShieldCheck className="h-3 w-3" /> 已通过沙箱验证
        </span>
      </div>

      {versions.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-zinc-100 bg-zinc-50/70 px-4 py-2">
          <History className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          {versions.map((v, i) => (
            <button
              key={v.version || i}
              onClick={() => setVersionIdx(i)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${
                i === versionIdx ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:bg-zinc-100'
              }`}
              title={v.feedback || v.label}
            >
              {v.label || '版本 ' + (i + 1)}
            </button>
          ))}
        </div>
      )}

      <div className="px-5 py-4">
        <div className="mb-2 flex items-center gap-2">
          <Variable className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-xs font-semibold text-zinc-700">输入变量</span>
          <span className="text-[11px] text-zinc-400">{variables.length} 个</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {variables.map((v) => (
            <label key={v.name} className="block">
              <span className="mb-1 block truncate text-[11px] text-zinc-500" title={v.name}>
                {v.label || v.name}
                {v.unit ? `（${v.unit}）` : ''}
              </span>
              <input
                type="number"
                step="any"
                value={inputs[v.name] == null ? '' : inputs[v.name]}
                onChange={(e) =>
                  setInputs((p) => ({ ...p, [v.name]: e.target.value === '' ? null : Number(e.target.value) }))
                }
                disabled={!isLatest}
                className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs text-zinc-900 outline-none transition-colors focus:border-[#E8734A] disabled:opacity-60"
              />
              {v.description && <span className="mt-0.5 block text-[10px] leading-snug text-zinc-400">{v.description}</span>}
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={run}
            disabled={!isLatest || busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#E8734A] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d4653f] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            执行测算并存档
          </button>
          {!isLatest && (
            <span className="text-[11px] text-amber-600">正在查看历史版本（仅供查看），测算请切回最新版本</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-y border-zinc-100 bg-zinc-50/70 px-5 py-2.5">
        <FileCode2 className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-xs font-semibold text-zinc-700">费用项</span>
        <span className="text-[11px] text-zinc-400">{items.length} 项</span>
      </div>
      <div className="divide-y divide-zinc-100">
        {items.map((it, i) => (
          <div key={it.name || i} className="px-5 py-3">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-zinc-900">{it.label || it.name}</span>
              {it.currency && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{it.currency}</span>
              )}
              <span className="ml-auto font-mono text-sm font-semibold text-zinc-900">
                {output ? fmt(output[it.name]) : '—'}
              </span>
            </div>
            {it.desc && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{it.desc}</p>}
            <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-400">{it.expr}</p>
          </div>
        ))}
        {output &&
          Object.keys(totals).map((cur) => (
            <div key={cur} className="flex items-center justify-between bg-zinc-50 px-5 py-2.5">
              <span className="text-sm font-medium text-zinc-700">合计（{cur}）</span>
              <span className="font-mono text-sm font-semibold text-[#E8734A]">{fmt(totals[cur])}</span>
            </div>
          ))}
        {!items.length && <p className="px-5 py-4 text-xs text-zinc-400">脚本为空</p>}
      </div>

      {(intermediates.length > 0 || shown.code) && (
        <div className="border-t border-zinc-100">
          <button
            onClick={() => setShowDetail((s) => !s)}
            className="flex w-full items-center gap-1.5 px-5 py-2.5 text-left text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50"
          >
            {showDetail ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            计算过程与脚本源码
          </button>
          {showDetail && (
            <div className="max-h-80 overflow-y-auto px-5 pb-4">
              {intermediates.length > 0 && (
                <pre className="whitespace-pre-wrap rounded-lg border border-zinc-100 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-500">
                  {intermediates.map((s) => s.name + ' = ' + String(s.expr)).join('\n')}
                </pre>
              )}
              {shown.code && (
                <pre className="mt-2 overflow-x-auto whitespace-pre rounded-lg border border-zinc-100 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-600">
                  {shown.code}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CalcPanel({ data, sessionId, onRun, busy }) {
  const quote = (data && data.quote) || {};
  const script = quote.calc_script || {};
  const isPerService = !Array.isArray(script.program)
    && !!(script.transport || (script.transport_groups && script.transport_groups.length) || (script.transport_scripts && script.transport_scripts.length) || (script.services && script.services.length));
  if (isPerService) {
    return <PerServiceCalc quote={quote} sessionId={sessionId} onRun={onRun} busy={busy} />;
  }
  return <LegacyCalc quote={quote} sessionId={sessionId} onRun={onRun} busy={busy} />;
}