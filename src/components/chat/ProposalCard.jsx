import { ClipboardList, CheckCircle2, PanelRightOpen } from 'lucide-react';

const MAX_PREVIEW = 3;

export default function ProposalCard({ data, actions = false, onApply, onOpenPanel }) {
  const changes = data.changes || [];
  const preview = changes.slice(0, MAX_PREVIEW).map((c) => ({
    scope: c.scope,
    text: `${c.field}: ${c.before || '空'} → ${c.after}`,
  }));

  return (
    <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/50 shadow-sm">
      <div className="flex items-center gap-2 border-b border-amber-100 px-4 py-3">
        <ClipboardList className="h-4 w-4 text-amber-600" />
        <span className="text-sm font-semibold text-zinc-900">修改建议</span>
        <span className="text-xs text-amber-700">{changes.length} 处变更 · 尚未生效</span>
      </div>

      {preview.length > 0 && (
        <div className="divide-y divide-amber-100/70 px-4 py-1">
          {preview.map((p, i) => (
            <div key={i} className="truncate py-1.5 text-sm text-zinc-700">
              <span className="text-zinc-400">{p.scope} · </span>{p.text}
            </div>
          ))}
          {changes.length > MAX_PREVIEW && (
            <div className="py-1.5 text-xs text-zinc-400">其余 {changes.length - MAX_PREVIEW} 处变更</div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/80 px-4 py-3">
        {onOpenPanel && (
          <button
            onClick={() => onOpenPanel(data)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-amber-400"
          >
            <PanelRightOpen className="h-4 w-4 text-amber-600" /> 查看修改内容
          </button>
        )}
        {actions && (
          <button
            onClick={onApply}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
          >
            <CheckCircle2 className="h-4 w-4" /> 确认修改
          </button>
        )}
      </div>
    </div>
  );
}