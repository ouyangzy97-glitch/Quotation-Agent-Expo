import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, AlertTriangle, SkipForward } from 'lucide-react';

const KIND_LABELS = { term_mapping: '术语映射', rule: '识别规则', calc_logic: '计费逻辑', correction: '修正经验' };
const CATEGORY_LABELS = { supplier_alias: '供应商别名', city_alias: '城市别名', fee_item: '费用项目', other: '其他' };
const KIND_CATEGORIES = {
  term_mapping: ['supplier_alias', 'city_alias', 'fee_item', 'other'],
  rule: ['fee_item', 'other'],
  calc_logic: ['fee_item', 'other'],
  correction: ['other'],
};
const isTerm = (kind) => kind === 'term_mapping';
const isCalc = (kind) => kind === 'calc_logic';

// 「变量及默认值」每行一条：名称 | 标签 | 单位 | 默认值
const parseVariables = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [name, label, unit, dflt] = l.split('|').map((p) => p.trim());
  const num = Number(dflt);
  return { name, label: label || name, unit: unit || '', default: dflt !== '' && !Number.isNaN(num) ? num : (dflt || '') };
}).filter((v) => v.name);

// 「计算表达式」每行一条：费用名 = 表达式
const parseExpressions = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const i = l.indexOf('=');
  return i > 0 ? { label: l.slice(0, i).trim(), expr: l.slice(i + 1).trim() } : { label: '', expr: l };
}).filter((x) => x.expr);

function toEditable(d) {
  return {
    ...d,
    action: d.duplicates && d.duplicates.length ? 'update' : 'create',
    target_id: d.duplicates && d.duplicates.length ? d.duplicates[0].id : null,
    variablesText: (d.variables || []).map((v) => [v.name, v.label, v.unit, v.default].filter((x) => x != null && x !== '').join(' | ')).join('\n'),
    expressionsText: (d.expressions || []).map((x) => (x.label || '费用项') + ' = ' + x.expr).join('\n'),
  };
}

function buildEntry(it) {
  return {
    kind: it.kind,
    category: it.category,
    term: isTerm(it.kind) ? it.term : '',
    mapped_value: isTerm(it.kind) ? it.mapped_value : '',
    content: it.content || '',
    applies_to: isCalc(it.kind) ? it.applies_to : '',
    variables: isCalc(it.kind) ? parseVariables(it.variablesText) : [],
    expressions: isCalc(it.kind) ? parseExpressions(it.expressionsText) : [],
    currency: isCalc(it.kind) ? it.currency || '' : '',
    unit: isCalc(it.kind) ? it.unit || '' : '',
  };
}

const previewText = (d) =>
  d.kind === 'term_mapping'
    ? (d.term || '') + ' → ' + (d.mapped_value || '')
    : d.kind === 'calc_logic'
    ? (d.applies_to || '') + (d.content || '')
    : String(d.content || '').slice(0, 80);

function Input({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-zinc-400">{label}</span>
      <input
        value={value == null ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-[#E8734A]"
      />
    </label>
  );
}

function Area({ label, value, onChange, rows = 3, mono, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-zinc-400">{label}</span>
      <textarea
        rows={rows}
        value={value == null ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full resize-y rounded-md border border-zinc-200 px-2 py-1.5 text-xs leading-relaxed text-zinc-900 outline-none focus:border-[#E8734A] ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

export default function KnowledgeDraftPanel({ data, sessionId, onInject, busy }) {
  const [items, setItems] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (data && Array.isArray(data.drafts)) setItems(data.drafts.map(toEditable));
  }, [data]);

  if (!items) {
    return <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-zinc-400">暂无草稿</div>;
  }

  const upd = (i, patch) => setItems((arr) => arr.map((it, x) => (x === i ? { ...it, ...patch } : it)));

  const changeKind = (i, kind) => {
    const catOk = (KIND_CATEGORIES[kind] || []).includes(items[i].category);
    upd(i, { kind, category: catOk ? items[i].category : (KIND_CATEGORIES[kind] || [])[0] });
  };

  const changeAction = (i, action) => {
    const dups = items[i].duplicates || [];
    const targetOk = dups.some((d) => d.id === items[i].target_id);
    upd(i, { action, target_id: action === 'update' ? (targetOk ? items[i].target_id : (dups[0] ? dups[0].id : null)) : items[i].target_id });
  };

  const save = async () => {
    const rows = items
      .filter((it) => it.action === 'create' || (it.action === 'update' && it.target_id))
      .map((it) => ({
        id: it.id,
        action: it.action,
        target_id: it.action === 'update' ? it.target_id : null,
        entry: buildEntry(it),
      }));
    if (!rows.length) {
      setError('全部草稿均已跳过，没有可注入的内容');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onInject(sessionId, rows);
    } catch (e) {
      setError('注入失败：' + ((e && e.message) || '请重试'));
    } finally {
      setSaving(false);
    }
  };

  if (data.done) {
    const r = data.result || {};
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 bg-emerald-50 px-5 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> 已注入知识库：新增 {r.created || 0} 条、更新 {r.updated || 0} 条
        </div>
        <div className="divide-y divide-zinc-100">
          {(data.drafts || []).map((d, i) => (
            <div key={i} className="px-5 py-3 text-sm text-zinc-700">
              <span className="mr-2 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{KIND_LABELS[d.kind] || d.kind}</span>
              {previewText(d)}
            </div>
          ))}
        </div>
        <p className="px-5 py-4 text-xs text-zinc-400">可在「知识库」页面进一步维护这些条目。</p>
      </div>
    );
  }

  const activeCount = items.filter((it) => it.action === 'create' || (it.action === 'update' && it.target_id)).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-zinc-100 bg-zinc-50/70 px-5 py-2.5 text-xs text-zinc-500">
          请逐条检查草稿：可直接编辑内容，并选择「新增条目」「更新原条目」或「跳过」。确认后才会写入知识库。
        </div>
        {items.map((it, i) => (
          <div key={it.id || i} className="space-y-2.5 border-b border-zinc-100 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{KIND_LABELS[it.kind] || it.kind}</span>
              {(it.duplicates || []).length > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                  <AlertTriangle className="h-3 w-3" /> {it.duplicates.length} 条可能重复
                </span>
              )}
            </div>
            {it.reason && <p className="text-[11px] text-zinc-400">来源：{it.reason}</p>}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-zinc-400">类型</span>
                <select
                  value={it.kind}
                  onChange={(e) => changeKind(i, e.target.value)}
                  className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-[#E8734A]"
                >
                  {Object.entries(KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-zinc-400">分类</span>
                <select
                  value={it.category}
                  onChange={(e) => upd(i, { category: e.target.value })}
                  className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-[#E8734A]"
                >
                  {(KIND_CATEGORIES[it.kind] || ['other']).map((v) => <option key={v} value={v}>{CATEGORY_LABELS[v]}</option>)}
                </select>
              </label>
            </div>

            {isTerm(it.kind) && (
              <div className="grid grid-cols-2 gap-2">
                <Input label="术语 / 别名" value={it.term} onChange={(v) => upd(i, { term: v })} placeholder="如 SHANGHAI" />
                <Input label="映射目标值" value={it.mapped_value} onChange={(v) => upd(i, { mapped_value: v })} placeholder="如 上海" />
              </div>
            )}
            {isCalc(it.kind) && (
              <>
                <Input label="适用条件" value={it.applies_to} onChange={(v) => upd(i, { applies_to: v })} placeholder="如 海运整箱，按重量与体积取大" />
                <Area label="变量及默认值（每行：名称 | 标签 | 单位 | 默认值）" mono rows={3} value={it.variablesText} onChange={(v) => upd(i, { variablesText: v })} placeholder={'weight_kg | 货物重量 | kg | 1000'} />
                <Area label="计算表达式（每行：费用名 = 表达式）" mono rows={3} value={it.expressionsText} onChange={(v) => upd(i, { expressionsText: v })} placeholder={'海运费 = max(input.weight_kg / 1000 * input.weight_price, input.volume_cbm * input.volume_price)'} />
                <div className="grid grid-cols-2 gap-2">
                  <Input label="币种" value={it.currency} onChange={(v) => upd(i, { currency: v })} placeholder="如 USD" />
                  <Input label="计价单位" value={it.unit} onChange={(v) => upd(i, { unit: v })} placeholder="如 每票" />
                </div>
              </>
            )}
            <Area label="内容 / 规则说明" value={it.content} onChange={(v) => upd(i, { content: v })} rows={3} placeholder="规则或经验说明" />

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => changeAction(i, 'create')}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${it.action === 'create' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                新增条目
              </button>
              {(it.duplicates || []).length > 0 && (
                <button
                  onClick={() => changeAction(i, 'update')}
                  className={`rounded-full px-2.5 py-1 text-xs transition-colors ${it.action === 'update' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                >
                  更新原条目
                </button>
              )}
              <button
                onClick={() => changeAction(i, 'skip')}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors ${it.action === 'skip' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                <SkipForward className="h-3 w-3" /> 跳过
              </button>
            </div>

            {it.action === 'update' && (it.duplicates || []).length > 0 && (
              <label className="block">
                <span className="mb-1 block text-[11px] text-zinc-400">选择要更新的已有条目</span>
                <select
                  value={it.target_id || ''}
                  onChange={(e) => upd(i, { target_id: e.target.value })}
                  className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-[#E8734A]"
                >
                  {(it.duplicates || []).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </label>
            )}
            {it.action === 'create' && (it.duplicates || []).length > 0 && (
              <p className="text-[11px] text-amber-600">注意：可能与「{(it.duplicates[0] || {}).label}」重复，确认后仍会保留为新条目。</p>
            )}
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-white px-5 py-2.5">
        <button
          onClick={save}
          disabled={saving || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} 确认注入知识库
        </button>
        <span className="text-[11px] text-zinc-400">待注入 {activeCount} 条，跳过的不会写入</span>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}