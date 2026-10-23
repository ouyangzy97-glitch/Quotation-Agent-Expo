import { GitCompareArrows } from 'lucide-react';

export default function DiffCard({ changes = [] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <GitCompareArrows className="h-4 w-4 text-[#E8734A]" />
        <span className="text-sm font-semibold text-zinc-900">修正对比</span>
        <span className="text-xs text-zinc-400">{changes.length} 处变更</span>
      </div>
      <div className="divide-y divide-zinc-100">
        {changes.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
            <span className="text-zinc-500">
              {c.scope} · <b className="font-medium text-zinc-700">{c.field}</b>
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {c.before ? (
                <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-600 line-through decoration-red-300">
                  {c.before}
                </span>
              ) : (
                <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-500">空</span>
              )}
              <span className="text-zinc-300">→</span>
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{c.after}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}