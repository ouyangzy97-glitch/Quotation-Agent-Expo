import { Terminal, ShieldCheck, ShieldAlert, Eye, Variable } from 'lucide-react';

export default function ScriptCard({ data, onOpen }) {
  const verified = !!data.verified;
  const items = data.items || [];
  const vars = data.variables || [];
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <Terminal className="h-4 w-4 text-[#E8734A]" />
        <span className="text-sm font-semibold text-zinc-900">
          费用测算脚本{data.version ? ' · v' + data.version : ''}
        </span>
        <span
          className={`ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
            verified ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/15 text-amber-600'
          }`}
        >
          {verified ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          {verified ? '已通过沙箱验证' : '待验证'}
        </span>
      </div>
      {items.length > 0 && (
        <div className="space-y-1.5 px-4 py-3">
          {items.slice(0, 5).map((it, i) => (
            <div key={i} className="flex items-baseline gap-2 text-sm">
              <span className="font-medium text-zinc-800">{it.label || it.name}</span>
              {it.currency && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{it.currency}</span>
              )}
              {it.desc && <span className="truncate text-xs text-zinc-400">{it.desc}</span>}
            </div>
          ))}
          {items.length > 5 && <p className="text-xs text-zinc-400">… 共 {items.length} 个费用项</p>}
        </div>
      )}
      <div className="flex items-center gap-3 border-t border-zinc-100 bg-zinc-50 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Variable className="h-3 w-3" /> {vars.length} 个输入变量
        </span>
        <button
          onClick={onOpen}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
        >
          <Eye className="h-3.5 w-3.5" /> 打开测算面板
        </button>
      </div>
    </div>
  );
}