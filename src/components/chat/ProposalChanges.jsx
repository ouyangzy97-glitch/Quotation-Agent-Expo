import { ClipboardList } from 'lucide-react';

export default function ProposalChanges({ changes }) {
  if (!changes || !changes.length) return null;
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/70 px-5 py-2.5">
        <ClipboardList className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-xs font-semibold text-amber-700">修改内容</span>
        <span className="text-[11px] text-amber-500">{changes.length} 处变更（确认后生效）</span>
      </div>
      <div className="divide-y divide-amber-50">
        {changes.map((c, i) => (
          <div key={i} className="space-y-1 px-5 py-3">
            <div className="text-xs font-medium text-zinc-900">{c.scope} · {c.field}</div>
            <div className="text-xs leading-relaxed">
              <span className="text-zinc-400">原：</span>
              <span className="text-zinc-500 line-through break-all">{c.before || '空'}</span>
            </div>
            <div className="text-xs leading-relaxed">
              <span className="text-zinc-400">新：</span>
              <span className="font-medium text-emerald-700 break-all">{c.after || '空'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}