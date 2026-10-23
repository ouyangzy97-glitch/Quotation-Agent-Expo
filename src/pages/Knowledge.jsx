import { useEffect, useState } from 'react';
import { Plus, Loader2, Pencil, Trash2 } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';

const KINDS = { term_mapping: '术语映射', rule: '识别规则', calc_logic: '计费逻辑', correction: '修正经验' };
const CATEGORIES = { supplier_alias: '供应商别名', city_alias: '城市别名', fee_item: '费用项目', other: '其他' };
const KIND_TABS = Object.entries(KINDS).map(([value, label]) => ({ value, label }));
// 各类型适用的分类：术语映射可映射各类业务对象；规则仅限费用项目/其他；经验归入其他
const KIND_CATEGORIES = {
  term_mapping: ['supplier_alias', 'city_alias', 'fee_item', 'other'],
  rule: ['fee_item', 'other'],
  calc_logic: ['fee_item', 'other'],
  correction: ['other'],
};
const isTerm = (kind) => kind === 'term_mapping';
const isCalc = (kind) => kind === 'calc_logic';

const EMPTY_FORM = { kind: 'term_mapping', category: 'supplier_alias', term: '', mapped_value: '', content: '', applies_to: '', variablesText: '', expressionsText: '', currency: '', unit: '', enabled: true };

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

export default function Knowledge() {
  const [entries, setEntries] = useState(null);
  const [kindFilter, setKindFilter] = useState('term_mapping');
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const page = await base44.entities.KnowledgeEntry.filter({ kind: kindFilter }, { sort: '-created_date', limit: 200 });
      setEntries(page.items || []);
    } catch {
      setEntries([]);
    }
  };

  useEffect(() => { load(); }, [kindFilter]);

  const openCreate = () => { setForm(EMPTY_FORM); setDialog({ mode: 'create' }); };
  const openEdit = (e) => {
    setForm({
      id: e.id,
      kind: e.kind,
      category: e.category,
      term: e.term || '',
      mapped_value: e.mapped_value || '',
      content: e.content || '',
      applies_to: e.applies_to || '',
      variablesText: (e.variables || []).map((v) => [v.name, v.label, v.unit, v.default].filter((x) => x != null && x !== '').join(' | ')).join('\n'),
      expressionsText: (e.expressions || []).map((x) => (x.label || '费用项') + ' = ' + x.expr).join('\n'),
      currency: e.currency || '',
      unit: e.unit || '',
      enabled: e.enabled !== false,
    });
    setDialog({ mode: 'edit' });
  };

  const changeKind = (kind) => {
    // 切换类型后清除该类型不适用的分类值
    const catOk = (KIND_CATEGORIES[kind] || []).includes(form.category);
    setForm({ ...form, kind, category: catOk ? form.category : (KIND_CATEGORIES[kind] || [])[0] });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = {
        kind: form.kind,
        category: form.category,
        term: isTerm(form.kind) ? form.term : '',
        mapped_value: isTerm(form.kind) ? form.mapped_value : '',
        content: form.content,
        applies_to: isCalc(form.kind) ? form.applies_to : '',
        variables: isCalc(form.kind) ? parseVariables(form.variablesText) : [],
        expressions: isCalc(form.kind) ? parseExpressions(form.expressionsText) : [],
        currency: isCalc(form.kind) ? form.currency : '',
        unit: isCalc(form.kind) ? form.unit : '',
        enabled: !!form.enabled,
      };
      if (dialog.mode === 'edit') {
        await base44.entities.KnowledgeEntry.update(form.id, data);
      } else {
        await base44.entities.KnowledgeEntry.create({ ...data, source: 'manual' });
      }
      setDialog(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await base44.entities.KnowledgeEntry.delete(id);
    await load();
  };

  return (
    <div className="p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-zinc-900">知识库</h1>
          <span className="text-xs text-zinc-400">术语映射、识别规则、计费逻辑与专家修正经验，识别与脚本生成时自动参考</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5">
              {KIND_TABS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setKindFilter(s.value)}
                  className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    kindFilter === s.value ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
            >
              <Plus className="h-3.5 w-3.5" /> 新增条目
            </button>
          </div>
        </div>

        {!entries ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-16 text-center text-sm text-zinc-400">
            暂无条目。可在此手动维护术语映射、识别规则、计费逻辑与修正经验。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">类型</th>
                  <th className="px-4 py-2.5 font-medium">分类</th>
                  <th className="px-4 py-2.5 font-medium">术语</th>
                  <th className="px-4 py-2.5 font-medium">映射值</th>
                  <th className="px-4 py-2.5 font-medium">内容</th>
                  <th className="px-4 py-2.5 font-medium">来源</th>
                  <th className="px-4 py-2.5 font-medium">状态</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {entries.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-zinc-50/60">
                    <td className="px-4 py-3"><span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{KINDS[e.kind] || e.kind}</span></td>
                    <td className="px-4 py-3 text-zinc-600">{CATEGORIES[e.category] || e.category}</td>
                    <td className="px-4 py-3 font-medium text-zinc-900">{e.kind === 'calc_logic' ? (e.applies_to || '—') : (e.term || '—')}</td>
                    <td className="px-4 py-3 text-zinc-600">{e.mapped_value || '—'}</td>
                    <td className="max-w-64 truncate px-4 py-3 text-zinc-600" title={e.kind === 'calc_logic' ? (e.content || '') + ((e.expressions || []).length ? '\n表达式：' + e.expressions.map((x) => x.label + ' = ' + x.expr).join('；') : '') : e.content}>
                      {e.kind === 'calc_logic'
                        ? (e.content || '—') + ((e.expressions || []).length ? ' ｜ ' + e.expressions.length + ' 个表达式' : '')
                        : (e.content || '—')}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{e.source === 'correction' ? '修正沉淀' : '手动维护'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${e.enabled !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-400'}`}>
                        {e.enabled !== false ? '生效中' : '已停用'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openEdit(e)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(e.id)} className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'edit' ? '编辑条目' : '新增知识库条目'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">类型</span>
                <select value={form.kind} onChange={(e) => changeKind(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400">
                  {Object.entries(KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">分类</span>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400">
                  {(KIND_CATEGORIES[form.kind] || Object.keys(CATEGORIES)).map((v) => <option key={v} value={v}>{CATEGORIES[v]}</option>)}
                </select>
              </label>
            </div>
            {isTerm(form.kind) && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">术语 / 别名</span>
                  <input value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400" placeholder="如 SHANGHAI" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">映射目标值</span>
                  <input value={form.mapped_value} onChange={(e) => setForm({ ...form, mapped_value: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400" placeholder="如 上海" />
                </label>
              </div>
            )}
            {isCalc(form.kind) && (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">适用条件</span>
                  <input value={form.applies_to} onChange={(e) => setForm({ ...form, applies_to: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400" placeholder="如 海运整箱，按重量与体积取大" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">变量及默认值（每行一条：名称 | 标签 | 单位 | 默认值）</span>
                  <textarea rows={3} value={form.variablesText} onChange={(e) => setForm({ ...form, variablesText: e.target.value })} className="w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-2 font-mono text-xs outline-none focus:border-zinc-400" placeholder={'weight_kg | 货物重量 | kg | 1000\nvolume_cbm | 体积 | cbm | 1'} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">计算表达式（每行一条：费用名 = 表达式，可引用 input.变量名）</span>
                  <textarea rows={3} value={form.expressionsText} onChange={(e) => setForm({ ...form, expressionsText: e.target.value })} className="w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-2 font-mono text-xs outline-none focus:border-zinc-400" placeholder={'海运费 = max(input.weight_kg / 1000 * input.weight_price, input.volume_cbm * input.volume_price)'} />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-zinc-500">币种</span>
                    <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400" placeholder="如 USD" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-zinc-500">计价单位</span>
                    <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400" placeholder="如 每票" />
                  </label>
                </div>
              </>
            )}
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">内容 / 规则说明</span>
              <textarea rows={3} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400" placeholder="识别规则或经验说明" />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 rounded border-zinc-300" />
              在识别时生效
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDialog(null)} className="rounded-lg border border-zinc-200 px-3.5 py-2 text-sm text-zinc-600 hover:border-zinc-400">取消</button>
              <button onClick={handleSave} disabled={saving} className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}