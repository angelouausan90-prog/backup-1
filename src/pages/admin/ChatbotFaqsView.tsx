import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';

interface AiStatusSummary {
  enabled: boolean;
  has_api_key: boolean;
  env_flag_enabled: boolean;
  calls_today: number;
  daily_cap: number;
  tokens_in_today: number;
  tokens_out_today: number;
  total_calls_all_time: number;
}

interface AdminFaqRow {
  id: number;
  question: string;
  answer: string;
  keywords: string;
  audience: string;
  sort_order: number;
  is_active: number;
  created_at: string;
}

interface UnansweredQuestionRow {
  id: number;
  session_id: string;
  question: string;
  status: string;
  resolved_faq_id: number | null;
  created_at: string;
}

export const ChatbotFaqsView: React.FC = () => {
  const [aiStatus, setAiStatus] = useState<AiStatusSummary>({
    enabled: false,
    has_api_key: false,
    env_flag_enabled: false,
    calls_today: 0,
    daily_cap: 200,
    tokens_in_today: 0,
    tokens_out_today: 0,
    total_calls_all_time: 0,
  });
  const [faqs, setFaqs] = useState<AdminFaqRow[]>([]);
  const [unanswered, setUnanswered] = useState<UnansweredQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Form state for creating/editing an FAQ or turning an unanswered question into an FAQ
  const [editingId, setEditingId] = useState<number | null>(null);
  const [convertingUnansweredId, setConvertingUnansweredId] = useState<number | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [keywords, setKeywords] = useState('');
  const [audience, setAudience] = useState('all');
  const [sortOrder, setSortOrder] = useState<number>(1);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/chatbot-faqs');
      if (res?.ai_status) {
        setAiStatus(res.ai_status);
      }
      const faqRows: AdminFaqRow[] = Array.isArray(res?.faqs) ? res.faqs : [];
      setFaqs(faqRows);
      setUnanswered(Array.isArray(res?.unanswered) ? res.unanswered : []);
      if (editingId === null && convertingUnansweredId === null) {
        setSortOrder(faqRows.length + 1);
      }
    } catch (e: any) {
      setErr(e.message || 'Failed to load Chatbot FAQs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetForm = (nextOrder = faqs.length + 1) => {
    setEditingId(null);
    setConvertingUnansweredId(null);
    setQuestion('');
    setAnswer('');
    setKeywords('');
    setAudience('all');
    setSortOrder(nextOrder);
    setIsActive(true);
  };

  const startEditFaq = (row: AdminFaqRow) => {
    setMsg('');
    setErr('');
    setEditingId(row.id);
    setConvertingUnansweredId(null);
    setQuestion(row.question);
    setAnswer(row.answer);
    setKeywords(row.keywords || '');
    setAudience(row.audience || 'all');
    setSortOrder(Number(row.sort_order || 0));
    setIsActive(Boolean(row.is_active));
  };

  const startTurnUnansweredIntoFaq = (row: UnansweredQuestionRow) => {
    setMsg('');
    setErr('');
    setEditingId(null);
    setConvertingUnansweredId(row.id);
    setQuestion(row.question);
    setAnswer('');
    setKeywords('');
    setAudience('all');
    setSortOrder(faqs.length + 1);
    setIsActive(true);
  };

  const handleSaveFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setErr('');
    setSaving(true);
    try {
      const payload = {
        question,
        answer,
        keywords,
        audience,
        sort_order: Number(sortOrder) || 0,
        is_active: isActive ? 1 : 0,
        unanswered_id: convertingUnansweredId,
      };

      if (editingId !== null) {
        await api.put(`/admin/chatbot-faqs/${editingId}`, payload);
        setMsg('Chatbot FAQ updated.');
      } else {
        await api.post('/admin/chatbot-faqs', payload);
        setMsg(
          convertingUnansweredId
            ? 'Unanswered visitor question converted into a public Chatbot FAQ.'
            : 'New Chatbot FAQ added.'
        );
      }
      resetForm(faqs.length + 2);
      await loadData();
    } catch (e: any) {
      setErr(e.message || 'Failed to save Chatbot FAQ.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFaqActive = async (row: AdminFaqRow) => {
    setMsg('');
    setErr('');
    try {
      await api.put(`/admin/chatbot-faqs/${row.id}`, {
        question: row.question,
        answer: row.answer,
        keywords: row.keywords,
        audience: row.audience,
        sort_order: row.sort_order,
        is_active: row.is_active ? 0 : 1,
      });
      setMsg(`FAQ #${row.id} ${row.is_active ? 'hidden' : 'activated'}.`);
      await loadData();
    } catch (e: any) {
      setErr(e.message || 'Failed to update FAQ status.');
    }
  };

  const handleDeleteFaq = async (id: number) => {
    setMsg('');
    setErr('');
    try {
      await api.delete(`/admin/chatbot-faqs/${id}`);
      if (editingId === id) {
        resetForm();
      }
      setMsg(`FAQ #${id} deleted.`);
      await loadData();
    } catch (e: any) {
      setErr(e.message || 'Failed to delete FAQ.');
    }
  };

  const handleDismissUnanswered = async (id: number) => {
    setMsg('');
    setErr('');
    try {
      await api.delete(`/admin/chatbot-unanswered/${id}`);
      if (convertingUnansweredId === id) {
        resetForm();
      }
      setMsg('Unanswered question removed.');
      await loadData();
    } catch (e: any) {
      setErr(e.message || 'Failed to remove unanswered question.');
    }
  };

  const openUnansweredCount = unanswered.filter((u) => u.status === 'Open').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Chatbot FAQs &amp; AI Fallback
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Manage the public landing-page FAQ knowledge base, review unanswered visitor questions, and monitor the optional Gemini AI fallback status.
        </p>
      </div>

      {/* SMALL PANEL: GEMINI AI FALLBACK STATUS & DAILY CAP */}
      <div
        data-testid="chatbot-ai-status-panel"
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Gemini AI Fallback Status
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              When a visitor question on the public landing page does not match an active FAQ, the server optionally queries Gemini using only public FAQ context.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">AI Status:</span>
            <span
              data-testid="chatbot-ai-status-badge"
              className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                aiStatus.enabled
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              {aiStatus.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-xs text-slate-500">AI Calls Today vs. Daily Cap</div>
            <div
              data-testid="chatbot-ai-calls-today"
              className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums"
            >
              {aiStatus.calls_today} / {aiStatus.daily_cap}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Per-IP limits: 10 msgs/min · 5 AI calls/hr
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-xs text-slate-500">Tokens Used Today (In / Out)</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
              {aiStatus.tokens_in_today.toLocaleString()} / {aiStatus.tokens_out_today.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Total AI calls logged: {aiStatus.total_calls_all_time}
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-xs text-slate-500">Environment Configuration (.env)</div>
            <div className="mt-1 text-xs font-semibold text-slate-800">
              Note: Set <code className="font-mono text-rose-700">GEMINI_API_KEY</code> and{' '}
              <code className="font-mono text-rose-700">CHATBOT_AI_ENABLED=&quot;true&quot;</code> in{' '}
              <code className="font-mono">.env</code> on the server to enable AI fallback.
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Optional daily cap: <code className="font-mono">CHATBOT_AI_DAILY_CAP=&quot;200&quot;</code>
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
          {msg}
        </div>
      )}
      {err && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800">
          {err}
        </div>
      )}

      {/* MAIN GRID: FAQ FORM + UNANSWERED QUESTIONS QUEUE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Add / Edit FAQ Form */}
        <form
          onSubmit={handleSaveFaq}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">
              {editingId !== null
                ? `Edit FAQ #${editingId}`
                : convertingUnansweredId !== null
                ? `Turn Unanswered Question #${convertingUnansweredId} into FAQ`
                : 'Add New Chatbot FAQ'}
            </h2>
            {(editingId !== null || convertingUnansweredId !== null) && (
              <button
                type="button"
                onClick={() => resetForm()}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900"
              >
                Cancel
              </button>
            )}
          </div>

          <div>
            <label
              htmlFor="faq-question-input"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Question
            </label>
            <input
              id="faq-question-input"
              type="text"
              required
              maxLength={300}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Enter frequently asked question"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="faq-answer-input"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Answer
            </label>
            <textarea
              id="faq-answer-input"
              required
              rows={4}
              maxLength={1200}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Write a clear, concise answer shown in the FAQ accordion and public chatbot..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="faq-keywords-input"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Matching Keywords (optional, comma-separated)
            </label>
            <input
              id="faq-keywords-input"
              type="text"
              maxLength={300}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Comma-separated matching keywords"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="faq-audience-select"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Visibility Audience
              </label>
              <select
                id="faq-audience-select"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="all">Public &amp; All Roles (all)</option>
                <option value="franchisee">Franchisee Only</option>
                <option value="agent">Agent Only</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="faq-sort-order"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Display Order
              </label>
              <input
                id="faq-sort-order"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-slate-300 text-rose-600 focus:ring-rose-600"
            />
            <span>Active (visible to chatbot and landing page when audience is &quot;all&quot;)</span>
          </label>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 px-4 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
          >
            {saving
              ? 'Saving...'
              : editingId !== null
              ? 'Save FAQ Changes'
              : convertingUnansweredId !== null
              ? 'Create FAQ & Mark Resolved'
              : 'Create Chatbot FAQ'}
          </button>
        </form>

        {/* Right: Unanswered Visitor Questions (chat_unanswered) */}
        <div
          data-testid="chatbot-unanswered-panel"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Unanswered Visitor Questions
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Questions from the public chatbot that did not match an existing FAQ. Click &quot;Turn into FAQ&quot; to publish an official answer.
              </p>
            </div>
            <span className="font-mono text-xs font-bold text-slate-700 whitespace-nowrap">
              {openUnansweredCount} open
            </span>
          </div>

          {loading ? (
            <div className="p-6 text-xs text-slate-500">Loading unanswered questions...</div>
          ) : unanswered.length === 0 ? (
            <div className="p-6 text-xs text-slate-500">
              No unanswered visitor questions logged yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto">
              {unanswered.map((u) => (
                <div
                  key={u.id}
                  className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-semibold text-slate-900 break-words">
                      {u.question}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Status: <strong>{u.status}</strong> · Session: {u.session_id} ·{' '}
                      {u.created_at}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {u.status === 'Open' && (
                      <button
                        type="button"
                        onClick={() => startTurnUnansweredIntoFaq(u)}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
                      >
                        Turn into FAQ
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDismissUnanswered(u.id)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* EXISTING FAQs TABLE */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            Configured Chatbot &amp; Landing Page FAQs ({faqs.length})
          </h2>
        </div>

        {loading ? (
          <div className="p-6 text-xs text-slate-500">Loading FAQs...</div>
        ) : faqs.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">No FAQs configured yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-3 px-4 font-semibold">Order</th>
                  <th className="py-3 px-4 font-semibold">Question &amp; Answer</th>
                  <th className="py-3 px-4 font-semibold">Audience</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {faqs.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50/80 align-top">
                    <td className="py-3 px-4 font-mono text-slate-700 tabular-nums">
                      #{f.sort_order}
                    </td>
                    <td className="py-3 px-4 space-y-1 max-w-xl">
                      <div className="font-bold text-slate-900 text-sm">
                        {f.question}
                      </div>
                      <div className="text-slate-600 leading-relaxed">
                        {f.answer}
                      </div>
                      {f.keywords && (
                        <div className="text-[11px] text-slate-400 font-mono">
                          Keywords: {f.keywords}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700">
                      {f.audience}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-semibold ${
                          f.is_active ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      >
                        {f.is_active ? 'Active' : 'Hidden'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => startEditFaq(f)}
                        className="px-2.5 py-1 rounded border border-slate-300 font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleFaqActive(f)}
                        className="px-2.5 py-1 rounded border border-slate-300 font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {f.is_active ? 'Hide' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFaq(f.id)}
                        className="px-2.5 py-1 rounded border border-rose-200 font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
