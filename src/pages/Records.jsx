import { useEffect, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import AppShell from '@/components/AppShell';
import RecognitionCard from '@/components/chat/RecognitionCard';
import DiffCard from '@/components/chat/DiffCard';
import ScriptCard from '@/components/chat/ScriptCard';
import RunCard from '@/components/chat/RunCard';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';

const STATUS_LABELS = {
  draft: '待确认',
  confirmed: '已确认',
  calculated: '已测算',
  archived: '已存档',
};

const STATUS_TABS = [
  { value: '', label: '全部' },
  { value: 'draft', label: '待确认' },
  { value: 'confirmed', label: '已确认' },
  { value: 'calculated', label: '已测算' },
  { value: 'archived', label: '已存档' },
];

export default function Records() {
  const [quotes, setQuotes] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const q = {};
        if (status) q.status = status;
        if (search.trim()) q.supplier_name = { $regex: search.trim() };
        const page = await base44.entities.SupplierQuote.filter(q, { sort: '-created_date', limit: 50 });
        setQuotes(page.items || []);
      } catch {
        setQuotes([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, status]);

  return (
    <div className="p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-zinc-900">报价记录</h1>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="按供应商搜索"
                className="w-56 rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-zinc-400"
              />
            </div>
            <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5">
              {STATUS_TABS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStatus(s.value)}
                  className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    status === s.value ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!quotes ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : quotes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-16 text-center text-sm text-zinc-400">
            暂无记录，去对话页识别第一份报价单
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">供应商</th>
                  <th className="px-4 py-2.5 font-medium">标题</th>
                  <th className="px-4 py-2.5 font-medium">线路</th>
                  <th className="px-4 py-2.5 font-medium">状态</th>
                  <th className="px-4 py-2.5 font-medium">时间</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {quotes.map((q) => (
                  <tr key={q.id} className="transition-colors hover:bg-zinc-50/60">
                    <td className="px-4 py-3 font-medium text-zinc-900">{q.supplier_name}</td>
                    <td className="px-4 py-3 text-zinc-600">{q.title}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {(q.transport_fees || []).map((t) => `${t.origin}→${t.destination}`).join('、') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                        {STATUS_LABELS[q.status] || q.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">
                      {(q.created_date || '').slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setDetail(q)} className="text-xs text-[#E8734A] hover:underline">
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.supplier_name} · {detail?.title}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <RecognitionCard data={{ transport: detail.transport_fees || [], service: detail.service_fees || [] }} />
              {(detail.corrections || []).map((c, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="text-xs text-zinc-400">专家修正 · {(c.date || '').slice(0, 16).replace('T', ' ')}</div>
                  <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">{c.feedback}</div>
                  <DiffCard changes={c.changes || []} />
                </div>
              ))}
              {detail.calc_script && (
                <ScriptCard
                  data={{
                    code: detail.calc_script.code,
                    inputs: detail.calc_script.test_input,
                    output: [],
                    verified: true,
                  }}
                />
              )}
              {(detail.calc_runs || []).map((r, i) => (
                <RunCard key={i} data={r} />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}