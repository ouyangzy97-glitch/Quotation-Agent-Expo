import { Ship, Wrench, MapPinned, CheckCircle2, Pencil, PanelRightOpen, ListTree } from 'lucide-react';

const MAX_LINES = 5;

export default function RecognitionCard({ data, actions = false, onConfirm, onCorrect, onOpenPanel }) {
  const transport = data.transport || [];
  const service = data.service || [];
  const routeLines = transport.slice(0, MAX_LINES).map((t) =>
    [`${t.origin} → ${t.destination}`, t.mode, t.unit_weight_price != null ? `重量价 ${t.unit_weight_price}${t.weight_price_unit || ''}` : null, t.unit_volume_price != null ? `体积价 ${t.unit_volume_price}${t.volume_price_unit || ''}` : null].filter(Boolean).join(' · ')
  );

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <Ship className="h-4 w-4 text-[#E8734A]" />
        <span className="text-sm font-semibold text-zinc-900">报价单已识别</span>
        <span className="text-xs text-zinc-400">{transport.length} 条线路 · {service.length} 项服务费</span>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
          <MapPinned className="h-3 w-3" /> 起终点已对齐城市节点库
        </span>
      </div>

      {routeLines.length > 0 && (
        <div className="divide-y divide-zinc-50 px-4 py-1">
          {routeLines.map((line, i) => (
            <div key={i} className="truncate py-1.5 text-sm text-zinc-700">
              {line}
            </div>
          ))}
          {(transport.length > MAX_LINES || service.length > 0) && (
            <div className="flex items-center gap-1.5 py-1.5 text-xs text-zinc-400">
              <ListTree className="h-3 w-3" />
              {transport.length > MAX_LINES && `其余 ${transport.length - MAX_LINES} 条线路`}
              {transport.length > MAX_LINES && service.length > 0 && ' · '}
              {service.length > 0 && `${service.length} 项服务费（${service.slice(0, 3).map((s) => s.name).filter(Boolean).join('、')}${service.length > 3 ? ' 等' : ''}）`}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3">
        {onOpenPanel && (
          <button
            onClick={() => onOpenPanel(data)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400"
          >
            <PanelRightOpen className="h-4 w-4 text-[#E8734A]" /> 查看完整识别内容
          </button>
        )}
        {actions && (
          <>
            <button
              onClick={onConfirm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
            >
              <CheckCircle2 className="h-4 w-4" /> 确认无误，进入测算
            </button>
            <button
              onClick={onCorrect}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400"
            >
              <Pencil className="h-4 w-4" /> 需要修正
            </button>
          </>
        )}
      </div>
    </div>
  );
}