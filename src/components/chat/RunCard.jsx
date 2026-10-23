import { Calculator } from 'lucide-react';

const fmt = (v) =>
  typeof v === 'number' ? v.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : String(v);

export default function RunCard({ data }) {
  // 新版分组格式：groups = [{name, kind, items, output}] + totals
  if (Array.isArray(data.groups)) {
    return (
      <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
          <Calculator className="h-4 w-4 text-[#E8734A]" />
          <span className="text-sm font-semibold text-zinc-900">测算结果</span>
          {Array.isArray(data.enabled) && data.enabled.length > 0 && (
            <span className="text-[11px] text-zinc-400">启用：{data.enabled.join('、')}</span>
          )}
          <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">已存档</span>
        </div>
        <div className="divide-y divide-zinc-100">
          {data.groups.map((g) => (
            <div key={g.name}>
              <div className="bg-zinc-50/70 px-4 py-1.5 text-xs font-semibold text-zinc-600">{g.name}</div>
              <div className="divide-y divide-zinc-50">
                {(g.items && g.items.length
                  ? g.items
                  : Object.keys(g.output || {}).map((k) => ({ name: k, label: k }))
                ).map((it) => (
                  <div key={it.name} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-zinc-600">
                      {it.label || it.name}
                      {it.currency && (
                        <span className="ml-1.5 rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500">{it.currency}</span>
                      )}
                    </span>
                    <span className="font-mono font-semibold text-zinc-900">
                      {fmt((g.output || {})[it.name])}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {Object.entries(data.totals || {}).map(([cur, v]) => (
            <div key={cur} className="flex items-center justify-between bg-emerald-50/50 px-4 py-2 text-sm">
              <span className="font-medium text-zinc-700">合计（{cur}）</span>
              <span className="font-mono font-semibold text-[#E8734A]">{fmt(v)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-2 font-mono text-[11px] text-zinc-400">
          inputs = {JSON.stringify(data.inputs)}
        </div>
      </div>
    );
  }

  // 旧版扁平输出格式
  const entries = Object.entries(data.output || {});
  return (
    <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <Calculator className="h-4 w-4 text-[#E8734A]" />
        <span className="text-sm font-semibold text-zinc-900">测算结果</span>
        <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">已存档</span>
      </div>
      <div className="divide-y divide-zinc-100">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-2 font-mono text-sm">
            <span className="text-zinc-600">{k}</span>
            <span className="font-semibold text-zinc-900">
              {typeof v === 'number' ? v.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : String(v)}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-2 font-mono text-[11px] text-zinc-400">
        inputs = {JSON.stringify(data.inputs)}
      </div>
    </div>
  );
}