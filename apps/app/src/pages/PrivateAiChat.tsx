import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import {
  Bot,
  ChevronRight,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import {
  loadPrivateAiMessages,
  sendPrivateAiMessage,
  type PrivateAiMessage
} from '../lib/privateAiService';
import {
  formatChatDay,
  formatChatMessageHtml,
  formatChatTime
} from '../lib/chatLogic';
import { useShellLayout } from '../lib/useShellLayout';
import type { AuthState } from '../lib/types';

type ChatStatus = {
  tone: 'neutral' | 'error' | 'success';
  message: string;
};

const suggestedPrompts = [
  'What do I need to handle today?',
  'Who still needs an RSVP?',
  'Show unread team messages',
  'What is my next game?'
];

export function PrivateAiChat({ auth }: { auth: AuthState }) {
  const { isDesktopWeb } = useShellLayout();
  const [messages, setMessages] = useState<PrivateAiMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refreshMessages = async () => {
    if (!auth.user) return;
    setLoading(true);
    setStatus(null);
    try {
      setMessages(await loadPrivateAiMessages(auth.user));
    } catch (error: any) {
      setStatus({
        tone: 'error',
        message: error?.message || 'Unable to load AI chat.'
      });
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [messages.length, sending]);

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!auth.user || sending) return;
    const text = draft.trim();
    if (!text) return;

    setDraft('');
    setSending(true);
    setStatus(null);
    const optimisticUser: PrivateAiMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      text,
      createdAt: new Date()
    };
    setMessages((current) => [...current, optimisticUser]);

    try {
      const result = await sendPrivateAiMessage(auth.user, text);
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimisticUser.id),
        result.userMessage,
        result.assistantMessage
      ]);
    } catch (error: any) {
      setMessages((current) => current.filter((message) => message.id !== optimisticUser.id));
      setDraft(text);
      setStatus({
        tone: 'error',
        message: error?.message || 'Unable to send message.'
      });
    } finally {
      setSending(false);
    }
  };

  const sendSuggestion = (prompt: string) => {
    setDraft(prompt);
  };

  const stats = useMemo(() => ({
    messages: messages.length,
    lookups: messages.reduce((total, message) => total + (message.toolNames?.length || 0), 0)
  }), [messages]);

  const thread = (
    <PrivateAiThread
      messages={messages}
      loading={loading}
      sending={sending}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={sendMessage}
      status={status}
      bottomRef={bottomRef}
    />
  );

  if (isDesktopWeb) {
    return (
      <div className="messages-page messages-page-web private-ai-page">
        <PrivateAiHeader loading={loading} onRefresh={refreshMessages} />
        <section className="messages-two-pane private-ai-two-pane mt-4">
          <aside className="messages-list-pane private-ai-rail">
            <section className="app-card p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gray-950 text-white">
                  <Bot className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-black text-gray-950">Private AI</div>
                  <div className="truncate text-xs font-bold text-gray-500">{auth.user?.email || 'Signed in'}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <StatPill label="Messages" value={String(stats.messages)} />
                <StatPill label="Lookups" value={String(stats.lookups)} />
              </div>
            </section>

            <section className="app-card p-3">
              <div className="app-label">Ask about</div>
              <div className="mt-2 space-y-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="private-ai-prompt-button"
                    onClick={() => sendSuggestion(prompt)}
                  >
                    <span>{prompt}</span>
                    <ChevronRight className="h-4 w-4 flex-none" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          </aside>
          <div className="messages-chat-pane min-w-0">
            <div className="chat-window chat-window-embedded private-ai-window">
              {thread}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="chat-window chat-window-mobile private-ai-window private-ai-window-mobile">
      <PrivateAiMobileTopbar loading={loading} onRefresh={refreshMessages} />
      {thread}
    </div>
  );
}

function PrivateAiHeader({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <section className="messages-header app-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="app-label">Private AI</div>
          <h1 className="mt-1 text-xl font-black text-gray-950 sm:text-2xl">Ask ALL PLAYS</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-gray-500 sm:text-sm">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Your account only
            </span>
            <span>Schedule, teams, messages, fees, and profile</span>
          </div>
        </div>
        <button type="button" className="ghost-button !h-10 !min-h-10 !w-10 !p-0" onClick={onRefresh} aria-label="Refresh AI chat">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function PrivateAiMobileTopbar({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <section className="chat-topbar app-card p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gray-950 text-white">
          <Bot className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="app-label">Private AI</div>
          <h1 className="truncate text-lg font-black text-gray-950">Ask ALL PLAYS</h1>
        </div>
        <button type="button" className="ghost-button !h-10 !min-h-10 !w-10 !p-0" onClick={onRefresh} aria-label="Refresh AI chat">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function PrivateAiThread({
  messages,
  loading,
  sending,
  draft,
  onDraftChange,
  onSubmit,
  status,
  bottomRef
}: {
  messages: PrivateAiMessage[];
  loading: boolean;
  sending: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  status: ChatStatus | null;
  bottomRef: MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <section className="app-card chat-body private-ai-card">
      <div className="chat-messages-scroll private-ai-scroll">
        <div className="chat-messages-content private-ai-content">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center text-sm font-bold text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Loading AI chat...
            </div>
          ) : null}

          {!loading && !messages.length ? <PrivateAiWelcome /> : null}

          {!loading ? messages.map((message, index) => (
            <PrivateAiBubble key={message.id} message={message} previous={messages[index - 1] || null} />
          )) : null}

          {sending ? <TypingBubble /> : null}
          <div ref={bottomRef} />
        </div>
      </div>

      {status ? <StatusBanner status={status} /> : null}

      <form className="chat-composer private-ai-composer border-t border-gray-100 bg-white p-2" onSubmit={onSubmit}>
        <div className="chat-composer-input-shell">
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            className="chat-composer-textarea"
            placeholder="Ask about schedules, teams, players, messages..."
            rows={1}
            disabled={sending}
          />
          <button
            type="submit"
            className="chat-composer-send primary-button"
            disabled={sending || !draft.trim()}
            aria-label="Send AI message"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </form>
    </section>
  );
}

function PrivateAiWelcome() {
  return (
    <div className="private-ai-welcome">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
        <Sparkles className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="mt-3 text-base font-black text-gray-950">What do you need from ALL PLAYS?</div>
      <div className="mt-1 text-sm font-semibold leading-6 text-gray-500">
        Ask about your teams, schedule, messages, fees, players, registrations, and profile.
      </div>
    </div>
  );
}

function PrivateAiBubble({ message, previous }: { message: PrivateAiMessage; previous: PrivateAiMessage | null }) {
  const isOwn = message.role === 'user';
  const showDay = !previous || formatChatDay(previous.createdAt) !== formatChatDay(message.createdAt);

  return (
    <>
      {showDay ? (
        <div className="my-3 text-center text-[11px] font-black uppercase tracking-[0.08em] text-gray-400">
          {formatChatDay(message.createdAt)}
        </div>
      ) : null}
      <div className={`message-row flex ${isOwn ? 'justify-end' : 'justify-start'} px-2 py-1`}>
        <div className={`max-w-[86%] rounded-2xl px-3 py-2 shadow-sm ${isOwn ? 'bg-primary-600 text-white' : 'border border-gray-200 bg-white text-gray-950'} ${message.error ? 'border-rose-200 bg-rose-50 text-rose-800' : ''}`}>
          {!isOwn ? (
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.06em] text-primary-700">
              <Bot className="h-3.5 w-3.5" aria-hidden="true" />
              ALL PLAYS
            </div>
          ) : null}
          <div
            className={`chat-message-html text-sm font-semibold leading-6 ${isOwn ? 'chat-message-html-own' : ''}`}
            dangerouslySetInnerHTML={{ __html: formatChatMessageHtml(message.text) }}
          />
          <div className={`mt-1 flex flex-wrap items-center justify-end gap-1 text-[10px] font-bold ${isOwn ? 'text-white/75' : 'text-gray-400'}`}>
            {message.toolNames?.length ? <span>Looked up {message.toolNames.join(', ')}</span> : null}
            <span>{formatChatTime(message.createdAt)}</span>
          </div>
        </div>
      </div>
    </>
  );
}

function TypingBubble() {
  return (
    <div className="message-row flex justify-start px-2 py-1">
      <div className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-500 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
        Looking that up...
      </div>
    </div>
  );
}

function StatusBanner({ status }: { status: ChatStatus }) {
  const classes = status.tone === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : status.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-gray-200 bg-gray-50 text-gray-700';

  return (
    <div className={`mx-2 mb-2 rounded-xl border px-3 py-2 text-sm font-bold ${classes}`}>
      {status.message}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-[10px] font-black uppercase tracking-[0.08em] text-gray-400">{label}</div>
      <div className="mt-0.5 text-lg font-black text-gray-950">{value}</div>
    </div>
  );
}
