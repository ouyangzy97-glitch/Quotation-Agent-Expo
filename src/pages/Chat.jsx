import { Fragment, useEffect, useRef, useState } from 'react';
import { Paperclip, ArrowUp, FileUp, Plus, Loader2, Trash2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import AppShell from '@/components/AppShell';
import ChatMessageItem from '@/components/chat/ChatMessageItem';
import SidePanel from '@/components/chat/SidePanel';
import ExecLog from '@/components/chat/ExecLog';
import { base44 } from '@/api/base44Client';

const STAGE_LABELS = {
  idle: '待输入',
  recognizing: '识别中',
  awaiting_confirm: '识别结果待确认',
  awaiting_apply: '修改建议待确认',
  calculating: '测算中',
  calculated: '脚本已生成',
  done: '已完成',
  clarifying: '反馈意图澄清中',
};

function EmptyState({ onPick }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-8 py-14 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#E8734A]/10">
        <FileUp className="h-6 w-6 text-[#E8734A]" />
      </div>
      <h2 className="text-base font-semibold text-zinc-900">识别供应商报价单</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-zinc-500">
        上传 PDF / 图片 / Excel / Word 报价单（文件私密存储），或直接在下方粘贴报价文字。
        识别结果经专家确认修正后，再生成测算脚本并存档备查。
      </p>
      <button
        onClick={onPick}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
      >
        <Paperclip className="h-4 w-4" /> 上传报价单
      </button>
    </div>
  );
}

function SessionSidebar({ sessions, activeId, onSelect, onCreate, onDelete, deletingId }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:flex">
      <div className="p-3">
        <button
          onClick={onCreate}
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
        >
          <Plus className="h-4 w-4 text-[#E8734A]" /> 新建对话
        </button>
      </div>
      <div className="px-4 pb-1.5 pt-2 text-[11px] font-medium text-zinc-400">历史对话</div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-1 rounded-lg pr-1.5 transition-colors ${
              activeId === s.id ? 'bg-zinc-200/70' : 'hover:bg-zinc-200/50'
            }`}
          >
            <button
              onClick={() => onSelect(s.id)}
              className={`min-w-0 flex-1 truncate px-3 py-2 text-left text-sm ${
                activeId === s.id ? 'font-medium text-zinc-900' : 'text-zinc-600'
              }`}
              title={s.title}
            >
              {s.title}
            </button>
            <button
              onClick={() => onDelete(s)}
              disabled={deletingId === s.id}
              title="删除对话"
              className="shrink-0 rounded-md p-1.5 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-300/60 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
            >
              {deletingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        ))}
        {!sessions.length && <p className="px-3 py-2 text-xs text-zinc-400">暂无历史会话</p>}
      </div>
    </aside>
  );
}

export default function Chat() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pendingBySession, setPendingBySession] = useState({});
  const [uploadingBySession, setUploadingBySession] = useState({});
  const [traces, setTraces] = useState({});
  const [input, setInput] = useState('');
  const pending = activeId ? (pendingBySession[activeId] || null) : null;
  const uploading = !!(activeId && uploadingBySession[activeId]);
  const busy = !!pending || uploading;
  const [panelTabs, setPanelTabs] = useState([]);
  const [panelActive, setPanelActive] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [llmModel, setLlmModel] = useState(() => (localStorage.getItem('llm_model') === 'flash' ? 'flash' : 'pro'));
  const fileRef = useRef(null);
  const textareaRef = useRef(null);
  const bottomRef = useRef(null);
  const activeIdRef = useRef(null);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // 切换会话时同步该会话使用的模型
  useEffect(() => {
    if (session && session.llm_model && session.llm_model !== llmModel) {
      setLlmModel(session.llm_model);
      localStorage.setItem('llm_model', session.llm_model);
    }
  }, [session?.id, session?.llm_model]);

  const refreshSession = async (sid) => {
    try {
      const s = await base44.entities.ChatSession.get(sid);
      setSession(s);
      const page = await base44.entities.ChatMessage.filter({ session_id: sid }, { sort: 'created_date', limit: 200 });
      const items = page.items || [];
      setMessages(items);
      let latest = null;
      for (const m of items) {
        for (const b of (m.blocks || [])) {
          if (b && b.type === 'recognition' && b.data) latest = b.data;
        }
      }
      if (latest) {
        setPanelTabs((prev) => prev.map((t) => (t.sessionId === sid && t.data && !t.data.proposal && t.data.type !== 'calc' ? { ...t, data: latest } : t)));
      }
      return items;
    } catch {
      /* 会话可能已被删除 */
      return null;
    }
  };

  const loadAll = async (sid) => {
    if (!sid) return null;
    setPanelTabs((prev) => prev.filter((t) => t.sessionId === sid));
    return await refreshSession(sid);
  };

  useEffect(() => {
    if (activeId) loadAll(activeId);
  }, [activeId]);

  useEffect(() => {
    base44.entities.ChatSession.list({ sort: '-created_date', limit: 30 })
      .then((page) => setSessions(page.items || []))
      .catch(() => {});
    const unsub = base44.entities.ChatMessage.subscribe((event) => {
      if (event.data?.session_id === activeIdRef.current) loadAll(activeIdRef.current);
    });
    return unsub;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pending]);

  useEffect(() => {
    if (!panelTabs.length) {
      if (panelOpen) setPanelOpen(false);
      if (panelActive) setPanelActive(null);
      return;
    }
    if (!panelTabs.some((t) => t.id === panelActive)) {
      setPanelActive(panelTabs[panelTabs.length - 1].id);
    }
  }, [panelTabs]);

  const handleModelChange = async (m) => {
    setLlmModel(m);
    localStorage.setItem('llm_model', m);
    if (!activeId) return;
    try {
      await base44.entities.ChatSession.update(activeId, { llm_model: m });
      setSession((prev) => (prev && prev.id === activeId ? { ...prev, llm_model: m } : prev));
    } catch { /* 会话可能已被删除 */ }
  };

  const createSession = async (title) => {
    const s = await base44.entities.ChatSession.create({ title: title || '新报价识别', stage: 'idle', llm_model: llmModel });
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setSession(s);
    setMessages([]);
    return s.id;
  };

  const refreshSessions = async () => {
    try {
      const page = await base44.entities.ChatSession.list({ sort: '-created_date', limit: 30 });
      setSessions(page.items || []);
    } catch { /* ignore */ }
  };

  const setPendingFor = (sid, key) => setPendingBySession((m) => {
    const next = { ...m };
    if (key) next[sid] = key; else delete next[sid];
    return next;
  });
  const setUploadingFor = (sid, on) => setUploadingBySession((m) => {
    const next = { ...m };
    if (on) next[sid] = true; else delete next[sid];
    return next;
  });

  // 执行日志：记录每个流程的关键阶段（意图路由 / 知识库检索 / 执行操作 / 完成）
  const startTrace = (key, labels) => {
    setTraces((m) => ({
      ...m,
      [key]: { steps: labels.map((label, i) => ({ label, status: i === 0 ? 'running' : 'pending' })) },
    }));
  };
  const setStepStatus = (key, i, status) => setTraces((m) => {
    const t = m[key];
    if (!t || !t.steps || !t.steps[i]) return m;
    return { ...m, [key]: { steps: t.steps.map((s, idx) => (idx === i ? { ...s, status } : s)) } };
  });
  const advanceStep = (key, i) => {
    setStepStatus(key, i, 'done');
    setStepStatus(key, i + 1, 'running');
  };
  const appendSteps = (key, labels) => setTraces((m) => {
    const t = m[key];
    if (!t || !t.steps || !t.steps.length) return m;
    const prev = t.steps.map((s, idx) => (idx === t.steps.length - 1 ? { ...s, status: 'done' } : s));
    return { ...m, [key]: { steps: [...prev, ...labels.map((label) => ({ label, status: 'pending' }))] } };
  });
  // 以临时 key 记录的日志，完成后挂到对应消息上，随消息流保留（新命令不再覆盖旧日志）
  const rekeyTrace = (sid, msgs, mode) => {
    const tmpKey = `tmp-${sid}`;
    setTraces((m) => {
      const t = m[tmpKey];
      if (!t || !msgs || !msgs.length) return m;
      const target = mode === 'last' ? msgs[msgs.length - 1] : [...msgs].reverse().find((x) => x.role === 'user');
      if (!target || m[target.id]) return m;
      const n = { ...m };
      delete n[tmpKey];
      n[target.id] = t;
      return n;
    });
  };

  // 意图 → 既有流程的执行与进行中提示
  const ACTION_PENDING = {
    parse: 'parsing',
    calc: 'calc',
    regen_script: 'calc',
    apply: 'apply',
    correct_quote: 'correcting',
    update_script: 'calc_fix',
    run_calc: 'run',
    answer_question: 'qa',
    distill_knowledge: 'distilling',
  };

  const ACTION_LABELS = {
    parse: '识别报价单内容',
    calc: '生成测算脚本',
    regen_script: '重新生成测算脚本',
    apply: '应用修改建议',
    correct_quote: '生成修改建议',
    update_script: '更新测算脚本',
    run_calc: '执行测算',
    answer_question: '回答报价问题',
    distill_knowledge: '整理知识库草稿',
  };

  const runAction = async (sid, action, feedback, needsKnowledge, scope) => {
    if (action === 'parse') {
      await base44.functions.invoke('parseQuote', { session_id: sid, text: feedback });
    } else if (action === 'calc') {
      await base44.functions.invoke('generateCalc', { session_id: sid });
    } else if (action === 'regen_script') {
      await base44.functions.invoke('generateCalc', { session_id: sid, scope: scope === 'transport' ? 'transport' : 'all' });
    } else if (action === 'apply') {
      await base44.functions.invoke('applyCorrection', { session_id: sid });
    } else if (action === 'correct_quote') {
      await base44.functions.invoke('correctQuote', { session_id: sid, feedback, needs_knowledge: needsKnowledge });
    } else if (action === 'update_script') {
      await base44.functions.invoke('updateCalc', { session_id: sid, feedback, needs_knowledge: needsKnowledge });
    } else if (action === 'run_calc') {
      await base44.functions.invoke('runCalc', { session_id: sid });
    } else if (action === 'answer_question') {
      await base44.functions.invoke('answerQuestion', { session_id: sid, feedback });
    } else if (action === 'distill_knowledge') {
      await base44.functions.invoke('distillKnowledge', { session_id: sid });
    }
    // clarify：后端已在对话中写入澄清问题，等待用户回答
  };

  const handleSend = async () => {
    const t = input.trim();
    if (!t || pending) return;
    setInput('');
    let sid = activeId;
    if (!sid) sid = await createSession();
    // 会话尚无报价单：整理指令提示无可整理内容；其余直接进入识别（parseQuote 自行记录用户消息）
    if (!session || !session.quote_id) {
      if (/整理|沉淀|注入|归档/.test(t) && /知识/.test(t)) {
        await base44.entities.ChatMessage.create({
          session_id: sid,
          role: 'assistant',
          text: '当前会话还没有可整理的报价对话内容。请先识别报价单、给出反馈或生成测算脚本后，再输入「整理反馈注入知识库」。',
        });
        await loadAll(sid);
        refreshSessions();
        return;
      }
      startTrace(`tmp-${sid}`, ['检索知识库', '识别报价单内容']);
      setPendingFor(sid, 'retrieval');
      let parseSettled = false;
      const swapTimer = setTimeout(() => {
        if (!parseSettled) {
          setPendingBySession((m) => (m[sid] === 'retrieval' ? { ...m, [sid]: 'parsing' } : m));
          advanceStep(`tmp-${sid}`, 0);
        }
      }, 1500);
      try {
        await base44.functions.invoke('parseQuote', { session_id: sid, text: t });
        parseSettled = true;
        setStepStatus(`tmp-${sid}`, 0, 'done');
        setStepStatus(`tmp-${sid}`, 1, 'done');
      } catch {
        parseSettled = true;
        setStepStatus(`tmp-${sid}`, 1, 'failed');
      }
      clearTimeout(swapTimer);
      setPendingFor(sid, null);
      const items = await loadAll(sid);
      rekeyTrace(sid, items, 'user');
      refreshSessions();
      return;
    }
    // 已有报价单：先判断反馈意图，明确则直接执行对应既有流程
    let userMsgId = null;
    try {
      const um = await base44.entities.ChatMessage.create({ session_id: sid, role: 'user', text: t });
      userMsgId = um && um.id;
    } catch { /* 消息记录失败不阻断流程 */ }
    const traceKey = userMsgId || `tmp-${sid}`;
    startTrace(traceKey, ['理解反馈意图']);
    setPendingFor(sid, 'routing');
    try {
      const res = await base44.functions.invoke('routeFeedback', { session_id: sid, feedback: t });
      const action = res && res.data && res.data.action;
      if (action === 'none') {
        setStepStatus(traceKey, 0, 'done');
        await base44.entities.ChatMessage.create({
          session_id: sid,
          role: 'assistant',
          text: '当前流程正在处理中，请稍候再输入反馈。',
        });
      } else if (action && action !== 'clarify') {
        const nextKey = ACTION_PENDING[action] || 'correcting';
        // 「正在检索知识库」仅在本次反馈确实需要知识依据时显示
        const needsKb = action === 'answer_question' || res.data.needs_knowledge === true;
        const labels = needsKb
          ? ['检索知识库', ACTION_LABELS[action] || '处理反馈']
          : [ACTION_LABELS[action] || '处理反馈'];
        appendSteps(traceKey, labels);
        const actionIdx = needsKb ? 2 : 1;
        advanceStep(traceKey, 0);
        if (needsKb) {
          setPendingFor(sid, 'retrieval');
          let settled = false;
          const swapTimer = setTimeout(() => {
            if (!settled) {
              setPendingBySession((m) => (m[sid] === 'retrieval' ? { ...m, [sid]: nextKey } : m));
              advanceStep(traceKey, 1);
            }
          }, 1500);
          try {
            // 澄清后执行时使用「原始反馈 + 澄清回答」的合并内容，避免丢失原始诉求
            await runAction(sid, action, res.data.feedback || t, res.data.needs_knowledge === true, res.data.scope);
            settled = true;
            setStepStatus(traceKey, 1, 'done');
            setStepStatus(traceKey, actionIdx, 'done');
          } catch {
            settled = true;
            setStepStatus(traceKey, 1, 'done');
            setStepStatus(traceKey, actionIdx, 'failed');
          }
          clearTimeout(swapTimer);
        } else {
          setPendingFor(sid, nextKey);
          try {
            // 澄清后执行时使用「原始反馈 + 澄清回答」的合并内容，避免丢失原始诉求
            await runAction(sid, action, res.data.feedback || t, res.data.needs_knowledge === true, res.data.scope);
            setStepStatus(traceKey, actionIdx, 'done');
          } catch {
            setStepStatus(traceKey, actionIdx, 'failed');
          }
        }
      } else {
        // clarify：后端已写入澄清问题，路由完成
        setStepStatus(traceKey, 0, 'done');
      }
    } catch {
      setStepStatus(traceKey, 0, 'failed');
      await base44.entities.ChatMessage.create({
        session_id: sid,
        role: 'assistant',
        text: '反馈处理失败，请稍后重试或换个说法描述你的意图。',
      });
    }
    setPendingFor(sid, null);
    await loadAll(sid);
    refreshSessions();
  };

  const handleFile = async (file) => {
    if (!file || pending) return;
    let sid = null;
    try {
      // 当前会话尚无报价单时直接复用，避免重复新建对话
      sid = activeId;
      if (sid && session && !session.quote_id) {
        const title = file.name.replace(/\.[^.]+$/, '');
        const s = await base44.entities.ChatSession.update(sid, { title });
        setSession(s);
        setSessions((prev) => prev.map((x) => (x.id === sid ? { ...x, title: s.title } : x)));
      } else {
        sid = await createSession(file.name.replace(/\.[^.]+$/, ''));
      }
      setUploadingFor(sid, true);
      startTrace(`tmp-${sid}`, ['上传报价单文件', '检索知识库', '识别报价单内容']);
      try {
        const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
        const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 1800 });
        advanceStep(`tmp-${sid}`, 0);
        setPendingFor(sid, 'parsing');
        let parseSettled = false;
        const swapTimer = setTimeout(() => {
          if (!parseSettled) advanceStep(`tmp-${sid}`, 1);
        }, 1500);
        try {
          await base44.functions.invoke('parseQuote', { session_id: sid, file_url: signed_url, file_uri, file_name: file.name });
          parseSettled = true;
          setStepStatus(`tmp-${sid}`, 1, 'done');
          setStepStatus(`tmp-${sid}`, 2, 'done');
        } catch {
          parseSettled = true;
          setStepStatus(`tmp-${sid}`, 2, 'failed');
        }
        clearTimeout(swapTimer);
        setPendingFor(sid, null);
      } catch {
        setStepStatus(`tmp-${sid}`, 0, 'failed');
      }
      const items = await loadAll(sid);
      rekeyTrace(sid, items, 'user');
      refreshSessions();
    } finally {
      if (sid) setUploadingFor(sid, false);
    }
  };

  const handleConfirm = async () => {
    const sid = activeId;
    if (!sid || pending) return;
    // 生成测算脚本前会先按报价内容检索知识库，日志中分两步展示
    setPendingFor(sid, 'retrieval');
    startTrace(`tmp-${sid}`, ['检索知识库', '生成测算脚本']);
    let calcSettled = false;
    const swapTimer = setTimeout(() => {
      if (!calcSettled) {
        setPendingBySession((m) => (m[sid] === 'retrieval' ? { ...m, [sid]: 'calc' } : m));
        advanceStep(`tmp-${sid}`, 0);
      }
    }, 1500);
    try {
      await base44.functions.invoke('generateCalc', { session_id: sid });
      calcSettled = true;
      setStepStatus(`tmp-${sid}`, 0, 'done');
      setStepStatus(`tmp-${sid}`, 1, 'done');
    } catch {
      calcSettled = true;
      setStepStatus(`tmp-${sid}`, 1, 'failed');
    }
    clearTimeout(swapTimer);
    setPendingFor(sid, null);
    const items = await loadAll(sid);
    rekeyTrace(sid, items, 'last');
    refreshSessions();
  };

  const handleApply = async () => {
    const sid = activeId;
    if (!sid || pending) return;
    setPendingFor(sid, 'apply');
    startTrace(`tmp-${sid}`, ['应用修改建议']);
    try {
      await base44.functions.invoke('applyCorrection', { session_id: sid });
      setStepStatus(`tmp-${sid}`, 0, 'done');
    } catch {
      setStepStatus(`tmp-${sid}`, 0, 'failed');
    }
    setPendingFor(sid, null);
    const items = await loadAll(sid);
    rekeyTrace(sid, items, 'last');
    refreshSessions();
  };

  const handleInjectKnowledge = async (sid, rows) => {
    const res = await base44.functions.invoke('injectKnowledge', { session_id: sid, drafts: rows });
    const r = (res && res.data) || {};
    setPanelTabs((prev) =>
      prev.map((t) =>
        t.sessionId === sid && t.data && t.data.type === 'knowledge_draft'
          ? { ...t, data: { ...t.data, done: true, result: { created: r.created || 0, updated: r.updated || 0 } } }
          : t
      )
    );
    await refreshSession(sid);
  };

  const handlePanelSave = async (sid, transport, service) => {
    await base44.functions.invoke('editQuote', { session_id: sid, transport, service });
    await refreshSession(sid);
    refreshSessions();
  };

  const handleDeleteSession = async (s) => {
    if (deletingId || !window.confirm(`确定删除对话「${s.title}」？删除后不可恢复。`)) return;
    setDeletingId(s.id);
    try {
      await base44.entities.ChatMessage.deleteMany({ session_id: s.id });
      await base44.entities.ChatSession.delete(s.id);
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      setPendingBySession((m) => { const n = { ...m }; delete n[s.id]; return n; });
      setUploadingBySession((m) => { const n = { ...m }; delete n[s.id]; return n; });
      setTraces((m) => { const n = { ...m }; delete n['tmp-' + s.id]; return n; });
      if (activeId === s.id) {
        setActiveId(null);
        setSession(null);
        setMessages([]);
        setPanelTabs((prev) => prev.filter((t) => t.sessionId !== s.id));
      }
    } finally {
      setDeletingId(null);
    }
  };

  const openPanel = (data) => {
    const title = data && data.type === 'knowledge_draft'
      ? '知识草稿审核'
      : data && data.proposal
      ? '修改建议'
      : ((data && (data.title || data.supplier_name)) || session?.title || '识别内容');
    const existing = data && data.type === 'knowledge_draft'
      ? panelTabs.find((t) => t.data && t.data.type === 'knowledge_draft' && t.sessionId === activeId)
      : panelTabs.find((t) => t.data === data);
    if (existing) {
      setPanelTabs((prev) => prev.map((t) => (t.id === existing.id ? { ...t, data } : t)));
      setPanelActive(existing.id);
    } else {
      const tab = { id: 't' + Date.now() + Math.floor(Math.random() * 1000), title, data, sessionId: activeId };
      setPanelTabs((prev) => [...prev, tab]);
      setPanelActive(tab.id);
    }
    setPanelOpen(true);
  };

  const closePanelTab = (id) => {
    const idx = panelTabs.findIndex((t) => t.id === id);
    const next = panelTabs.filter((t) => t.id !== id);
    setPanelTabs(next);
    if (id === panelActive) setPanelActive(next[Math.min(idx, next.length - 1)]?.id || null);
    if (!next.length) setPanelOpen(false);
  };

  const handleCorrect = () => {
    textareaRef.current?.focus();
  };

  const openCalcPanel = async () => {
    if (!session || !session.quote_id) return;
    let quote = null;
    try {
      quote = await base44.entities.SupplierQuote.get(session.quote_id);
    } catch { return; }
    if (!quote || !quote.calc_script) return;
    const data = { type: 'calc', quote };
    const existing = panelTabs.find((t) => t.data && t.data.type === 'calc' && t.sessionId === activeId);
    if (existing) {
      setPanelTabs((prev) => prev.map((t) => (t.id === existing.id ? { ...t, data } : t)));
      setPanelActive(existing.id);
    } else {
      const tab = { id: 't' + Date.now() + Math.floor(Math.random() * 1000), title: '费用测算', data, sessionId: activeId };
      setPanelTabs((prev) => [...prev, tab]);
      setPanelActive(tab.id);
    }
    setPanelOpen(true);
  };

  const updateCalcTab = (sid, quote) => {
    setPanelTabs((prev) =>
      prev.map((t) =>
        t.sessionId === sid && t.data && t.data.type === 'calc' ? { ...t, data: { type: 'calc', quote } } : t
      )
    );
  };

  const handleRunCalc = async (sid, inputs, enabled) => {
    setPendingFor(sid, 'run');
    startTrace(`tmp-${sid}`, ['执行测算']);
    try {
      await base44.functions.invoke('runCalc', { session_id: sid, inputs, enabled });
      setStepStatus(`tmp-${sid}`, 0, 'done');
    } catch {
      setStepStatus(`tmp-${sid}`, 0, 'failed');
    }
    setPendingFor(sid, null);
    const items = await refreshSession(sid);
    rekeyTrace(sid, items, 'last');
    refreshSessions();
    // 测算完成后，费用结果直接显示在右侧测算面板
    try {
      const s = await base44.entities.ChatSession.get(sid);
      if (s.quote_id) {
        const quote = await base44.entities.SupplierQuote.get(s.quote_id);
        if (quote && quote.calc_script) {
          const data = { type: 'calc', quote };
          const existing = panelTabs.find((t) => t.data && t.data.type === 'calc' && t.sessionId === sid);
          if (existing) {
            setPanelTabs((prev) => prev.map((t) => (t.id === existing.id ? { ...t, data } : t)));
            setPanelActive(existing.id);
          } else {
            const tab = { id: 't' + Date.now() + Math.floor(Math.random() * 1000), title: '费用测算', data, sessionId: sid };
            setPanelTabs((prev) => [...prev, tab]);
            setPanelActive(tab.id);
          }
          setPanelOpen(true);
        }
      }
    } catch { /* 会话可能已被删除 */ }
  };

  return (
    <div className="flex h-screen">
      <SessionSidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={() => createSession()}
        onDelete={handleDeleteSession}
        deletingId={deletingId}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-6 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-zinc-900">{session?.title || '供应商报价识别与测算'}</h1>
            {session && (
              <span className="mt-0.5 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                {STAGE_LABELS[session.stage] || session.stage}
              </span>
            )}
          </div>
          {panelTabs.length > 0 && (
            <button
              onClick={() => setPanelOpen((o) => !o)}
              title={panelOpen ? '收起详情面板' : '打开详情面板'}
              className="ml-auto rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            >
              {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-7">
            {!activeId && <EmptyState onPick={() => fileRef.current?.click()} />}
            {messages.map((m, i) => (
              <Fragment key={m.id}>
                <ChatMessageItem
                  msg={m}
                  isLast={i === messages.length - 1}
                  stage={session?.stage}
                  busy={busy}
                  onConfirm={handleConfirm}
                  onApply={handleApply}
                  onCorrect={handleCorrect}
                  onOpenPanel={openPanel}
                  onOpenCalcPanel={openCalcPanel}
                  execTrace={
                    activeId && m.role === 'assistant'
                      ? traces[m.id]
                        || (messages[i - 1] && messages[i - 1].role === 'user' ? traces[messages[i - 1].id] : null)
                        || null
                      : null
                  }
                />
                {activeId && traces[m.id] && m.role === 'user' && !messages[i + 1] && (
                  <ExecLog trace={traces[m.id]} />
                )}
              </Fragment>
            ))}
            {activeId && traces['tmp-' + activeId] && (
              <ExecLog trace={traces['tmp-' + activeId]} />
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-zinc-200 bg-white px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <div className="rounded-2xl border border-zinc-200 shadow-sm transition-colors focus-within:border-zinc-400">
              <textarea
                ref={textareaRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={busy}
                placeholder={
                  session?.stage === 'awaiting_apply'
                    ? '修改建议待确认：输入「确认修改」应用建议，或直接输入新的修正意见'
                    : session?.stage === 'awaiting_confirm'
                    ? '识别结果待确认：直接输入需要修正的内容，如「上海→汉堡体积价应为 118」'
                    : session?.stage === 'clarifying'
                    ? '请回答上面的问题，例如「我想改上海→汉堡那条线路的识别价格」'
                    : '反馈将自动识别意图：可修改识别数据、调整测算脚本、执行测算，或就报价内容提问'
                }
                className="w-full resize-none bg-transparent px-4 pt-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60"
              />
              <div className="flex items-center justify-between px-3 pb-2.5">
                <div className="flex items-center gap-1.5">
                  <select
                    value={llmModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    disabled={busy}
                    title="识别、修正与测算使用的模型"
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-600 outline-none transition-colors hover:border-zinc-400 disabled:opacity-50"
                  >
                    <option value="pro">DeepSeek V4 Pro</option>
                    <option value="flash">DeepSeek V4 Flash</option>
                  </select>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                    title="上传报价单（PDF / 图片 / Excel / Word）"
                    className="flex items-center gap-2 rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-700 disabled:opacity-50"
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                    <span className="text-xs">PDF / 图片 / Excel / Word</span>
                  </button>
                </div>
                <button
                  onClick={handleSend}
                  disabled={busy || !input.trim()}
                  className="rounded-full bg-zinc-900 p-2 transition-opacity hover:opacity-80 disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4 text-white" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <input
          type="file"
          ref={fileRef}
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.docx,.doc"
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (f) handleFile(f);
          }}
        />

      </div>

      {panelOpen && panelTabs.length > 0 && (
        <SidePanel
          tabs={panelTabs}
          activeId={panelActive}
          onSelect={setPanelActive}
          onCloseTab={closePanelTab}
          onClose={() => setPanelOpen(false)}
          onSave={handlePanelSave}
          onRunCalc={handleRunCalc}
          onInjectDrafts={handleInjectKnowledge}
          busy={busy}
        />
      )}
    </div>
  );
}