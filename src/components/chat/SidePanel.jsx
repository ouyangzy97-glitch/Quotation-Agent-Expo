import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import PanelContent from './PanelContent';

const MIN_W = 360;
const MAX_W = 1000;
const DEFAULT_W = 440;

export default function SidePanel({ tabs, activeId, onSelect, onCloseTab, onClose, onSave, onRunCalc, onInjectDrafts, busy }) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('panel_width'));
    return saved >= MIN_W && saved <= MAX_W ? saved : DEFAULT_W;
  });
  const draggingRef = useRef(false);
  const active = tabs.find((t) => t.id === activeId) || null;

  const onPointerDown = useCallback(() => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      setWidth(Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - e.clientX)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setWidth((w) => {
        localStorage.setItem('panel_width', String(w));
        return w;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <aside className="relative flex shrink-0 flex-col border-l border-zinc-200 bg-white" style={{ width }}>
      <div
        onPointerDown={onPointerDown}
        title="拖动调整宽度"
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-[#E8734A]/40"
      />
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-zinc-200 px-3 py-2">
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            title={t.title}
            className={`flex max-w-[170px] shrink-0 cursor-pointer items-center gap-1 rounded-full py-1 pl-3 pr-1.5 text-xs transition-colors ${
              t.id === activeId ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <span className="truncate">{t.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(t.id);
              }}
              title="关闭此标签"
              className={`shrink-0 rounded-full p-0.5 transition-colors ${
                t.id === activeId ? 'hover:bg-white/20' : 'hover:bg-zinc-300'
              }`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          onClick={onClose}
          title="关闭面板"
          className="ml-auto shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <PanelContent
        key={active ? active.id : 'empty'}
        data={active ? active.data : null}
        sessionId={active ? active.sessionId : null}
        onSave={onSave}
        onRunCalc={onRunCalc}
        onInjectDrafts={onInjectDrafts}
        busy={busy}
      />
    </aside>
  );
}