import { Bot, FileUp } from 'lucide-react';
import ExecLog from './ExecLog';
import RecognitionCard from './RecognitionCard';
import DiffCard from './DiffCard';
import ProposalCard from './ProposalCard';
import ScriptCard from './ScriptCard';
import RunCard from './RunCard';
import KnowledgeDraftCard from './KnowledgeDraftCard';

export default function ChatMessageItem({
  msg,
  isLast,
  stage,
  busy,
  onConfirm,
  onCorrect,
  onOpenPanel,
  onApply,
  onOpenCalcPanel,
  execTrace,
}) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-sm leading-relaxed text-white">
          {msg.attachment_name && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">
              <FileUp className="h-3.5 w-3.5 text-[#E8734A]" />
              {msg.attachment_name}
            </div>
          )}
          {msg.text}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#E8734A]/10">
          <Bot className="h-3.5 w-3.5 text-[#E8734A]" />
        </span>
        <span className="text-xs font-medium text-zinc-500">报价智能体</span>
      </div>
      {execTrace && <ExecLog trace={execTrace} />}
      {msg.text && <p className="text-sm leading-relaxed text-zinc-700">{msg.text}</p>}
      {(msg.blocks || []).map((b, i) => {
        if (!b) return null;
        if (b.type === 'recognition') {
          return (
            <RecognitionCard
              key={i}
              data={b.data || {}}
              actions={isLast && stage === 'awaiting_confirm' && !busy}
              onConfirm={onConfirm}
              onCorrect={onCorrect}
              onOpenPanel={onOpenPanel}
            />
          );
        }
        if (b.type === 'proposal') {
          return (
            <ProposalCard
              key={i}
              data={b.data || {}}
              actions={isLast && stage === 'awaiting_apply' && !busy}
              onApply={onApply}
              onOpenPanel={onOpenPanel}
            />
          );
        }
        if (b.type === 'diff') return <DiffCard key={i} changes={(b.data && b.data.changes) || []} />;
        if (b.type === 'script') return <ScriptCard key={i} data={b.data || {}} onOpen={onOpenCalcPanel} />;
        if (b.type === 'run') return <RunCard key={i} data={b.data || {}} />;
        if (b.type === 'knowledge_draft') {
          return <KnowledgeDraftCard key={i} data={b.data || {}} onOpenPanel={(d) => onOpenPanel({ type: 'knowledge_draft', ...d })} />;
        }
        return null;
      })}
    </div>
  );
}