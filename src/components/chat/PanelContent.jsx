import { useEffect, useState } from 'react';
import { Ship, Wrench, MapPin, FileUp, History, Pencil, Save, X, Plus, Trash2, Loader2 } from 'lucide-react';
import ProposalChanges from './ProposalChanges';
import CalcPanel from './CalcPanel';
import KnowledgeDraftPanel from './KnowledgeDraftPanel';

const EMPTY_TRANSPORT = { origin: '', destination: '', mode: '', supplier: '', unit_weight_price: null, weight_price_unit: '', unit_volume_price: null, volume_price_unit: '', raw: '' };
const EMPTY_SERVICE = { name: '', raw: '' };

function Field({ label, value, onChange, numeric }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-zinc-400">{label}</span>
      <input
        type={numeric ? 'number' : 'text'}
        step="any"
        value={value == null ? '' : value}
        onChange={(e) => onChange(numeric ? (e.target.value === '' ? null : e.target.value) : e.target.value)}
        className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-[#E8734A]"
      />
    </label>
  );
}

export default function PanelContent({ data, sessionId, onSave, onRunCalc, onInjectDrafts, busy }) {
  const versions = (data && data.versions) || [];
  const lastIdx = versions.length - 1;
  const [versionIdx, setVersionIdx] = useState(() => (versions.length ? versions.length - 1 : 0));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (lastIdx >= 0) setVersionIdx(lastIdx);
  }, [lastIdx]);

  if (data && data.type === 'calc') {
    return <CalcPanel data={data} sessionId={sessionId} onRun={onRunCalc} busy={busy} />;
  }

  if (data && data.type === 'knowledge_draft') {
    return <KnowledgeDraftPanel data={data} sessionId={sessionId} onInject={onInjectDrafts} busy={busy} />;
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-zinc-400">
        暂无内容，点击对话卡片中的「查看」按钮即可在这里打开详情
      </div>
    );
  }
  const shown = versions.length ? versions[Math.min(versionIdx, versions.length - 1)] || {} : data;
  const transport = shown.transport || [];
  const service = shown.service || [];
  const canEdit = !!sessionId && !data.proposal;

  const startEdit = () => {
    setError('');
    setDraft({
      transport: JSON.parse(JSON.stringify(transport)),
      service: JSON.parse(JSON.stringify(service)),
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
    setError('');
  };

  const upd = (kind, i, key, value) => {
    setDraft((d) => {
      const arr = d[kind].slice();
      arr[i] = { ...arr[i], [key]: value };
      return { ...d, [kind]: arr };
    });
  };

  const addRow = (kind) => {
    setDraft((d) => ({
      ...d,
      [kind]: [...d[kind], JSON.parse(JSON.stringify(kind === 'transport' ? EMPTY_TRANSPORT : EMPTY_SERVICE))],
    }));
  };

  const delRow = (kind, i) => {
    setDraft((d) => ({ ...d, [kind]: d[kind].filter((_, x) => x !== i) }));
  };

  const toNum = (v) => {
    if (v === '' || v == null) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const t = draft.transport.map((x) => ({ ...x, unit_weight_price: toNum(x.unit_weight_price), unit_volume_price: toNum(x.unit_volume_price) }));
      const s = draft.service.map((x) => ({ name: x.name, raw: x.raw }));
      await onSave(sessionId, t, s);
      setEditing(false);
      setDraft(null);
    } catch (e) {
      setError('保存失败：' + ((e && e.message) || '请重试'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {editing && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-white px-5 py-2.5">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 保存为新版本
          </button>
          <button
            onClick={cancelEdit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 disabled:opacity-50"
          >
            <X className="h-4 w-4" /> 取消
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}

      {!editing && versions.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-zinc-100 bg-zinc-50/70 px-4 py-2">
          <History className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          {versions.map((v, i) => (
            <button
              key={i}
              onClick={() => setVersionIdx(i)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${
                i === versionIdx ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:bg-zinc-100'
              }`}
            >
              {v.label || '版本 ' + (i + 1)}
            </button>
          ))}
        </div>
      )}

      {data.proposal && <ProposalChanges changes={data.changes || []} />}

      <div className="flex items-center gap-2 bg-zinc-50/70 px-5 py-2.5">
        <Ship className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-xs font-semibold text-zinc-700">{data.proposal ? '运输费 · 修改后预览' : '运输费 · 结构化识别'}</span>
        <span className="text-[11px] text-zinc-400">{(editing ? draft.transport : transport).length} 条线路</span>
        {canEdit && !editing && (
          <button
            onClick={startEdit}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-400"
          >
            <Pencil className="h-3 w-3 text-[#E8734A]" /> 编辑
          </button>
        )}
      </div>
      <div className="divide-y divide-zinc-100">
        {editing
          ? draft.transport.map((t, i) => (
              <div key={i} className="space-y-2 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-[#E8734A]" />
                  <span className="text-xs text-zinc-400">线路 {i + 1}</span>
                  <button
                    onClick={() => delRow('transport', i)}
                    title="删除此线路"
                    className="ml-auto rounded-md p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="起点" value={t.origin} onChange={(v) => upd('transport', i, 'origin', v)} />
                  <Field label="终点" value={t.destination} onChange={(v) => upd('transport', i, 'destination', v)} />
                  <Field label="方式" value={t.mode} onChange={(v) => upd('transport', i, 'mode', v)} />
                  <Field label="供应商" value={t.supplier} onChange={(v) => upd('transport', i, 'supplier', v)} />
                  <Field label="重量价" numeric value={t.unit_weight_price} onChange={(v) => upd('transport', i, 'unit_weight_price', v)} />
                  <Field label="重量价单位" value={t.weight_price_unit} onChange={(v) => upd('transport', i, 'weight_price_unit', v)} />
                  <Field label="体积价" numeric value={t.unit_volume_price} onChange={(v) => upd('transport', i, 'unit_volume_price', v)} />
                  <Field label="体积价单位" value={t.volume_price_unit} onChange={(v) => upd('transport', i, 'volume_price_unit', v)} />
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-zinc-400">原文</span>
                  <textarea
                    rows={3}
                    value={t.raw == null ? '' : t.raw}
                    onChange={(e) => upd('transport', i, 'raw', e.target.value)}
                    className="w-full resize-y rounded-md border border-zinc-200 px-2 py-1.5 text-xs leading-relaxed text-zinc-900 outline-none focus:border-[#E8734A]"
                  />
                </label>
              </div>
            ))
          : transport.map((t, i) => (
              <div key={i} className="space-y-2 px-5 py-3.5">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-[#E8734A]" />
                  {t.origin} <span className="text-zinc-300">→</span> {t.destination}
                  <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-600">{t.mode}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-5.5 text-xs text-zinc-600">
                  <div>
                    <span className="text-zinc-400">重量价</span>{' '}
                    <b className="font-semibold text-zinc-900">{t.unit_weight_price ?? '—'}</b> {t.weight_price_unit || ''}
                  </div>
                  <div>
                    <span className="text-zinc-400">体积价</span>{' '}
                    <b className="font-semibold text-zinc-900">{t.unit_volume_price ?? '—'}</b> {t.volume_price_unit || ''}
                  </div>
                  {t.supplier && (
                    <div>
                      <span className="text-zinc-400">供应商</span>{' '}
                      <b className="font-semibold text-zinc-900">{t.supplier}</b>
                    </div>
                  )}
                </div>
                {t.raw && (
                  <pre className="whitespace-pre-wrap rounded-lg border border-zinc-100 bg-zinc-50 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-500">
                    {t.raw}
                  </pre>
                )}
              </div>
            ))}
        {editing && (
          <button
            onClick={() => addRow('transport')}
            className="flex w-full items-center gap-1.5 px-5 py-2.5 text-xs font-medium text-[#E8734A] transition-colors hover:bg-zinc-50"
          >
            <Plus className="h-3.5 w-3.5" /> 添加线路
          </button>
        )}
        {!editing && !transport.length && <p className="px-5 py-4 text-xs text-zinc-400">无运输费记录</p>}
      </div>

      <div className="mt-2 flex items-center gap-2 border-y border-zinc-100 bg-zinc-50/70 px-5 py-2.5">
        <Wrench className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-xs font-semibold text-zinc-700">{data.proposal ? '服务费 · 修改后预览' : '服务费'}</span>
        <span className="text-[11px] text-zinc-400">{(editing ? draft.service : service).length} 项</span>
      </div>
      <div className="divide-y divide-zinc-100">
        {editing
          ? draft.service.map((s, i) => (
              <div key={i} className="space-y-2 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400">服务费 {i + 1}</span>
                  <button
                    onClick={() => delRow('service', i)}
                    title="删除此服务费"
                    className="ml-auto rounded-md p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Field label="名称" value={s.name} onChange={(v) => upd('service', i, 'name', v)} />
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-zinc-400">描述信息</span>
                  <textarea
                    rows={3}
                    value={s.raw == null ? '' : s.raw}
                    onChange={(e) => upd('service', i, 'raw', e.target.value)}
                    className="w-full resize-y rounded-md border border-zinc-200 px-2 py-1.5 text-xs leading-relaxed text-zinc-900 outline-none focus:border-[#E8734A]"
                  />
                </label>
              </div>
            ))
          : service.map((s, i) => (
              <div key={i} className="space-y-1.5 px-5 py-3.5 text-sm">
                <span className="font-medium text-zinc-900">{s.name || '未命名服务项'}</span>
                {s.raw && <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-500">{s.raw}</p>}
              </div>
            ))}
        {editing && (
          <button
            onClick={() => addRow('service')}
            className="flex w-full items-center gap-1.5 px-5 py-2.5 text-xs font-medium text-[#E8734A] transition-colors hover:bg-zinc-50"
          >
            <Plus className="h-3.5 w-3.5" /> 添加服务费
          </button>
        )}
        {!editing && !service.length && <p className="px-5 py-4 text-xs text-zinc-400">无服务费记录</p>}
      </div>

      {!editing && data.raw_text && (
        <div className="border-t border-zinc-100 bg-zinc-50/70">
          <div className="flex items-center gap-2 px-5 py-2.5">
            <FileUp className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs font-semibold text-zinc-700">报价单原始内容</span>
          </div>
          <div className="max-h-72 overflow-y-auto px-5 pb-5">
            <pre className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-600">
              {data.raw_text}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}