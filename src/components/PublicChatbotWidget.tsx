import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import {
  CHATBOT_AI_SUBTLE_LABEL,
  CHATBOT_MAX_MESSAGE_LENGTH,
  sanitizeChatbotText,
} from '../utils/domainRules';

export interface PublicChatbotFaqChip {
  id: number;
  question: string;
  answer: string;
}

interface ChatMessageItem {
  id: string;
  sender: 'visitor' | 'assistant';
  text: string;
  source?: 'faq' | 'ai' | 'fallback';
  aiLabel?: string | null;
}

interface PublicChatbotWidgetProps {
  faqs: PublicChatbotFaqChip[];
  contactEmail: string;
  contactPhone: string;
}

function getOrCreateVisitorSessionId(): string {
  const key = 'aice_public_chat_session_id';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = `visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `visitor_${Date.now().toString(36)}`;
  }
}

export const PublicChatbotWidget: React.FC<PublicChatbotWidgetProps> = ({
  faqs,
  contactEmail,
  contactPhone,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId] = useState<string>(() => getOrCreateVisitorSessionId());
  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: 'welcome-0',
      sender: 'assistant',
      text: 'Hello! Ask me about AICE products, store locations, how online stock replenishment works, or how to become a franchisee through an accredited agent.',
      source: 'faq',
      aiLabel: null,
    },
  ]);

  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen && scrollEndRef.current) {
      scrollEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isOpen]);

  const submitQuestion = async (rawQuestion: string) => {
    const cleanQuestion = sanitizeChatbotText(rawQuestion, CHATBOT_MAX_MESSAGE_LENGTH);
    if (!cleanQuestion || sending) return;

    const visitorMsg: ChatMessageItem = {
      id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: 'visitor',
      text: cleanQuestion,
    };

    setMessages((prev) => [...prev, visitorMsg]);
    setInput('');
    setSending(true);

    try {
      const response = await fetch('/api/public/chatbot/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: cleanQuestion,
          session_id: sessionId,
        }),
      });

      const data = await response.json().catch(() => null);
      const safeReply = sanitizeChatbotText(
        data?.reply ||
          `I couldn't find that, please contact us at ${contactEmail} or ${contactPhone}.`
      );
      const source: 'faq' | 'ai' | 'fallback' =
        data?.source === 'ai'
          ? 'ai'
          : data?.source === 'faq'
          ? 'faq'
          : 'fallback';
      const aiLabel =
        source === 'ai'
          ? sanitizeChatbotText(data?.ai_label || CHATBOT_AI_SUBTLE_LABEL)
          : null;

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sender: 'assistant',
          text: safeReply,
          source,
          aiLabel,
        },
      ]);
    } catch {
      const fallbackText = sanitizeChatbotText(
        `I couldn't find that, please contact us at ${contactEmail} or ${contactPhone}.`
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sender: 'assistant',
          text: fallbackText,
          source: 'fallback',
          aiLabel: null,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuestion(input);
  };

  return (
    <div className="fixed bottom-5 right-5 z-[1100] flex flex-col items-end">
      {isOpen && (
        <section
          aria-label="AICE Help Assistant"
          data-testid="public-chatbot-panel"
          className="mb-3 w-[350px] sm:w-[390px] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="bg-[#1B063E] text-white px-4 py-3.5 flex items-center justify-between gap-3">
            <div>
              <div className="font-display text-sm font-bold text-white">
                AICE Help Assistant
              </div>
              <div className="text-[11px] text-purple-200/85">
                Instant FAQ answers on products, ordering &amp; franchising
              </div>
            </div>
            <button
              type="button"
              aria-label="Close Help Assistant"
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-lg text-purple-200 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick FAQ Suggestion Prompts */}
          {faqs.length > 0 && (
            <div className="px-4 py-2.5 bg-[#FAFAFC] border-b border-slate-200">
              <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
                Common questions:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {faqs.slice(0, 3).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={sending}
                    onClick={() => submitQuestion(f.question)}
                    className="text-left text-[11px] font-medium px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[#23084E] hover:border-[#23084E]/40 hover:bg-purple-50/50 transition-colors line-clamp-1 disabled:opacity-50"
                  >
                    {f.question}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages List */}
          <div
            data-testid="public-chatbot-messages"
            className="p-4 space-y-3 max-h-[300px] min-h-[210px] overflow-y-auto bg-white"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${
                  m.sender === 'visitor' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    m.sender === 'visitor'
                      ? 'bg-[#23084E] text-white'
                      : 'bg-slate-100 text-slate-800 border border-slate-200/80'
                  }`}
                >
                  {m.text}
                </div>
                {m.sender === 'assistant' && m.aiLabel && (
                  <span
                    data-testid="chatbot-ai-subtle-label"
                    className="mt-1 text-[10px] text-slate-400 italic px-1"
                  >
                    {m.aiLabel}
                  </span>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex items-start">
                <div className="rounded-xl px-3.5 py-2 text-xs bg-slate-100 text-slate-500 border border-slate-200/80">
                  Checking FAQ answers...
                </div>
              </div>
            )}
            <div ref={scrollEndRef} />
          </div>

          {/* Input Form (Max 200 chars) */}
          <form
            onSubmit={handleFormSubmit}
            className="p-3 bg-[#FAFAFC] border-t border-slate-200 space-y-1.5"
          >
            <div className="flex items-center gap-2">
              <label htmlFor="public-chatbot-input" className="sr-only">
                Ask a question about AICE
              </label>
              <input
                id="public-chatbot-input"
                type="text"
                maxLength={CHATBOT_MAX_MESSAGE_LENGTH}
                value={input}
                onChange={(e) =>
                  setInput(e.target.value.slice(0, CHATBOT_MAX_MESSAGE_LENGTH))
                }
                placeholder="Ask about ordering, stores, or franchising..."
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#23084E]"
              />
              <button
                type="submit"
                aria-label="Send question"
                disabled={sending || !input.trim()}
                className="px-3 py-2 rounded-lg bg-[#23084E] text-white text-xs font-bold hover:bg-[#2E0B66] disabled:opacity-50 transition-colors flex items-center gap-1 shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Ask</span>
              </button>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
              <span>Answers sourced from official public FAQs</span>
              <span className="font-mono tabular-nums">
                {input.length}/{CHATBOT_MAX_MESSAGE_LENGTH}
              </span>
            </div>
          </form>
        </section>
      )}

      {/* Floating Toggle Button */}
      <button
        type="button"
        aria-label={isOpen ? 'Close Help Assistant' : 'Open Help Assistant'}
        data-testid="public-chatbot-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        className="px-4 py-3 rounded-full bg-[#23084E] text-white border-2 border-amber-400 shadow-xl hover:bg-[#2E0B66] transition-colors flex items-center gap-2 text-xs font-bold"
      >
        <MessageCircle className="w-4 h-4 text-amber-300 shrink-0" />
        <span>{isOpen ? 'Close Help' : 'Ask Help Assistant'}</span>
      </button>
    </div>
  );
};
