import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Check, X, Circle } from 'lucide-react';

const STEP_ICON = {
  done: <Check className="h-3.5 w-3.5 text-zinc-400" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E8734A]" />,
  failed: <X className="h-3.5 w-3.5 text-red-400" />,
  pending: <Circle className="h-2.5 w-2.5 text-zinc-300" />,
};

const STEP_TEXT = {
  done: 'text-zinc-400',
  running: 'font-medium text-zinc-600',
  failed: 'font-medium text-red-500',
  pending: 'text-zinc-300',
};

// 执行日志：Codex 风格的无框灰色步骤列表，实时显示当前阶段，可展开查看
export default function ExecLog({ trace }) {
  const [open, setOpen] = useState(false);
  const steps = (trace && trace.steps) || [];
  if (!steps.length) return null;

  const runningStep = steps.find((s) => s.status === 'running');
  const failed = steps.some((s) => s.status === 'failed');
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const header = failed
    ? '执行失败'
    : runningStep
      ? runningStep.label
      : `已完成 ${doneCount}/${steps.length} 个步骤`;

  return (
    <div className="py-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-[13px] text-zinc-400 transition-colors hover:text-zinc-600"
      >
        {failed ? (
          <X className="h-3.5 w-3.5 shrink-0 text-red-400" />
        ) : runningStep ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#E8734A]" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        )}
        <span>{header}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <ol className="mt-2 space-y-2 pl-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2.5 text-[13px]">
              {STEP_ICON[s.status] || STEP_ICON.pending}
              <span className={STEP_TEXT[s.status] || STEP_TEXT.pending}>{s.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}