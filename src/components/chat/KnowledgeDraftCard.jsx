import { BookMarked, PanelRightOpen, CheckCircle2 } from 'lucide-react';

const KIND_LABELS = { term_mapping: '术语映射', rule: '识别规则', calc_logic: '计费逻辑', correction: '修正经验' };
const MAX_LINES = 5;

function previewText(d) {
  if (!d) return '';
  if (d.kind === 'term_mapping') return (d.term || '') + ' → ' + (d.mapped_value || '');
  if (d.kind === 'calc_logic') return (d.applies_to || '') + (d.content || '');
  return String(d.content || '');
}

export default function KnowledgeDraftCard({ data, onOpenPanel }) {
  const drafts = data.drafts || [];
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <BookMarked className="h-4 w-4 text-[#E8734A]" />
        <span className="text-sm font-semibold text-zinc-900">知识库草稿已整理</span>
        <span className="text-xs text-zinc-400">{drafts.length} 条待审核</span>
        {data.done && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> 已处理
          </span>
        )}
      </div>
      <div className="divide-y divide-zinc-50 px-4 py-1">
        {drafts.slice(0, MAX_LINES).map((d, i) => (
          <div key={i} className="truncate py-1.5 text-sm text-zinc-700" title={previewText(d)}>
            <span className="mr-2 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{KIND_LABELS[d.kind] || d.kind}</span>
            {previewText(d)}
          </div>
        ))}
        {drafts.length > MAX_LINES && (
          <div className="py-1.5 text-xs text-zinc-400">其余 {drafts.length - MAX_LINES} 条草稿</div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3">
        <button
          onClick={() => onOpenPanel({ type: 'knowledge_draft', ...data })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400"
        >
          <PanelRightOpen className="h-4 w-4 text-[#E8734A]" /> 查看并审核草稿
        </button>
      </div>
    </div>
  );
}