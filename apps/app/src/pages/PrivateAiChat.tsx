import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import {
  ChevronRight,
  Loader2,
  MessageCircle,
  Mic,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import {
  DEFAULT_PRIVATE_AI_CONVERSATION_ID,
  DRAFT_PRIVATE_AI_CONVERSATION_ID,
  loadPrivateAiConversations,
  loadPrivateAiMessages,
  sendPrivateAiMessage,
  type PrivateAiConversation,
  type PrivateAiMessage
} from '../lib/privateAiService';
import {
  formatChatDay,
  formatChatMessageHtml,
  formatChatTime
} from '../lib/chatLogic';
import {
  appendDictationTranscript,
  collectFinalDictationTranscript,
  getDictationErrorMessage,
  getSpeechRecognitionConstructor,
  isCapacitorNativeRuntime,
  startNativeSpeechDictation,
  type SpeechRecognitionLike
} from '../lib/dictation';
import { useShellLayout } from '../lib/useShellLayout';
import type { AuthState } from '../lib/types';

type ChatStatus = {
  tone: 'neutral' | 'error' | 'success';
  message: string;
};

const suggestedPrompts = [
  'What do I need to handle today?',
  'Who still needs an RSVP?',
  'How can my player improve this week?',
  'Build a coaching plan from recent games',
  'Show unread team messages',
  'What is my next game?'
];

const starterPrompts = [
  'What do I need to handle today?',
  'What is my next game?',
  'Show unread team messages',
  'Who still needs an RSVP?'
];

const isDraftConversationId = (conversationId: string) => conversationId === DRAFT_PRIVATE_AI_CONVERSATION_ID;
const draftConversationLabel = 'New chat';
const draftConversationPreview = 'Start typing. This draft will save after your first message.';

const resolveActiveConversationId = (
  currentConversationId: string,
  nextConversations: PrivateAiConversation[]
) => {
  if (isDraftConversationId(currentConversationId)) {
    return currentConversationId;
  }
  const hasCurrent = nextConversations.some((conversation) => conversation.id === currentConversationId);
  return hasCurrent ? currentConversationId : nextConversations[0]?.id || DEFAULT_PRIVATE_AI_CONVERSATION_ID;
};

export function PrivateAiChat({ auth }: { auth: AuthState }) {
  const { isDesktopWeb } = useShellLayout();
  const [messages, setMessages] = useState<PrivateAiMessage[]>([]);
  const [conversations, setConversations] = useState<PrivateAiConversation[]>([]);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [activeConversationId, setActiveConversationId] = useState(DEFAULT_PRIVATE_AI_CONVERSATION_ID);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stopNativeDictationRef = useRef<(() => Promise<void>) | null>(null);

  const refreshConversations = async (showLoading = true, currentConversationId = activeConversationId) => {
    if (!auth.user) {
      setConversations([]);
      setConversationLoading(false);
      return DEFAULT_PRIVATE_AI_CONVERSATION_ID;
    }

    if (showLoading) setConversationLoading(true);
    try {
      const nextConversations = await loadPrivateAiConversations(auth.user);
      const nextActiveConversationId = resolveActiveConversationId(currentConversationId, nextConversations);
      setConversations(nextConversations);
      setActiveConversationId(nextActiveConversationId);
      return nextActiveConversationId;
    } catch (error: any) {
      setStatus({
        tone: 'error',
        message: error?.message || 'Unable to load AI conversations.'
      });
      setConversations([]);
      return currentConversationId;
    } finally {
      if (showLoading) setConversationLoading(false);
    }
  };

  const refreshMessages = async (conversationId = activeConversationId) => {
    if (!auth.user) {
      setLoading(false);
      setMessages([]);
      return;
    }

    if (isDraftConversationId(conversationId)) {
      setLoading(false);
      setMessages([]);
      return;
    }

    setLoading(true);
    setStatus(null);
    try {
      setMessages(await loadPrivateAiMessages(auth.user, undefined, conversationId));
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
    setActiveConversationId(DEFAULT_PRIVATE_AI_CONVERSATION_ID);
    void refreshConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  useEffect(() => {
    refreshMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, activeConversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [messages.length, sending]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    void stopNativeDictationRef.current?.().catch(() => {});
    stopNativeDictationRef.current = null;
  }, []);

  const addDictatedText = (transcript: string) => {
    setDraft((current) => appendDictationTranscript(current, transcript));
    setStatus({
      tone: 'success',
      message: 'Dictation added to your message.'
    });
  };

  const finishDictation = () => {
    setDictating(false);
    recognitionRef.current = null;
    stopNativeDictationRef.current = null;
  };

  const startWebDictation = () => {
    const Recognition = getSpeechRecognitionConstructor(typeof window === 'undefined' ? null : window);
    if (!Recognition) {
      setStatus({
        tone: 'neutral',
        message: 'Dictation is not available in this view. Use the keyboard microphone to dictate into the message box.'
      });
      finishDictation();
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
    recognition.onresult = (event) => {
      const transcript = collectFinalDictationTranscript(event);
      if (transcript) {
        addDictatedText(transcript);
      }
    };
    recognition.onerror = (event) => {
      setStatus({
        tone: 'error',
        message: getDictationErrorMessage(event)
      });
      finishDictation();
    };
    recognition.onend = finishDictation;

    recognitionRef.current = recognition;
    setStatus({
      tone: 'neutral',
      message: 'Listening... speak your message, then pause.'
    });
    setDictating(true);

    try {
      recognition.start();
    } catch (error: any) {
      setStatus({
        tone: 'error',
        message: error?.message || 'Dictation could not start.'
      });
      finishDictation();
    }
  };

  const toggleDictation = async () => {
    if (sending) return;

    if (dictating) {
      await stopNativeDictationRef.current?.().catch(() => {});
      try {
        recognitionRef.current?.stop();
      } catch {
        recognitionRef.current?.abort();
      }
      finishDictation();
      return;
    }

    if (isCapacitorNativeRuntime(typeof window === 'undefined' ? null : window)) {
      setStatus({
        tone: 'neutral',
        message: 'Listening... speak your message, then pause.'
      });
      setDictating(true);
      try {
        const session = await startNativeSpeechDictation({
          language: typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US',
          onTranscript: addDictatedText,
          onError: (message) => setStatus({ tone: 'error', message }),
          onEnd: finishDictation
        });
        stopNativeDictationRef.current = session.stop;
        setDictating(true);
      } catch (error: any) {
        setStatus({
          tone: 'error',
          message: error?.message || 'Dictation could not start.'
        });
        finishDictation();
      }
      return;
    }

    startWebDictation();
  };

  const sendPrompt = async (text: string) => {
    const trimmedText = text.trim();
    if (!auth.user || sending || !trimmedText) return;

    setDraft('');
    setSending(true);
    setStatus(null);
    const optimisticUser: PrivateAiMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      text: trimmedText,
      conversationId: activeConversationId,
      createdAt: new Date()
    };
    setMessages((current) => [...current, optimisticUser]);

    try {
      const result = await sendPrivateAiMessage(auth.user, trimmedText, activeConversationId);
      const nextConversationId = result.userMessage.conversationId || activeConversationId;
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimisticUser.id),
        result.userMessage,
        result.assistantMessage
      ]);
      if (nextConversationId !== activeConversationId) {
        setActiveConversationId(nextConversationId);
      }
      await refreshConversations(false, nextConversationId);
    } catch (error: any) {
      setMessages((current) => current.filter((message) => message.id !== optimisticUser.id));
      setDraft(trimmedText);
      setStatus({
        tone: 'error',
        message: error?.message || 'Unable to send message.'
      });
    } finally {
      setSending(false);
    }
  };

  const sendMessage = (event?: FormEvent) => {
    event?.preventDefault();
    void sendPrompt(draft);
  };

  const sendSuggestion = (prompt: string) => {
    void sendPrompt(prompt);
  };

  const startNewConversation = () => {
    if (!auth.user || conversationLoading) return;
    setStatus(null);
    setActiveConversationId(DRAFT_PRIVATE_AI_CONVERSATION_ID);
    setMessages([]);
    setDraft('');
  };

  const selectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId || DEFAULT_PRIVATE_AI_CONVERSATION_ID);
    setStatus(null);
  };

  const stats = useMemo(() => ({
    messages: messages.length,
    lookups: messages.reduce((total, message) => total + (message.toolNames?.length || 0), 0),
    conversations: conversations.length || (messages.length ? 1 : 0)
  }), [conversations.length, messages]);

  const refreshAiView = () => {
    void (async () => {
      const nextConversationId = await refreshConversations(false);
      await refreshMessages(nextConversationId);
    })();
  };

  const thread = (
    <PrivateAiThread
      messages={messages}
      loading={loading}
      sending={sending}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={sendMessage}
      onToggleDictation={toggleDictation}
      onStarterPrompt={sendSuggestion}
      dictating={dictating}
      status={status}
      bottomRef={bottomRef}
    />
  );

  if (isDesktopWeb) {
    return (
      <div className="messages-page messages-page-web private-ai-page">
        <PrivateAiHeader loading={loading || conversationLoading} onRefresh={refreshAiView} />
        <section className="messages-two-pane private-ai-two-pane mt-4">
          <aside className="messages-list-pane private-ai-rail">
            <section className="app-card p-3">
              <div className="flex items-center gap-3">
                <div className="private-ai-desktop-mark flex h-10 w-10 flex-none items-center justify-center rounded-xl text-primary-700">
                  <img src="./logo_small.png" alt="" aria-hidden="true" />
                  <Sparkles className="private-ai-mark-spark" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-black text-gray-950">Private AI</div>
                  <div className="truncate text-xs font-bold text-gray-500">{auth.user?.email || 'Signed in'}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <StatPill label="Chats" value={String(stats.conversations)} />
                <StatPill label="Messages" value={String(stats.messages)} />
                <StatPill label="Lookups" value={String(stats.lookups)} />
              </div>
            </section>

            <PrivateAiConversationList
              conversations={conversations}
              activeConversationId={activeConversationId}
              loading={conversationLoading}
              onSelect={selectConversation}
              onNewConversation={startNewConversation}
            />

            <section className="app-card p-3">
              <div className="app-label">Ask about</div>
              <div className="mt-2 space-y-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="private-ai-prompt-button"
                    onClick={() => sendSuggestion(prompt)}
                    disabled={sending}
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
      <PrivateAiMobileTopbar loading={loading || conversationLoading} onRefresh={refreshAiView} onNewConversation={startNewConversation} />
      <PrivateAiConversationList
        conversations={conversations}
        activeConversationId={activeConversationId}
        loading={conversationLoading}
        onSelect={selectConversation}
        onNewConversation={startNewConversation}
        compact
      />
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

function PrivateAiConversationList({
  conversations,
  activeConversationId,
  loading,
  onSelect,
  onNewConversation,
  compact = false
}: {
  conversations: PrivateAiConversation[];
  activeConversationId: string;
  loading: boolean;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
  compact?: boolean;
}) {
  const showDraftConversation = isDraftConversationId(activeConversationId);

  if (compact) {
    return (
      <section className="private-ai-conversation-strip" aria-label="AI conversations">
        {loading ? (
          <span className="private-ai-conversation-chip private-ai-conversation-chip-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading
          </span>
        ) : null}
        {!loading && showDraftConversation ? (
          <button
            type="button"
            className="private-ai-conversation-chip private-ai-conversation-chip-active"
            onClick={() => onSelect(DRAFT_PRIVATE_AI_CONVERSATION_ID)}
            aria-pressed={true}
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            <span>{draftConversationLabel}</span>
          </button>
        ) : null}
        {!loading && conversations.length ? conversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            className={`private-ai-conversation-chip ${conversation.id === activeConversationId ? 'private-ai-conversation-chip-active' : ''}`}
            onClick={() => onSelect(conversation.id)}
            aria-pressed={conversation.id === activeConversationId}
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            <span>{conversation.title}</span>
          </button>
        )) : null}
        {!loading && !showDraftConversation && !conversations.length ? (
          <span className="private-ai-conversation-chip private-ai-conversation-chip-muted">No saved chats</span>
        ) : null}
      </section>
    );
  }

  return (
    <section className="app-card p-3" aria-label="AI conversations">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="app-label">Conversations</div>
          <div className="mt-0.5 text-sm font-black text-gray-950">Past chats</div>
        </div>
        <button
          type="button"
          className="ghost-button !h-9 !min-h-9 !px-2"
          onClick={onNewConversation}
          disabled={loading}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="flex min-h-16 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-xs font-black text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Loading chats
          </div>
        ) : null}
        {!loading && showDraftConversation ? (
          <button
            type="button"
            className="private-ai-conversation-button private-ai-conversation-button-active"
            onClick={() => onSelect(DRAFT_PRIVATE_AI_CONVERSATION_ID)}
            aria-pressed={true}
          >
            <span className="private-ai-conversation-title">{draftConversationLabel}</span>
            <span className="private-ai-conversation-preview">{draftConversationPreview}</span>
          </button>
        ) : null}
        {!loading && conversations.length ? conversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            className={`private-ai-conversation-button ${conversation.id === activeConversationId ? 'private-ai-conversation-button-active' : ''}`}
            onClick={() => onSelect(conversation.id)}
            aria-pressed={conversation.id === activeConversationId}
          >
            <span className="private-ai-conversation-title">{conversation.title}</span>
            <span className="private-ai-conversation-preview">
              {conversation.lastMessagePreview || 'Start a private ALL PLAYS thread'}
            </span>
          </button>
        )) : null}
        {!loading && !showDraftConversation && !conversations.length ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm font-bold text-gray-500">
            Start a private chat and it will stay here for later.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PrivateAiMobileTopbar({
  loading,
  onRefresh,
  onNewConversation
}: {
  loading: boolean;
  onRefresh: () => void;
  onNewConversation: () => void;
}) {
  return (
    <section className="chat-topbar app-card p-3 private-ai-mobile-topbar">
      <div className="flex min-w-0 items-center gap-3">
        <div className="private-ai-mobile-mark flex h-10 w-10 flex-none items-center justify-center rounded-xl text-primary-700">
          <img src="./logo_small.png" alt="" aria-hidden="true" />
          <Sparkles className="private-ai-mark-spark" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="app-label">Private AI</div>
          <h1 className="truncate text-lg font-black text-gray-950">Ask ALL PLAYS</h1>
        </div>
        <button type="button" className="ghost-button private-ai-topbar-action !h-10 !min-h-10 !w-10 !p-0" onClick={onNewConversation} aria-label="New AI chat">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className="ghost-button private-ai-topbar-action !h-10 !min-h-10 !w-10 !p-0" onClick={onRefresh} aria-label="Refresh AI chat">
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
  onToggleDictation,
  onStarterPrompt,
  dictating,
  status,
  bottomRef
}: {
  messages: PrivateAiMessage[];
  loading: boolean;
  sending: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onToggleDictation: () => void;
  onStarterPrompt: (prompt: string) => void;
  dictating: boolean;
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

          {!loading && !messages.length ? <PrivateAiWelcome sending={sending} onStarterPrompt={onStarterPrompt} /> : null}

          {!loading ? messages.map((message, index) => (
            <PrivateAiBubble key={message.id} message={message} previous={messages[index - 1] || null} />
          )) : null}

          {sending ? <TypingBubble /> : null}
          <div ref={bottomRef} />
        </div>
      </div>

      {status ? <StatusBanner status={status} /> : null}

      <form className="chat-composer private-ai-composer safe-bottom border border-gray-200 bg-white p-2 shadow-app" onSubmit={onSubmit}>
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
            placeholder="Ask ALL PLAYS..."
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
        <div className="chat-composer-toolbar private-ai-composer-toolbar">
          <button
            type="button"
            className={`chat-tool-button ${dictating ? 'chat-tool-button-active' : ''}`}
            onClick={onToggleDictation}
            disabled={sending}
            aria-label={dictating ? 'Stop voice input' : 'Voice to text'}
            aria-pressed={dictating}
          >
            {dictating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
          </button>
          <div className="chat-composer-notice private-ai-composer-notice" aria-live="polite">
            {dictating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="truncate">{dictating ? 'Listening...' : 'Private AI chat'}</span>
          </div>
        </div>
      </form>
    </section>
  );
}

function PrivateAiWelcome({
  sending,
  onStarterPrompt
}: {
  sending: boolean;
  onStarterPrompt: (prompt: string) => void;
}) {
  return (
    <div className="private-ai-welcome">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
        <Sparkles className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="mt-3 text-base font-black text-gray-950">What do you need from ALL PLAYS?</div>
      <div className="mt-1 text-sm font-semibold leading-6 text-gray-500">
        Ask about your teams, schedule, messages, fees, player development, coaching ideas, registrations, and profile.
      </div>
      <div className="private-ai-starter-prompts" aria-label="Starter prompts">
        {starterPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="private-ai-starter-prompt"
            onClick={() => onStarterPrompt(prompt)}
            disabled={sending}
          >
            <span>{prompt}</span>
            <Send className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
          </button>
        ))}
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
        <div className="private-ai-day-divider my-3 text-center text-[11px] font-black uppercase tracking-[0.08em] text-gray-400">
          {formatChatDay(message.createdAt)}
        </div>
      ) : null}
      <div className={`message-row private-ai-message-row flex ${isOwn ? 'justify-end' : 'justify-start'} px-2 py-1`}>
        <div className={`private-ai-bubble ${isOwn ? 'private-ai-bubble-own bg-primary-600 text-white' : 'border border-gray-200 bg-white text-gray-950'} ${message.error ? 'border-rose-200 bg-rose-50 text-rose-800' : ''}`}>
          {!isOwn ? (
            <div className="private-ai-bot-label mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.06em] text-primary-700">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              ALL PLAYS
            </div>
          ) : null}
          <div
            className={`chat-message-html private-ai-message-text ${isOwn ? 'chat-message-html-own' : ''}`}
            dangerouslySetInnerHTML={{ __html: formatChatMessageHtml(message.text) }}
          />
          <div className={`private-ai-message-meta mt-1 flex flex-wrap items-center justify-end gap-1 text-[10px] font-bold ${isOwn ? 'text-white/75' : 'text-gray-400'}`}>
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
