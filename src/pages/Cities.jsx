import { useEffect, useState } from 'react';
import { Plus, Loader2, Pencil, Trash2 } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';

const TYPES = { domestic: '国内地级市', foreign: '国外主要城市' };
const TYPE_TABS = [{ value: '', label: '全部' }, ...Object.entries(TYPES).map(([value, label]) => ({ value, label }))];

const EMPTY_FORM = { city: '', country: '中国', region: '', type: 'domestic', aliases: '' };

export default function Cities() {
  const [cities, setCities] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const q = typeFilter ? { type: typeFilter } : {};
      const page = await base44.entities.CityNode.filter(q, { sort: 'city', limit: 500 });
      setCities(page.items || []);
    } catch {
      setCities([]);
    }
  };

  useEffect(() => { load(); }, [typeFilter]);

  const openCreate = () => { setForm(EMPTY_FORM); setDialog({ mode: 'create' }); };
  const openEdit = (c) => {
    setForm({ id: c.id, city: c.city, country: c.country, region: c.region || '', type: c.type, aliases: (c.aliases || []).join(', ') });
    setDialog({ mode: 'edit' });
  };

  const handleSave = async () => {
    if (!form.city.trim() || !form.country.trim()) return;
    setSaving(true);
    try {
      const data = {
        city: form.city.trim(),
        country: form.country.trim(),
        region: form.region.trim(),
        type: form.type,
        aliases: form.aliases.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      };
      if (dialog.mode === 'edit') {
        await base44.entities.CityNode.update(form.id, data);
      } else {
        await base44.entities.CityNode.create(data);
      }
      setDialog(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await base44.entities.CityNode.delete(id);
    await load();
  };

  return (
    <div className="p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-zinc-900">城市节点</h1>
          <span className="text-xs text-zinc-400">起终点字段只能取自本库，颗粒度：国内地级市 + 国外主要城市</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5">
              {TYPE_TABS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setTypeFilter(s.value)}
                  className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    typeFilter === s.value ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50'
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
              <Plus className="h-3.5 w-3.5" /> 新增城市
            </button>
          </div>
        </div>

        {!cities ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
        ) : cities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-16 text-center text-sm text-zinc-400">
            城市库为空。识别前请先维护核心城市节点。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">城市</th>
                  <th className="px-4 py-2.5 font-medium">国家</th>
                  <th className="px-4 py-2.5 font-medium">省份/大区</th>
                  <th className="px-4 py-2.5 font-medium">类型</th>
                  <th className="px-4 py-2.5 font-medium">别名</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {cities.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-zinc-50/60">
                    <td className="px-4 py-3 font-medium text-zinc-900">{c.city}</td>
                    <td className="px-4 py-3 text-zinc-600">{c.country}</td>
                    <td className="px-4 py-3 text-zinc-600">{c.region || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${c.type === 'domestic' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
                        {TYPES[c.type] || c.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{(c.aliases || []).join(' / ') || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openEdit(c)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(c.id)} className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
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
            <DialogTitle>{dialog?.mode === 'edit' ? '编辑城市' : '新增城市节点'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">规范城市名 *</span>
                <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400" placeholder="如 上海 / 汉堡" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">国家 *</span>
                <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">省份 / 大区</span>
                <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">类型</span>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400">
                  {Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">别名（逗号分隔，如 沪, SHANGHAI, CNSHA）</span>
              <input value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-400" />
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