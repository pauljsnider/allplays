import { ChangeEvent, FormEvent, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  Bot,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  Download,
  Edit3,
  ImageIcon,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Smile,
  Trash2,
  Users,
  Video,
  X
} from 'lucide-react';
import {
  deleteTeamChatMessage,
  editTeamChatMessage,
  ensureStaffChatConversation,
  getChatInboxPreview,
  loadChatConversations,
  loadChatInbox,
  loadChatRecipientOptions,
  loadChatTeamContext,
  loadOlderTeamChatMessages,
  loadSentTeamEmails,
  loadTeamEmailDrafts,
  loadTeamEmailTemplates,
  markTeamChatRead,
  saveTeamEmailDraft,
  saveTeamEmailTemplate,
  sendAllPlaysChatAnswer,
  sendTeamChatMessage,
  sendTeamEmailMessage,
  subscribeToTeamChatMessages,
  toggleTeamChatReaction,
  type ChatConversation,
  type ChatMessage,
  type SentTeamEmail,
  type TeamEmailDraft,
  type TeamEmailTemplate,
  type ChatTeam
} from '../lib/chatService';
import { MessagesPageSkeleton } from '../components/PageSkeletons';
import {
  DEFAULT_TEAM_CONVERSATION_ID,
  MAX_CHAT_MEDIA_SIZE,
  buildChatAudienceMetadata,
  buildEmailAudienceMetadata,
  buildChatMediaShareDetails,
  chatReactions,
  collectThreadMedia,
  extractAllPlaysQuestion,
  formatChatDay,
  formatChatMessageHtml,
  formatChatTime,
  formatInboxTime,
  getAudienceSummaryText,
  getChatMediaDownloadName,
  getConversationDisplayName,
  getMessageAttachments,
  getMessageSenderLabel,
  getReactionNames,
  getSortedChatMessages,
  hasAllPlaysMention,
  isChatComposerLinkSafe,
  isDefaultTeamConversation,
  isStaffConversation,
  isSafeChatMediaUrl,
  mergeChatMessageLists,
  normalizeChatReactions,
  shouldRetryChatLastReadOnViewReturn,
  shouldUpdateChatLastRead,
  type ChatRecipientOption,
  type ChatAudienceMetadata,
  type ChatTargetType
} from '../lib/chatLogic';
import { sharePublicUrl } from '../lib/publicActions';
import { useShellLayout } from '../lib/useShellLayout';
import type { AuthState } from '../lib/types';
import { voiceRecognition, type VoiceListenerHandle } from '../lib/voiceService';

type StatusTone = 'neutral' | 'success' | 'error';

type ChatStatus = {
  tone: StatusTone;
  message: string;
};

type FilePreview = {
  file: File;
  url: string;
};

const allTargetOptions: Array<{ value: ChatTargetType; label: string; description: string }> = [
  { value: 'full_team', label: 'Full team', description: 'Visible to everyone in this team chat.' },
  { value: 'staff', label: 'Staff only', description: 'Moves this into a staff conversation.' },
  { value: 'individuals', label: 'Selected members', description: 'Starts a direct or group conversation.' }
];

export function Messages({ auth }: { auth: AuthState }) {
  const { teamId } = useParams();
  const location = useLocation();
  const { isDesktopWeb } = useShellLayout();
  const [teams, setTeams] = useState<ChatTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedDesktopTeamId, setSelectedDesktopTeamId] = useState<string | undefined>(undefined);
  const shouldLoadInbox = isDesktopWeb || !teamId;

  const refreshInbox = async () => {
    if (!auth.user) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadChatInbox(auth.user);
      setTeams(result.teams);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load messages.');
      setTeams([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!shouldLoadInbox) {
      setLoading(false);
      setError(null);
      setTeams([]);
      return;
    }
    refreshInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, shouldLoadInbox]);

  // Initialize selectedDesktopTeamId once teams first load (only if no selection exists yet).
  useEffect(() => {
    if (isDesktopWeb && !selectedDesktopTeamId && teams.length > 0) {
      setSelectedDesktopTeamId(teams[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams]);

  // Sync selectedDesktopTeamId when the URL route changes (explicit navigation).
  useEffect(() => {
    if (isDesktopWeb && teamId) {
      setSelectedDesktopTeamId(teamId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const filteredTeams = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return teams;
    return teams.filter((team) => [
      team.name,
      team.sport,
      getChatInboxPreview(team.lastMessage)
    ].join(' ').toLowerCase().includes(normalized));
  }, [query, teams]);

  const preferredConversationId = useMemo(() => getPreferredConversationIdFromSearch(location.search), [location.search]);

  const activeTeamId = teamId || (isDesktopWeb ? selectedDesktopTeamId : undefined);

  if (isDesktopWeb) {
    return (
      <div className="messages-page messages-page-web">
        <MessagesHeader teams={teams} loading={loading} onRefresh={refreshInbox} />
        <section className="messages-two-pane mt-4">
          <aside className="messages-list-pane">
            <InboxSearch query={query} onChange={setQuery} />
            <div className="messages-list-scroll">
              <InboxList
                teams={filteredTeams}
                loading={loading}
                error={error}
                activeTeamId={activeTeamId || ''}
                searchQuery={query}
                totalTeamsCount={teams.length}
                onClearSearch={() => setQuery('')}
                onSelect={setSelectedDesktopTeamId}
                compact
              />
            </div>
          </aside>
          <div className="messages-chat-pane min-w-0">
            {activeTeamId ? (
              <ChatWindow
                auth={auth}
                teamId={activeTeamId}
                inboxTeam={teams.find((team) => team.id === activeTeamId)}
                preferredConversationId={teamId === activeTeamId ? preferredConversationId : ''}
                embedded
              />
            ) : (
              <EmptyChatSelection />
            )}
          </div>
        </section>
      </div>
    );
  }

  if (activeTeamId) {
    return (
      <ChatWindow
        auth={auth}
        teamId={activeTeamId}
        inboxTeam={teams.find((team) => team.id === activeTeamId)}
        preferredConversationId={preferredConversationId}
      />
    );
  }

  return (
    <div className="messages-page space-y-4">
      <MessagesHeader teams={teams} loading={loading} onRefresh={refreshInbox} />
      <InboxSearch query={query} onChange={setQuery} />
      <InboxList
        teams={filteredTeams}
        loading={loading}
        error={error}
        activeTeamId=""
        searchQuery={query}
        totalTeamsCount={teams.length}
        onClearSearch={() => setQuery('')}
      />
    </div>
  );
}

function MessagesHeader({ teams, loading, onRefresh }: { teams: ChatTeam[]; loading: boolean; onRefresh: () => void }) {
  const unread = teams.reduce((total, team) => total + team.unreadCount, 0);
  const staffTeams = teams.filter((team) => team.canModerate).length;

  return (
    <section className="messages-header app-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="app-label">Messages</div>
          <h1 className="mt-1 text-xl font-black text-gray-950 sm:text-2xl">Team chats</h1>
          <div className="mt-1 text-xs font-bold text-gray-500 sm:text-sm">
            {teams.length} team{teams.length === 1 ? '' : 's'} · {unread} unread · {staffTeams} staff
          </div>
        </div>
        <button type="button" className="ghost-button !h-10 !min-h-10 !w-10 !p-0" onClick={onRefresh} aria-label="Refresh messages">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function InboxSearch({ query, onChange }: { query: string; onChange: (value: string) => void }) {
  return (
    <label className="app-card flex min-h-11 w-full min-w-0 items-center gap-2 px-3">
      <Search className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
      <span className="sr-only">Search messages</span>
      <input
        value={query}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent text-base font-semibold text-gray-900 outline-none placeholder:text-gray-400"
        placeholder="Search team chats"
      />
    </label>
  );
}

function InboxList({
  teams,
  loading,
  error,
  activeTeamId,
  searchQuery,
  totalTeamsCount,
  onClearSearch,
  onSelect,
  compact = false
}: {
  teams: ChatTeam[];
  loading: boolean;
  error: string | null;
  activeTeamId: string;
  searchQuery: string;
  totalTeamsCount: number;
  onClearSearch: () => void;
  onSelect?: (teamId: string) => void;
  compact?: boolean;
}) {
  const trimmedQuery = searchQuery.trim();

  if (loading) {
    return <MessagesPageSkeleton />;
  }

  if (error) {
    return (
      <section className="app-card p-5 text-sm font-bold text-rose-700">
        {error}
      </section>
    );
  }

  if (!teams.length) {
    if (trimmedQuery && totalTeamsCount > 0) {
      return (
        <section className="app-card p-6 text-center">
          <Search className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
          <div className="mt-3 text-base font-black text-gray-950">No team chats match “{trimmedQuery}”</div>
          <div className="mt-1 text-sm font-semibold leading-6 text-gray-500">Try a different search or clear it to see all team chats.</div>
          <button type="button" className="secondary-button mx-auto mt-4" onClick={onClearSearch}>
            Clear search
          </button>
        </section>
      );
    }

    return (
      <section className="app-card p-6 text-center">
        <MessageCircle className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
        <div className="mt-3 text-base font-black text-gray-950">No team chats yet</div>
        <div className="mt-1 text-sm font-semibold leading-6 text-gray-500">Join or create a team to start messaging.</div>
      </section>
    );
  }

  return (
    <section className={compact ? 'space-y-2' : 'space-y-3'}>
      {teams.map((team) => (
        <InboxRow key={team.id} team={team} active={activeTeamId === team.id} compact={compact} onSelect={onSelect} />
      ))}
    </section>
  );
}

function InboxRow({ team, active, compact, onSelect }: { team: ChatTeam; active: boolean; compact: boolean; onSelect?: (teamId: string) => void }) {
  const preview = getChatInboxPreview(team.lastMessage);
  const timeLabel = formatInboxTime(team.lastMessage?.createdAt);
  const route = buildMessagesRoute(team.id, team.preferredConversationId);

  return (
    <Link
      to={route}
      onClick={onSelect ? () => onSelect(team.id) : undefined}
      className={`message-row app-card flex items-center gap-3 p-3 transition hover:border-primary-200 hover:shadow-app-lg ${
        active ? '!border-primary-200 bg-primary-50/50' : ''
      }`}
    >
      <TeamAvatar team={team} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-sm font-black text-gray-950 sm:text-base">{team.name}</div>
          <div className="flex-none text-[11px] font-bold text-gray-500">{timeLabel}</div>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className={`inline-flex flex-none items-center rounded-full border px-1.5 py-0.5 text-[10px] font-black uppercase ${
            team.canModerate ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-600'
          }`}>
            {team.role}
          </span>
          <div className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-600 sm:text-sm">{preview}</div>
        </div>
      </div>
      {team.unreadCount > 0 ? (
        <span className="flex h-6 min-w-6 flex-none items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-black text-white">
          {team.unreadCount > 99 ? '99+' : team.unreadCount}
        </span>
      ) : compact ? null : (
        <ChevronDown className="-rotate-90 h-5 w-5 flex-none text-gray-300" aria-hidden="true" />
      )}
    </Link>
  );
}

function TeamAvatar({ team }: { team: Pick<ChatTeam, 'name' | 'photoUrl' | 'unreadCount'> }) {
  return (
    <div className="relative flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-primary-50 text-primary-700 shadow-sm">
      {team.photoUrl ? (
        <img src={team.photoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-base font-black">{team.name.charAt(0).toUpperCase()}</span>
      )}
      {team.unreadCount > 0 ? <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-600" /> : null}
    </div>
  );
}

function EmptyChatSelection() {
  return (
    <section className="app-card flex min-h-[520px] items-center justify-center p-6 text-center">
      <div>
        <MessageCircle className="mx-auto h-12 w-12 text-gray-300" aria-hidden="true" />
        <div className="mt-3 text-lg font-black text-gray-950">Select a team chat</div>
        <div className="mt-1 text-sm font-semibold text-gray-500">Messages, media, reactions, and staff targeting open here.</div>
      </div>
    </section>
  );
}

function ChatWindow({
  auth,
  teamId,
  inboxTeam,
  preferredConversationId = '',
  embedded = false
}: {
  auth: AuthState;
  teamId: string;
  inboxTeam?: ChatTeam;
  preferredConversationId?: string;
  embedded?: boolean;
}) {
  const navigate = useNavigate();
  const { isDesktopWeb } = useShellLayout();
  const [team, setTeam] = useState<Record<string, any> | null>(inboxTeam || null);
  const [profile, setProfile] = useState<Record<string, any>>({});
  const [canModerate, setCanModerate] = useState(inboxTeam?.canModerate || false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState(DEFAULT_TEAM_CONVERSATION_ID);
  const [recipientOptions, setRecipientOptions] = useState<ChatRecipientOption[]>([]);
  const [recipientOptionsLoading, setRecipientOptionsLoading] = useState(false);
  const [recipientOptionsLoaded, setRecipientOptionsLoaded] = useState(false);
  const [recipientOptionsError, setRecipientOptionsError] = useState<string | null>(null);
  const [selectedRecipientTarget, setSelectedRecipientTarget] = useState<ChatTargetType>('full_team');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [liveOldestDoc, setLiveOldestDoc] = useState<unknown | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingContext, setLoadingContext] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [composerNotice, setComposerNotice] = useState('');
  const [text, setText] = useState('');
  const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]);
  const [sending, setSending] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(() => voiceRecognition.isNativeRuntime() || voiceRecognition.hasBrowserSupport());
  const [showConversationSheet, setShowConversationSheet] = useState(false);
  const [showAudienceSheet, setShowAudienceSheet] = useState(false);
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const [showLinkSheet, setShowLinkSheet] = useState(false);
  const [showEmailSheet, setShowEmailSheet] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailTemplateName, setEmailTemplateName] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSavingTemplate, setEmailSavingTemplate] = useState(false);
  const [emailSavingDraft, setEmailSavingDraft] = useState(false);
  const [emailLoadingDrafts, setEmailLoadingDrafts] = useState(false);
  const [emailLoadingHistory, setEmailLoadingHistory] = useState(false);
  const [emailLoadingTemplates, setEmailLoadingTemplates] = useState(false);
  const [emailStatus, setEmailStatus] = useState<ChatStatus | null>(null);
  const [emailHistoryStatus, setEmailHistoryStatus] = useState<ChatStatus | null>(null);
  const [emailDrafts, setEmailDrafts] = useState<TeamEmailDraft[]>([]);
  const [selectedEmailDraftId, setSelectedEmailDraftId] = useState('');
  const [emailTemplates, setEmailTemplates] = useState<TeamEmailTemplate[]>([]);
  const [sentEmails, setSentEmails] = useState<SentTeamEmail[]>([]);
  const [linkDraft, setLinkDraft] = useState('');
  const [reactionMessageId, setReactionMessageId] = useState('');
  const [actionMessageId, setActionMessageId] = useState('');
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const voiceListenerHandlesRef = useRef<VoiceListenerHandle[]>([]);
  const voiceBaseTextRef = useRef('');
  const voicePartialRef = useRef('');
  const nativeVoiceListeningRef = useRef(false);
  const voiceStopRequestedRef = useRef(false);
  const initialSnapshotLoadedRef = useRef(false);
  const pendingScrollRef = useRef(false);
  const stickToLatestRef = useRef(true);
  const recipientOptionsPromiseRef = useRef<Promise<ChatRecipientOption[]> | null>(null);
  const recipientOptionsRequestIdRef = useRef(0);
  const currentTeamIdRef = useRef(teamId);
  const programmaticScrollRef = useRef(false);
  const mountedRef = useRef(true);
  const scheduledScrollFrameRef = useRef<number | null>(null);
  const scheduledScrollBehaviorRef = useRef<ScrollBehavior>('auto');
  const scheduledScrollForceRef = useRef(false);
  const scheduledScrollTimeoutsRef = useRef<number[]>([]);
  const lastObservedViewportSignatureRef = useRef('');
  const messages = useMemo(() => mergeChatMessageLists(olderMessages, liveMessages), [liveMessages, olderMessages]);
  const selectedConversation = useMemo(() => (
    conversations.find((conversation) => conversation.id === selectedConversationId) || conversations[0] || null
  ), [conversations, selectedConversationId]);
  const audienceMetadata = useMemo(() => buildChatAudienceMetadata({
    selectedConversation,
    selectedConversationId,
    selectedRecipientTarget,
    selectedRecipientIds
  }), [selectedConversation, selectedConversationId, selectedRecipientIds, selectedRecipientTarget]);
  const emailAudienceMetadata = useMemo(() => buildEmailAudienceMetadata({
    selectedConversation,
    selectedConversationId,
    selectedRecipientTarget,
    selectedRecipientIds,
    recipientOptions
  }), [recipientOptions, selectedConversation, selectedConversationId, selectedRecipientIds, selectedRecipientTarget]);
  const audienceSummary = useMemo(() => getAudienceSummaryText(audienceMetadata, recipientOptions), [audienceMetadata, recipientOptions]);
  const mediaEntries = useMemo(() => collectThreadMedia(messages), [messages]);
  const teamName = team?.name || inboxTeam?.name || 'Team chat';

  const ensureRecipientOptionsLoaded = useCallback(async () => {
    if (!canModerate) return [] as ChatRecipientOption[];
    if (recipientOptionsLoaded) return recipientOptions;
    if (recipientOptionsPromiseRef.current) return recipientOptionsPromiseRef.current;

    const requestTeamId = teamId;
    const requestId = recipientOptionsRequestIdRef.current + 1;
    recipientOptionsRequestIdRef.current = requestId;
    setRecipientOptionsLoading(true);
    setRecipientOptionsError(null);
    const request = loadChatRecipientOptions(requestTeamId)
      .then((options) => {
        if (
          mountedRef.current
          && currentTeamIdRef.current === requestTeamId
          && recipientOptionsRequestIdRef.current === requestId
        ) {
          setRecipientOptions(options);
          setRecipientOptionsLoaded(true);
        }
        return options;
      })
      .catch((loadError: any) => {
        const message = loadError?.message || 'Unable to load recipient options.';
        if (
          mountedRef.current
          && currentTeamIdRef.current === requestTeamId
          && recipientOptionsRequestIdRef.current === requestId
        ) {
          setRecipientOptionsLoaded(false);
          setRecipientOptionsError(message);
        }
        throw loadError;
      })
      .finally(() => {
        if (recipientOptionsPromiseRef.current === request) {
          recipientOptionsPromiseRef.current = null;
        }
        if (
          mountedRef.current
          && currentTeamIdRef.current === requestTeamId
          && recipientOptionsRequestIdRef.current === requestId
        ) {
          setRecipientOptionsLoading(false);
        }
      });
    recipientOptionsPromiseRef.current = request;
    return request;
  }, [canModerate, recipientOptions, recipientOptionsLoaded, teamId]);

  const setVoiceDraftTranscript = useCallback((transcript: string) => {
    const normalizedTranscript = String(transcript || '').trim();
    if (!normalizedTranscript) return;
    voicePartialRef.current = normalizedTranscript;
    const baseText = voiceBaseTextRef.current.trim();
    setText(`${baseText}${baseText ? ' ' : ''}${normalizedTranscript}`);
  }, []);

  const removeNativeVoiceListeners = useCallback(async () => {
    const handles = voiceListenerHandlesRef.current.splice(0);
    await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
  }, []);

  const finishNativeVoiceCapture = useCallback(async () => {
    try {
      const lastPartial = await voiceRecognition.getLastPartialResult().catch(() => null);
      const finalTranscript = lastPartial?.text || lastPartial?.matches?.[0] || voicePartialRef.current;
      if (finalTranscript) {
        setVoiceDraftTranscript(finalTranscript);
      }
    } finally {
      await removeNativeVoiceListeners();
      nativeVoiceListeningRef.current = false;
      voiceStopRequestedRef.current = false;
      voiceBaseTextRef.current = '';
      voicePartialRef.current = '';
      setVoiceListening(false);
      setComposerNotice((current) => current === 'Listening...' ? '' : current);
    }
  }, [removeNativeVoiceListeners, setVoiceDraftTranscript]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (!mountedRef.current) return;
    const container = messagesRef.current;
    if (!container) return;

    const nextHeight = Math.max(container.scrollHeight, messagesContentRef.current?.scrollHeight || 0);
    lastObservedViewportSignatureRef.current = buildChatViewportSignature(
      nextHeight,
      container.clientHeight,
      container.scrollTop
    );
    programmaticScrollRef.current = true;
    container.scrollTop = Math.max(0, nextHeight - container.clientHeight);
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior });
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
    window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 80);
  }, []);

  const clearScheduledScrollTimeouts = useCallback(() => {
    scheduledScrollTimeoutsRef.current.forEach((timerId) => window.clearTimeout(timerId));
    scheduledScrollTimeoutsRef.current = [];
  }, []);

  const maybeScrollToLatest = useCallback((behavior: ScrollBehavior = 'auto', force = false) => {
    if (!mountedRef.current) return false;
    const container = messagesRef.current;
    if (!container) return false;

    const nextHeight = Math.max(
      container.scrollHeight,
      messagesContentRef.current?.scrollHeight || 0
    );
    const distanceFromBottom = Math.max(0, nextHeight - container.clientHeight - container.scrollTop);
    if (!force && distanceFromBottom <= 4) {
      lastObservedViewportSignatureRef.current = buildChatViewportSignature(nextHeight, container.clientHeight, container.scrollTop);
      return false;
    }

    scrollToLatest(behavior);
    return true;
  }, [scrollToLatest]);

  const clearScheduledScrollToLatest = useCallback(() => {
    if (scheduledScrollFrameRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(scheduledScrollFrameRef.current);
    }
    scheduledScrollFrameRef.current = null;
    scheduledScrollBehaviorRef.current = 'auto';
    scheduledScrollForceRef.current = false;
    clearScheduledScrollTimeouts();
  }, [clearScheduledScrollTimeouts]);

  const scheduleScrollToLatest = useCallback((behavior: ScrollBehavior = 'auto', force = false) => {
    if (!mountedRef.current) return;
    clearScheduledScrollTimeouts();
    if (behavior === 'smooth' || scheduledScrollBehaviorRef.current !== 'smooth') {
      scheduledScrollBehaviorRef.current = behavior;
    }
    if (force) {
      scheduledScrollForceRef.current = true;
    }
    if (scheduledScrollFrameRef.current !== null) return;

    scheduledScrollFrameRef.current = window.requestAnimationFrame(() => {
      scheduledScrollFrameRef.current = window.requestAnimationFrame(() => {
        scheduledScrollFrameRef.current = null;
        const nextBehavior = scheduledScrollBehaviorRef.current;
        const nextForce = scheduledScrollForceRef.current;
        scheduledScrollBehaviorRef.current = 'auto';
        scheduledScrollForceRef.current = false;
        maybeScrollToLatest(nextBehavior, nextForce);

        [120, 300, 700, 1500, 2500].forEach((delay) => {
          let timerId = 0;
          timerId = window.setTimeout(() => {
            scheduledScrollTimeoutsRef.current = scheduledScrollTimeoutsRef.current.filter((id) => id !== timerId);
            if (!mountedRef.current) return;
            const container = messagesRef.current;
            if (!container) return;
            if (stickToLatestRef.current || pendingScrollRef.current || isNearBottom(container)) {
              maybeScrollToLatest('auto');
            }
          }, delay);
          scheduledScrollTimeoutsRef.current.push(timerId);
        });
      });
    });
  }, [clearScheduledScrollTimeouts, maybeScrollToLatest]);

  useEffect(() => {
    currentTeamIdRef.current = teamId;
  }, [teamId]);

  useEffect(() => {
    let cancelled = false;

    async function loadContext() {
      if (!auth.user) return;
      setLoadingContext(true);
      setError(null);
      setStatus(null);
      setSelectedConversationId(preferredConversationId || DEFAULT_TEAM_CONVERSATION_ID);
      setOlderMessages([]);
      setLiveMessages([]);
      recipientOptionsPromiseRef.current = null;
      recipientOptionsRequestIdRef.current += 1;
      setRecipientOptions([]);
      setRecipientOptionsLoading(false);
      setRecipientOptionsLoaded(false);
      setRecipientOptionsError(null);
      initialSnapshotLoadedRef.current = false;
      pendingScrollRef.current = true;
      stickToLatestRef.current = true;
      setShowJumpToLatest(false);

      try {
        const context = await loadChatTeamContext(teamId, auth.user);
        if (cancelled) return;
        setTeam(context.team);
        setProfile(context.profile);
        setCanModerate(context.canModerate);
        const loadedConversations = await loadChatConversations(teamId, auth.user, context.team, context.canModerate);
        if (cancelled) return;
        setConversations(loadedConversations);
        setSelectedConversationId((current: string) => {
          if (loadedConversations.some((conversation) => conversation.id === current)) {
            return current;
          }
          if (preferredConversationId && loadedConversations.some((conversation) => conversation.id === preferredConversationId)) {
            return preferredConversationId;
          }
          return DEFAULT_TEAM_CONVERSATION_ID;
        });
        if (!context.canModerate) {
          setRecipientOptionsLoaded(true);
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setError(loadError?.message || 'Unable to load team chat.');
        }
      } finally {
        if (!cancelled) setLoadingContext(false);
      }
    }

    loadContext();
    return () => {
      cancelled = true;
    };
  }, [auth.user?.uid, preferredConversationId, teamId]);

  useEffect(() => {
    if (!team || !auth.user) return undefined;
    const currentUser = auth.user;

    setLoadingMessages(true);
    setError(null);
    setOlderMessages([]);
    setLiveMessages([]);
    setLiveOldestDoc(null);
    setHasMoreMessages(false);
    initialSnapshotLoadedRef.current = false;
    pendingScrollRef.current = true;
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);

    const subscription = subscribeToTeamChatMessages(
      teamId,
      selectedConversationId,
      (incomingMessages, oldestDoc) => {
        const isInitialSnapshot = !initialSnapshotLoadedRef.current;
        const wasNearBottom = isNearBottom(messagesRef.current);
        setLiveOldestDoc(oldestDoc || incomingMessages[incomingMessages.length - 1]?._doc || null);
        setLiveMessages(getSortedChatMessages(incomingMessages));
        setHasMoreMessages(incomingMessages.length >= 50);
        setLoadingMessages(false);
        if (isInitialSnapshot || pendingScrollRef.current || wasNearBottom) {
          pendingScrollRef.current = true;
          stickToLatestRef.current = true;
          setShowJumpToLatest(false);
        } else {
          stickToLatestRef.current = false;
          setShowJumpToLatest(true);
        }
        initialSnapshotLoadedRef.current = true;
        maybeMarkRead(currentUser.uid, teamId, true);
      },
      (subscribeError) => {
        setError(subscribeError.message || 'Unable to load chat messages.');
        setLoadingMessages(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, selectedConversationId, team, teamId]);

  useLayoutEffect(() => {
    if (!pendingScrollRef.current) return;
    scrollToLatest('auto');
    pendingScrollRef.current = false;
    scheduleScrollToLatest('auto');
  }, [messages.length, aiThinking, scheduleScrollToLatest, scrollToLatest, selectedConversationId]);

  useEffect(() => {
    const container = messagesRef.current;
    const content = messagesContentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      const nextHeight = Math.max(container.scrollHeight, content.scrollHeight);
      const distanceFromBottom = Math.max(0, nextHeight - container.clientHeight - container.scrollTop);
      const nextSignature = buildChatViewportSignature(nextHeight, container.clientHeight, container.scrollTop);
      if (nextSignature === lastObservedViewportSignatureRef.current) return;
      lastObservedViewportSignatureRef.current = nextSignature;
      if (stickToLatestRef.current) {
        if (distanceFromBottom > 4) {
          scrollToLatest('auto');
        }
        return;
      }
      if (pendingScrollRef.current || isNearBottom(container)) {
        scheduleScrollToLatest('auto');
      }
    });

    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scheduleScrollToLatest, scrollToLatest, selectedConversationId]);

  useEffect(() => {
    let cancelled = false;

    async function detectVoiceSupport() {
      if (voiceRecognition.isNativeRuntime()) {
        try {
          const result = await voiceRecognition.available();
          if (!cancelled) setVoiceSupported(result.available);
        } catch {
          if (!cancelled) setVoiceSupported(false);
        }
        return;
      }

      setVoiceSupported(voiceRecognition.hasBrowserSupport());
    }

    void detectVoiceSupport();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleReturn = () => {
      if (!auth.user?.uid) return;
      const isPageVisible = document.visibilityState === 'visible' && !document.hidden;
      const isWindowFocused = document.hasFocus();
      if (shouldRetryChatLastReadOnViewReturn({
        hasCurrentUser: Boolean(auth.user.uid),
        hasTeamId: Boolean(teamId),
        isPageVisible,
        isWindowFocused,
        hasMessages: messages.length > 0,
        hasLoadedSnapshot: initialSnapshotLoadedRef.current
      })) {
        void markTeamChatRead(auth.user.uid, teamId);
      }
    };
    document.addEventListener('visibilitychange', handleReturn);
    window.addEventListener('focus', handleReturn);
    return () => {
      document.removeEventListener('visibilitychange', handleReturn);
      window.removeEventListener('focus', handleReturn);
    };
  }, [auth.user?.uid, messages.length, teamId]);

  useEffect(() => {
    mountedRef.current = true;
    lastObservedViewportSignatureRef.current = '';

    return () => {
      mountedRef.current = false;
      clearScheduledScrollToLatest();
      filePreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
      stopVoiceCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearScheduledScrollToLatest]);

  const reloadConversations = async () => {
    if (!auth.user || !team) return;
    const loadedConversations = await loadChatConversations(teamId, auth.user, team, canModerate);
    setConversations(loadedConversations);
    return loadedConversations;
  };

  const switchConversation = (conversationId: string) => {
    if (!conversationId || conversationId === selectedConversationId) return;
    pendingScrollRef.current = true;
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
    setSelectedConversationId(conversationId);
    setSelectedRecipientTarget('full_team');
    setSelectedRecipientIds([]);
    setReactionMessageId('');
    setActionMessageId('');
    setShowConversationSheet(false);
  };

  const handleAudienceTargetChange = async (target: ChatTargetType) => {
    setSelectedRecipientTarget(target);
    if (target !== 'individuals') {
      setSelectedRecipientIds([]);
    }

    if (target === 'full_team') {
      if (!isDefaultTeamConversation(selectedConversationId)) {
        switchConversation(DEFAULT_TEAM_CONVERSATION_ID);
      }
      setShowAudienceSheet(false);
      return;
    }

    if (target === 'staff') {
      if (!auth.user || !team) return;
      try {
        const staffConversation = await ensureStaffChatConversation(teamId, auth.user, conversations);
        setConversations((current) => (
          current.some((conversation) => conversation.id === staffConversation.id)
            ? current
            : [...current, staffConversation]
        ));
        if (selectedConversationId !== staffConversation.id) {
          switchConversation(staffConversation.id);
        }
        setShowAudienceSheet(false);
      } catch (staffError: any) {
        setStatus({ tone: 'error', message: staffError?.message || 'Unable to open staff chat.' });
      }
    }
  };

  const loadOlderMessages = async () => {
    if (loadingOlder || !hasMoreMessages) return;
    const cursor = olderMessages[0]?._doc || liveOldestDoc;
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const batch = await loadOlderTeamChatMessages(teamId, selectedConversationId, cursor);
      if (batch.length < 50) setHasMoreMessages(false);
      setOlderMessages((current) => mergeChatMessageLists(getSortedChatMessages(batch), current));
    } catch (loadError: any) {
      setStatus({ tone: 'error', message: loadError?.message || 'Unable to load older messages.' });
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleMessagesScroll = () => {
    if (programmaticScrollRef.current) return;
    if (!messages.length) {
      stickToLatestRef.current = true;
      setShowJumpToLatest(false);
      return;
    }
    const isPinned = isNearBottom(messagesRef.current);
    stickToLatestRef.current = isPinned;
    setShowJumpToLatest(!isPinned);
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) return;
    const invalidType = selectedFiles.find((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'));
    if (invalidType) {
      setStatus({ tone: 'error', message: 'Choose image or video files only.' });
      event.target.value = '';
      return;
    }
    const oversized = selectedFiles.find((file) => file.size > MAX_CHAT_MEDIA_SIZE);
    if (oversized) {
      setStatus({ tone: 'error', message: 'Photos and videos must be 5MB or smaller each.' });
      event.target.value = '';
      return;
    }
    setFilePreviews((current) => [
      ...current,
      ...selectedFiles.map((file) => ({ file, url: URL.createObjectURL(file) }))
    ]);
    event.target.value = '';
    setShowAttachSheet(false);
  };

  const removeFile = (index: number) => {
    setFilePreviews((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      current[index] && URL.revokeObjectURL(current[index].url);
      return next;
    });
  };

  const openLinkSheet = () => {
    setShowAttachSheet(false);
    setLinkDraft('');
    setShowLinkSheet(true);
  };

  const addLinkToComposer = () => {
    const rawLink = linkDraft.trim();
    if (!rawLink) return;
    const href = rawLink.startsWith('www.') ? `https://${rawLink}` : rawLink;
    if (!isChatComposerLinkSafe(href)) {
      setStatus({ tone: 'error', message: 'Use a valid http or https link.' });
      return;
    }
    setText((current) => `${current.trim()}${current.trim() ? ' ' : ''}${href}`);
    setShowLinkSheet(false);
    setLinkDraft('');
  };

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!auth.user || !team || sending) return;
    const trimmed = text.trim();
    const files = filePreviews.map((preview) => preview.file);
    if (!trimmed && !files.length) return;

    const hasEmptySelectedAudience = selectedRecipientTarget === 'individuals'
      && selectedRecipientIds.map((id) => String(id || '').trim()).filter(Boolean).length === 0;
    if (hasEmptySelectedAudience) {
      setStatus({ tone: 'error', message: 'Choose at least one selected member before sending.' });
      setShowAudienceSheet(true);
      return;
    }

    setSending(true);
    setStatus(null);
    setComposerNotice(files.length ? `Uploading ${files.length} attachment${files.length === 1 ? '' : 's'}...` : 'Sending...');
    stopVoiceCapture();
    pendingScrollRef.current = true;

    try {
      const result = await sendTeamChatMessage({
        teamId,
        user: auth.user,
        profile,
        text: trimmed,
        files,
        selectedConversation,
        selectedConversationId,
        selectedRecipientTarget,
        selectedRecipientIds,
        onProgress: (stage) => {
          if (stage === 'uploading') {
            setComposerNotice(`Uploading ${files.length} attachment${files.length === 1 ? '' : 's'}...`);
          } else {
            setComposerNotice('Posting message...');
          }
        }
      });
      setText('');
      setFilePreviews((current) => {
        current.forEach((preview) => URL.revokeObjectURL(preview.url));
        return [];
      });
      if (result.createdConversation) {
        await reloadConversations();
      }
      if (result.conversationId !== selectedConversationId) {
        setSelectedConversationId(result.conversationId);
      }
      setSelectedRecipientTarget('full_team');
      setSelectedRecipientIds([]);

      if (result.wantsAi) {
        setComposerNotice('Asking ALL PLAYS...');
        const question = extractAllPlaysQuestion(trimmed);
        if (!question) {
          setStatus({ tone: 'error', message: 'Ask a question after @ALL PLAYS.' });
        } else {
          setAiThinking(true);
          try {
            await sendAllPlaysChatAnswer({
              teamId,
              team,
              user: auth.user,
              question,
              selectedConversation,
              selectedConversationId: result.conversationId,
              selectedRecipientTarget,
              selectedRecipientIds
            });
          } catch (aiError: any) {
            setStatus({ tone: 'error', message: aiError?.message || 'ALL PLAYS could not answer. Please try again.' });
          } finally {
            setAiThinking(false);
          }
        }
      }
    } catch (sendError: any) {
      setStatus({ tone: 'error', message: sendError?.message || 'Failed to send message. Please try again.' });
    } finally {
      setComposerNotice('');
      setSending(false);
    }
  };

  const reloadSentEmailHistory = async ({ suppressErrorStatus = false } = {}) => {
    if (!canModerate) return;
    setEmailLoadingHistory(true);
    try {
      setSentEmails(await loadSentTeamEmails(teamId, { limit: 25 }));
      setEmailHistoryStatus(null);
    } catch (historyError: any) {
      if (!suppressErrorStatus) {
        setEmailHistoryStatus({ tone: 'error', message: historyError?.message || 'Could not load sent email history.' });
      }
    } finally {
      setEmailLoadingHistory(false);
    }
  };

  const reloadEmailTemplates = async ({ suppressErrorStatus = false } = {}) => {
    if (!canModerate) return;
    setEmailLoadingTemplates(true);
    try {
      setEmailTemplates(await loadTeamEmailTemplates(teamId));
      if (!suppressErrorStatus) {
        setEmailStatus(null);
      }
    } catch (templateError: any) {
      if (!suppressErrorStatus) {
        setEmailStatus({ tone: 'error', message: templateError?.message || 'Could not load team email templates.' });
      }
    } finally {
      setEmailLoadingTemplates(false);
    }
  };

  const reloadEmailDrafts = async ({ suppressErrorStatus = false } = {}) => {
    if (!canModerate) return;
    setEmailLoadingDrafts(true);
    try {
      setEmailDrafts(await loadTeamEmailDrafts(teamId));
      if (!suppressErrorStatus) {
        setEmailStatus(null);
      }
    } catch (draftError: any) {
      if (!suppressErrorStatus) {
        setEmailStatus({ tone: 'error', message: draftError?.message || 'Could not load saved drafts.' });
      }
    } finally {
      setEmailLoadingDrafts(false);
    }
  };

  const openEmailSheet = () => {
    if (!canModerate) return;
    setShowEmailSheet(true);
    setEmailTemplateName('');
    setEmailStatus(null);
    setEmailHistoryStatus(null);
    setSelectedEmailDraftId('');
    void ensureRecipientOptionsLoaded().catch(() => undefined);
    void reloadEmailDrafts();
    void reloadEmailTemplates();
    void reloadSentEmailHistory();
  };

  const handleApplyEmailDraft = (draftId: string) => {
    const draft = emailDrafts.find((item) => item.id === draftId);
    if (!draft) return;
    if (!isDefaultTeamConversation(selectedConversationId)) {
      switchConversation(DEFAULT_TEAM_CONVERSATION_ID);
    }
    setSelectedRecipientTarget('individuals');
    setSelectedRecipientIds(draft.recipientIds);
    setEmailSubject(draft.subject || '');
    setEmailBody(draft.body || '');
    setSelectedEmailDraftId(draft.id);
    setEmailStatus({ tone: 'success', message: `Restored draft “${draft.subject || 'Untitled draft'}”. This replaced the current email composer.` });
  };

  const handleApplyEmailTemplate = (templateId: string) => {
    const template = emailTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setEmailSubject(template.subject || '');
    setEmailBody(template.body || '');
    setEmailStatus({ tone: 'success', message: `Applied template “${template.name}”.` });
  };

  const handleSaveEmailTemplate = async () => {
    if (!canModerate || emailSavingTemplate) return;
    setEmailSavingTemplate(true);
    setEmailStatus({ tone: 'neutral', message: 'Saving team email template...' });
    try {
      const savedTemplate = await saveTeamEmailTemplate({
        teamId,
        name: emailTemplateName,
        subject: emailSubject,
        body: emailBody
      });
      setEmailTemplateName('');
      setEmailTemplates((current) => [savedTemplate, ...current.filter((item) => item.id !== savedTemplate.id)]);
      setEmailStatus({ tone: 'success', message: `Saved template “${savedTemplate.name}”.` });
      void reloadEmailTemplates({ suppressErrorStatus: true });
    } catch (saveError: any) {
      setEmailStatus({ tone: 'error', message: saveError?.message || 'Could not save team email template.' });
    } finally {
      setEmailSavingTemplate(false);
    }
  };

  const handleSaveEmailDraft = async () => {
    if (!canModerate || emailSavingDraft) return;
    setEmailSavingDraft(true);
    setEmailStatus({ tone: 'neutral', message: 'Saving team email draft...' });
    try {
      const savedDraft = await saveTeamEmailDraft({
        teamId,
        draftId: selectedEmailDraftId || null,
        subject: emailSubject,
        body: emailBody,
        recipientIds: emailAudienceMetadata.recipientIds,
        recipientOptions,
        authorId: auth.user?.uid || null,
        authorEmail: auth.user?.email || null,
        authorName: profile?.fullName || auth.user?.displayName || null
      });
      setSelectedEmailDraftId(savedDraft.id);
      setEmailDrafts((current) => [savedDraft, ...current.filter((item) => item.id !== savedDraft.id)]);
      setEmailStatus({ tone: 'success', message: `Saved draft “${savedDraft.subject || 'Untitled draft'}”. No email was sent.` });
      void reloadEmailDrafts({ suppressErrorStatus: true });
    } catch (saveError: any) {
      setEmailStatus({ tone: 'error', message: saveError?.message || 'Could not save team email draft.' });
    } finally {
      setEmailSavingDraft(false);
    }
  };

  const handleSendEmail = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canModerate || emailSending) return;
    const subject = emailSubject.trim();
    const body = emailBody.trim();
    if (!subject || !body) {
      setEmailStatus({ tone: 'error', message: 'Subject and message are required.' });
      return;
    }
    if (emailAudienceMetadata.targetType === 'individuals' && emailAudienceMetadata.recipientIds.length === 0) {
      setEmailStatus({ tone: 'error', message: 'Choose at least one selected member before sending.' });
      return;
    }

    setEmailSending(true);
    setEmailStatus({ tone: 'neutral', message: 'Creating backend mail jobs...' });
    try {
      const result = await sendTeamEmailMessage({
        teamId,
        subject,
        body,
        targetType: emailAudienceMetadata.targetType,
        recipientIds: emailAudienceMetadata.recipientIds
      });
      setEmailSubject('');
      setEmailBody('');
      setEmailStatus({ tone: 'success', message: `Queued ${Number(result?.recipientCount || 0)} recipient${Number(result?.recipientCount || 0) === 1 ? '' : 's'} for backend email delivery.` });
      await reloadSentEmailHistory({ suppressErrorStatus: true });
    } catch (sendError: any) {
      setEmailStatus({ tone: 'error', message: sendError?.message || 'Email send failed. Nothing was silently dropped.' });
    } finally {
      setEmailSending(false);
    }
  };

  const toggleVoiceCapture = async () => {
    if (voiceListening) {
      stopVoiceCapture();
      return;
    }

    setStatus(null);
    const dictationLanguage = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';

    if (voiceRecognition.isNativeRuntime()) {
      try {
        const available = await voiceRecognition.available();
        if (!available.available) {
          setVoiceSupported(false);
          setStatus({ tone: 'error', message: 'Voice dictation is not available on this device.' });
          return;
        }

        let permissions = await voiceRecognition.checkPermissions();
        if (permissions.speechRecognition !== 'granted') {
          permissions = await voiceRecognition.requestPermissions();
        }
        if (permissions.speechRecognition !== 'granted') {
          setStatus({ tone: 'error', message: 'Enable microphone and speech recognition access to dictate messages.' });
          return;
        }

        await removeNativeVoiceListeners();
        voiceStopRequestedRef.current = false;
        nativeVoiceListeningRef.current = true;
        voiceBaseTextRef.current = text;
        voicePartialRef.current = '';
        setVoiceListening(true);
        setComposerNotice('Listening...');
        const partialHandle = await voiceRecognition.addPartialResultsListener((event) => {
          const transcript = event.accumulatedText || event.accumulated || event.matches?.[0] || '';
          setVoiceDraftTranscript(transcript);
        });
        const stateHandle = await voiceRecognition.addListeningStateListener((event) => {
          if (event.status === 'stopped' || event.state === 'stopped') {
            void finishNativeVoiceCapture();
          }
        });
        const errorHandle = await voiceRecognition.addErrorListener((event) => {
          if (!voiceStopRequestedRef.current) {
            setStatus({ tone: 'error', message: event.message || 'Voice recognition failed. Try again.' });
          }
          void finishNativeVoiceCapture();
        });
        voiceListenerHandlesRef.current = [partialHandle, stateHandle, errorHandle];
        const result = await voiceRecognition.start({
          language: dictationLanguage,
          maxResults: 1,
          partialResults: true,
          addPunctuation: true,
          contextualStrings: ['ALL PLAYS', teamName],
          popup: false,
          prompt: 'Speak your message'
        });
        setVoiceDraftTranscript(result?.matches?.[0] || '');
      } catch (voiceError: any) {
        await removeNativeVoiceListeners();
        nativeVoiceListeningRef.current = false;
        setVoiceListening(false);
        setComposerNotice('');
        if (!voiceStopRequestedRef.current) {
          setStatus({ tone: 'error', message: voiceError?.message || 'Voice recognition failed. Try again.' });
        }
        voiceStopRequestedRef.current = false;
      }
      return;
    }

    const BrowserSpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!BrowserSpeechRecognition) {
      setVoiceSupported(false);
      setStatus({ tone: 'error', message: 'Voice input is not supported in this browser.' });
      return;
    }
    const recognition = new BrowserSpeechRecognition();
    recognition.lang = dictationLanguage;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (speechEvent: any) => {
      const transcript = Array.from(speechEvent.results || [])
        .map((result: any) => result?.[0]?.transcript || '')
        .join(' ')
        .trim();
      setVoiceDraftTranscript(transcript);
    };
    recognition.onerror = () => setStatus({ tone: 'error', message: 'Voice recognition failed. Try again.' });
    recognition.onend = () => {
      setVoiceListening(false);
      recognitionRef.current = null;
      voiceBaseTextRef.current = '';
      voicePartialRef.current = '';
      setComposerNotice((current) => current === 'Listening...' ? '' : current);
    };
    recognitionRef.current = recognition;
    voiceBaseTextRef.current = text;
    voicePartialRef.current = '';
    setVoiceListening(true);
    setComposerNotice('Listening...');
    try {
      recognition.start();
    } catch (voiceError: any) {
      recognitionRef.current = null;
      setVoiceListening(false);
      setStatus({ tone: 'error', message: voiceError?.message || 'Voice recognition failed. Try again.' });
    }
  };

  const stopVoiceCapture = () => {
    voiceStopRequestedRef.current = true;
    if (nativeVoiceListeningRef.current) {
      void (async () => {
        try {
          await voiceRecognition.forceStop({ timeout: 1200 });
        } catch {
          try {
            await voiceRecognition.stop();
          } catch {
            // Best effort only.
          }
        } finally {
          await finishNativeVoiceCapture();
        }
      })();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Best effort only.
      }
    }
    recognitionRef.current = null;
    setVoiceListening(false);
    if (!nativeVoiceListeningRef.current) {
      setComposerNotice((current) => current === 'Listening...' ? '' : current);
    }
  };

  const insertAllPlaysMention = () => {
    setText((current) => {
      if (hasAllPlaysMention(current)) return current;
      const triggerPattern = /(^|\s)@\w*$/i;
      if (triggerPattern.test(current)) {
        return current.replace(triggerPattern, (_match, prefix) => `${prefix}@ALL PLAYS `);
      }
      const spacer = current.trim() ? ' ' : '';
      return `${current}${spacer}@ALL PLAYS `;
    });
  };

  const handleToggleReaction = useCallback(async (messageId: string, reactionKey: string) => {
    if (!auth.user) return;
    try {
      await toggleTeamChatReaction(teamId, messageId, reactionKey, auth.user.uid, selectedConversationId);
      setReactionMessageId('');
    } catch (reactionError: any) {
      setStatus({ tone: 'error', message: reactionError?.message || 'Failed to update reaction.' });
    }
  }, [auth.user, selectedConversationId, teamId]);

  const handleEdit = useCallback((message: ChatMessage) => {
    setEditingMessage(message);
    setEditText(message.text || '');
    setActionMessageId('');
  }, []);

  const saveEdit = async () => {
    if (!editingMessage) return;
    const trimmed = editText.trim();
    if (!trimmed) {
      setStatus({ tone: 'error', message: 'Message cannot be empty.' });
      return;
    }
    try {
      await editTeamChatMessage(teamId, editingMessage.id, trimmed, selectedConversationId);
      setEditingMessage(null);
      setEditText('');
    } catch (editError: any) {
      setStatus({ tone: 'error', message: editError?.message || 'Failed to edit message.' });
    }
  };

  const handleDelete = useCallback(async (message: ChatMessage) => {
    setActionMessageId('');
    if (!window.confirm('Delete this message?')) return;
    try {
      await deleteTeamChatMessage(teamId, message.id, selectedConversationId);
    } catch (deleteError: any) {
      setStatus({ tone: 'error', message: deleteError?.message || 'Failed to delete message.' });
    }
  }, [selectedConversationId, teamId]);

  if (loadingContext) {
    return <MessagesPageSkeleton embedded={embedded} />;
  }

  if (error) {
    return (
      <section className={`chat-window app-card p-5 ${embedded ? 'chat-window-embedded' : ''}`}>
        <div className="text-base font-black text-rose-700">{error}</div>
        <button type="button" className="secondary-button mt-4" onClick={() => navigate('/messages')}>Back to messages</button>
      </section>
    );
  }

  return (
    <div className={`chat-window ${embedded ? 'chat-window-embedded' : 'chat-window-mobile'}`}>
      <section className={`chat-topbar ${embedded ? 'rounded-xl' : 'safe-top sticky top-0'} z-20 border border-gray-200 bg-white/95 px-3 py-3 shadow-app backdrop-blur`}>
        <div className="flex items-center gap-2">
          {!embedded ? (
            <Link to="/messages" className="ghost-button !h-10 !min-h-10 !w-10 !p-0" aria-label="Back to messages">
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
          ) : null}
          <TeamAvatar team={{ name: teamName, photoUrl: team?.photoUrl || inboxTeam?.photoUrl, unreadCount: 0 }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-black text-gray-950">{teamName}</div>
            <button
              type="button"
              className="mt-0.5 flex max-w-full items-center gap-1 text-left text-xs font-bold text-gray-500"
              onClick={() => setShowConversationSheet(true)}
            >
              <span className="truncate">{getConversationDisplayName(selectedConversation, team || {})}</span>
              <ChevronDown className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            </button>
          </div>
          {canModerate ? (
            <span className="hidden items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase text-emerald-700 sm:inline-flex">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Staff
            </span>
          ) : null}
          <button type="button" className="ghost-button !h-10 !min-h-10 !w-10 !p-0" onClick={() => setShowMediaGallery(true)} aria-label="Open photos and videos">
            <ImageIcon className="h-5 w-5" aria-hidden="true" />
            {mediaEntries.length ? <span className="sr-only">{mediaEntries.length} shared media items</span> : null}
          </button>
        </div>

        {isDesktopWeb ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {conversations.map((conversation) => {
              const active = conversation.id === selectedConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${
                    active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-primary-50 hover:text-primary-700'
                  }`}
                  onClick={() => switchConversation(conversation.id)}
                >
                  {getConversationDisplayName(conversation, team || {})}
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      {status ? <StatusBanner status={status} onClose={() => setStatus(null)} /> : null}

      <section className="chat-body app-card">
        {hasMoreMessages ? (
          <div className="border-b border-gray-100 p-2 text-center">
            <button type="button" className="ghost-button !h-9 !min-h-9 text-xs" onClick={loadOlderMessages} disabled={loadingOlder}>
              {loadingOlder ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
              Load older messages
            </button>
          </div>
        ) : null}

        <div ref={messagesRef} className="chat-messages-scroll" onScroll={handleMessagesScroll}>
          <div ref={messagesContentRef} className="chat-messages-content">
            {loadingMessages ? (
              <div className="flex min-h-64 items-center justify-center text-sm font-bold text-gray-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Loading messages...
              </div>
            ) : messages.length === 0 && !aiThinking ? (
              <div className="flex min-h-64 items-center justify-center p-8 text-center">
                <div>
                  <MessageCircle className="mx-auto h-12 w-12 text-gray-300" aria-hidden="true" />
                  <div className="mt-3 text-base font-black text-gray-950">No messages yet</div>
                  <div className="mt-1 text-sm font-semibold text-gray-500">Send the first update to {teamName}.</div>
                </div>
              </div>
            ) : (
              <MessageList
                messages={messages}
                currentUserId={auth.user?.uid || ''}
                canModerate={canModerate}
                actionMessageId={actionMessageId}
                reactionMessageId={reactionMessageId}
                onActionMessage={setActionMessageId}
                onReactionMessage={setReactionMessageId}
                onToggleReaction={handleToggleReaction}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            )}
            {aiThinking ? <AiThinkingBubble /> : null}
            <div ref={messagesEndRef} data-testid="chat-bottom-anchor" aria-hidden="true" />
          </div>
        </div>
        {showJumpToLatest ? (
          <button type="button" className="chat-latest-button" onClick={() => scheduleScrollToLatest('smooth')}>
            <span>Latest</span>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </section>

      <Composer
        teamName={teamName}
        text={text}
        filePreviews={filePreviews}
        sending={sending}
        composerNotice={composerNotice}
        aiThinking={aiThinking}
        voiceListening={voiceListening}
        voiceSupported={voiceSupported}
        canModerate={canModerate && isDefaultTeamConversation(selectedConversationId)}
        canSendTeamEmail={canModerate}
        audienceSummary={audienceSummary}
        onTextChange={setText}
        onSubmit={handleSend}
        onAttach={() => setShowAttachSheet(true)}
        onRemoveFile={removeFile}
        onVoice={toggleVoiceCapture}
        onAudience={() => {
          setShowAudienceSheet(true);
          void ensureRecipientOptionsLoaded().catch(() => undefined);
        }}
        onTeamEmail={openEmailSheet}
        onMention={insertAllPlaysMention}
      />

      <input ref={photoInputRef} type="file" className="chat-file-input" accept="image/*" multiple onChange={handleFiles} aria-hidden="true" tabIndex={-1} />
      <input ref={videoInputRef} type="file" className="chat-file-input" accept="video/*" multiple onChange={handleFiles} aria-hidden="true" tabIndex={-1} />

      {showConversationSheet ? (
        <ConversationSheet
          conversations={conversations}
          team={team || {}}
          selectedConversationId={selectedConversationId}
          onSelect={switchConversation}
          onClose={() => setShowConversationSheet(false)}
        />
      ) : null}

      {showAudienceSheet ? (
        <AudienceSheet
          selectedTarget={selectedRecipientTarget}
          selectedRecipientIds={selectedRecipientIds}
          recipientOptions={recipientOptions}
          recipientOptionsLoading={recipientOptionsLoading}
          recipientOptionsError={recipientOptionsError}
          onTargetChange={handleAudienceTargetChange}
          onRecipientsChange={setSelectedRecipientIds}
          onRetryRecipientOptions={() => {
            void ensureRecipientOptionsLoaded().catch(() => undefined);
          }}
          onClose={() => setShowAudienceSheet(false)}
        />
      ) : null}

      {showAttachSheet ? (
        <AttachSheet
          onPhoto={() => photoInputRef.current?.click()}
          onVideo={() => videoInputRef.current?.click()}
          onLink={openLinkSheet}
          onMention={insertAllPlaysMention}
          onClose={() => setShowAttachSheet(false)}
        />
      ) : null}

      {showLinkSheet ? (
        <LinkSheet
          value={linkDraft}
          onChange={setLinkDraft}
          onAdd={addLinkToComposer}
          onClose={() => setShowLinkSheet(false)}
        />
      ) : null}

      {showEmailSheet && canModerate ? (
        <TeamEmailSheet
          subject={emailSubject}
          body={emailBody}
          drafts={emailDrafts}
          selectedDraftId={selectedEmailDraftId}
          templateName={emailTemplateName}
          savingDraft={emailSavingDraft}
          loadingDrafts={emailLoadingDrafts}
          templates={emailTemplates}
          sending={emailSending}
          savingTemplate={emailSavingTemplate}
          loadingHistory={emailLoadingHistory}
          loadingTemplates={emailLoadingTemplates}
          recipientOptionsLoading={recipientOptionsLoading}
          recipientOptionsError={recipientOptionsError}
          status={emailStatus}
          historyStatus={emailHistoryStatus}
          sentEmails={sentEmails}
          audienceSummary={getAudienceSummaryText(emailAudienceMetadata, recipientOptions)}
          audienceMetadata={emailAudienceMetadata}
          onSubjectChange={setEmailSubject}
          onBodyChange={setEmailBody}
          onTemplateNameChange={setEmailTemplateName}
          onApplyDraft={handleApplyEmailDraft}
          onSaveDraft={handleSaveEmailDraft}
          onApplyTemplate={handleApplyEmailTemplate}
          onSaveTemplate={handleSaveEmailTemplate}
          onSubmit={handleSendEmail}
          onRefreshDrafts={reloadEmailDrafts}
          onRefreshHistory={reloadSentEmailHistory}
          onRefreshTemplates={reloadEmailTemplates}
          onRetryRecipientOptions={() => {
            void ensureRecipientOptionsLoaded().catch(() => undefined);
          }}
          onStatusClose={() => setEmailStatus(null)}
          onHistoryStatusClose={() => setEmailHistoryStatus(null)}
          onClose={() => setShowEmailSheet(false)}
        />
      ) : null}

      {showMediaGallery ? (
        <MediaGallerySheet mediaEntries={mediaEntries} onClose={() => setShowMediaGallery(false)} onStatus={setStatus} />
      ) : null}

      {editingMessage ? (
        <EditMessageModal
          value={editText}
          onChange={setEditText}
          onCancel={() => setEditingMessage(null)}
          onSave={saveEdit}
        />
      ) : null}
    </div>
  );
}

export function buildChatViewportSignature(scrollHeight: number, clientHeight: number, scrollTop: number) {
  const distanceFromBottom = Math.max(0, scrollHeight - clientHeight - scrollTop);
  return `${scrollHeight}:${clientHeight}:${distanceFromBottom}`;
}

function getPreferredConversationIdFromSearch(search: string) {
  const params = new URLSearchParams(search || '');
  return String(params.get('conversationId') || '').trim();
}

function buildMessagesRoute(teamId: string, preferredConversationId?: string | null) {
  const normalizedTeamId = String(teamId || '').trim();
  if (!normalizedTeamId) return '/messages';
  const route = `/messages/${encodeURIComponent(normalizedTeamId)}`;
  const normalizedConversationId = String(preferredConversationId || '').trim();
  if (!normalizedConversationId) return route;
  return `${route}?conversationId=${encodeURIComponent(normalizedConversationId)}`;
}

function maybeMarkRead(userId: string, teamId: string, hasTeamId: boolean) {
  const isPageVisible = document.visibilityState === 'visible' && !document.hidden;
  const isWindowFocused = document.hasFocus();
  if (shouldUpdateChatLastRead({
    hasCurrentUser: Boolean(userId),
    hasTeamId,
    isPageVisible,
    isWindowFocused
  })) {
    void markTeamChatRead(userId, teamId);
  }
}

function isNearBottom(container: HTMLDivElement | null) {
  if (!container) return true;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= 96;
}

function StatusBanner({ status, onClose }: { status: ChatStatus; onClose: () => void }) {
  const toneClass = status.tone === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : status.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-primary-200 bg-primary-50 text-primary-700';
  return (
    <div className={`mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm font-bold ${toneClass}`}>
      <span>{status.message}</span>
      <button type="button" className="rounded-lg p-1" onClick={onClose} aria-label="Close status">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function TeamEmailSheet({
  subject,
  body,
  drafts,
  selectedDraftId,
  templateName,
  savingDraft,
  loadingDrafts,
  templates,
  sending,
  savingTemplate,
  loadingHistory,
  loadingTemplates,
  recipientOptionsLoading,
  recipientOptionsError,
  status,
  historyStatus,
  sentEmails,
  audienceSummary,
  audienceMetadata,
  onSubjectChange,
  onBodyChange,
  onTemplateNameChange,
  onApplyDraft,
  onSaveDraft,
  onApplyTemplate,
  onSaveTemplate,
  onSubmit,
  onRefreshDrafts,
  onRefreshHistory,
  onRefreshTemplates,
  onRetryRecipientOptions,
  onStatusClose,
  onHistoryStatusClose,
  onClose
}: {
  subject: string;
  body: string;
  drafts: TeamEmailDraft[];
  selectedDraftId: string;
  templateName: string;
  savingDraft: boolean;
  loadingDrafts: boolean;
  templates: TeamEmailTemplate[];
  sending: boolean;
  savingTemplate: boolean;
  loadingHistory: boolean;
  loadingTemplates: boolean;
  recipientOptionsLoading: boolean;
  recipientOptionsError: string | null;
  status: ChatStatus | null;
  historyStatus: ChatStatus | null;
  sentEmails: SentTeamEmail[];
  audienceSummary: string;
  audienceMetadata: ChatAudienceMetadata;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onTemplateNameChange: (value: string) => void;
  onApplyDraft: (draftId: string) => void;
  onSaveDraft: () => void;
  onApplyTemplate: (templateId: string) => void;
  onSaveTemplate: () => void;
  onSubmit: (event?: FormEvent) => void;
  onRefreshDrafts: () => void;
  onRefreshHistory: () => void;
  onRefreshTemplates: () => void;
  onRetryRecipientOptions: () => void;
  onStatusClose: () => void;
  onHistoryStatusClose: () => void;
  onClose: () => void;
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const draftAudienceSupported = audienceMetadata.targetType === 'individuals';
  const missingSelectedRecipients = audienceMetadata.targetType === 'individuals' && audienceMetadata.recipientIds.length === 0;
  const canSendEmail = Boolean(subject.trim() && body.trim()) && !missingSelectedRecipients && !sending;
  const canSaveDraft = draftAudienceSupported
    && !recipientOptionsLoading
    && !recipientOptionsError
    && Boolean(subject.trim() && body.trim())
    && !missingSelectedRecipients
    && !savingDraft;
  const canSaveTemplate = Boolean(templateName.trim() && subject.trim() && body.trim()) && !savingTemplate;

  useEffect(() => {
    if (!selectedTemplateId) return;
    if (!templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId('');
    }
  }, [selectedTemplateId, templates]);

  return (
    <Sheet title="Team Email" onClose={onClose}>
      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
          Sends one backend roster email job. This is separate from chat posting, and delivery jobs are queued.
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700">
          Audience: {audienceSummary}
        </div>
        {recipientOptionsLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-500">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
            Loading recipient options...
          </div>
        ) : recipientOptionsError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
            <div>{recipientOptionsError}</div>
            <button type="button" className="ghost-button mt-2 !h-8 !min-h-8 !px-2 text-xs" onClick={onRetryRecipientOptions}>
              Retry recipient load
            </button>
          </div>
        ) : null}
        <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black text-gray-950">Saved drafts</div>
              <div className="text-xs font-semibold leading-5 text-gray-500">Drafts keep selected recipients, subject, and body. Saving never sends email.</div>
            </div>
            <div className="flex gap-2">
              <button type="button" className="ghost-button !h-9 !min-h-9 text-xs" onClick={onRefreshDrafts} disabled={loadingDrafts}>
                {loadingDrafts ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                Refresh
              </button>
              <button type="button" className="secondary-button !h-9 !min-h-9 text-xs" disabled={!canSaveDraft} onClick={onSaveDraft}>
                {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Save draft
              </button>
            </div>
          </div>
          {loadingDrafts && drafts.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-500">Loading saved drafts...</div>
          ) : drafts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-500">
              No saved drafts yet.
            </div>
          ) : (
            <div className="space-y-2">
              {drafts.map((draft) => {
                const isSelected = draft.id === selectedDraftId;
                return (
                  <button
                    key={draft.id}
                    type="button"
                    className={`w-full rounded-xl border px-3 py-2 text-left ${isSelected ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => onApplyDraft(draft.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black">{draft.subject || '(No subject)'}</div>
                        <div className="mt-0.5 text-xs font-semibold text-gray-500">{Math.max(draft.recipientIds.length, draft.recipients.length)} recipient{Math.max(draft.recipientIds.length, draft.recipients.length) === 1 ? '' : 's'} · {formatEmailSentTime(draft.updatedAt)}</div>
                      </div>
                      {isSelected ? <span className="text-[11px] font-black uppercase">Current</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {!draftAudienceSupported ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
              Draft saving is available only for Selected members.
            </div>
          ) : missingSelectedRecipients ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
              Choose at least one selected member before saving or sending email.
            </div>
          ) : null}
        </div>
        <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black text-gray-950">Reusable templates</div>
              <div className="text-xs font-semibold leading-5 text-gray-500">Apply a saved subject and body without changing recipients.</div>
            </div>
            <button type="button" className="ghost-button !h-9 !min-h-9 text-xs" onClick={onRefreshTemplates} disabled={loadingTemplates}>
              {loadingTemplates ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              Refresh
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="app-label">Saved template</span>
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
              >
                <option value="">Select a template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary-button sm:mt-6" disabled={!selectedTemplateId} onClick={() => onApplyTemplate(selectedTemplateId)}>
              Apply template
            </button>
          </div>
          {!loadingTemplates && templates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-500">
              No saved team email templates yet.
            </div>
          ) : null}
          <label className="block">
            <span className="app-label">Save current email as template</span>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input
                value={templateName}
                onChange={(event) => onTemplateNameChange(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                placeholder="Weekly reminder"
                maxLength={120}
              />
              <button type="button" className="secondary-button sm:min-w-[148px]" disabled={!canSaveTemplate} onClick={onSaveTemplate}>
                {savingTemplate ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Save template
              </button>
            </div>
          </label>
        </div>
        <label className="block">
          <span className="app-label">Subject</span>
          <input
            value={subject}
            onChange={(event) => onSubjectChange(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            placeholder="Team update"
            maxLength={160}
          />
        </label>
        <label className="block">
          <span className="app-label">Message</span>
          <textarea
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            className="mt-1 min-h-36 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            placeholder="Write the email body..."
            maxLength={5000}
          />
        </label>
        <button type="submit" className="primary-button w-full" disabled={!canSendEmail}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
          Send email
        </button>
        {status ? <StatusBanner status={status} onClose={onStatusClose} /> : null}
      </form>

      <div className="mt-5 border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black text-gray-950">Sent email history</div>
            <div className="text-xs font-semibold text-gray-500">Latest queued roster emails. Recipient email addresses are hidden.</div>
          </div>
          <button type="button" className="ghost-button !h-9 !min-h-9 text-xs" onClick={onRefreshHistory} disabled={loadingHistory}>
            {loadingHistory ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Refresh
          </button>
        </div>
        {historyStatus ? <StatusBanner status={historyStatus} onClose={onHistoryStatusClose} /> : null}
        <div className="mt-3 space-y-2">
          {loadingHistory && sentEmails.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm font-bold text-gray-500">Loading sent emails...</div>
          ) : sentEmails.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm font-bold text-gray-500">No sent team emails yet.</div>
          ) : sentEmails.map((email) => {
            const delivery = email.delivery || {};
            const statusLabel = String(delivery.status || email.status || 'queued');
            return (
              <div key={email.id} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-gray-950">{email.subject || '(No subject)'}</div>
                    <div className="mt-0.5 text-xs font-semibold text-gray-500">From {email.senderName || 'Team admin'} · {formatEmailSentTime(email.sentAt)}</div>
                  </div>
                  <div className="flex-none text-right text-xs font-bold text-gray-500">
                    {Number(email.recipientCount || 0)} recipients<br />{statusLabel}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

function formatEmailSentTime(value: unknown) {
  const day = formatChatDay(value);
  const time = formatChatTime(value);
  return [day, time].filter(Boolean).join(' ') || 'Queued';
}

type MessageListProps = {
  messages: ChatMessage[];
  currentUserId: string;
  canModerate: boolean;
  actionMessageId: string;
  reactionMessageId: string;
  onActionMessage: (messageId: string) => void;
  onReactionMessage: (messageId: string) => void;
  onToggleReaction: (messageId: string, reactionKey: string) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
};

const MessageList = memo(function MessageList({
  messages,
  currentUserId,
  canModerate,
  actionMessageId,
  reactionMessageId,
  onActionMessage,
  onReactionMessage,
  onToggleReaction,
  onEdit,
  onDelete
}: MessageListProps) {
  let lastDay = '';
  return (
    <div className="space-y-3 p-3 sm:p-4">
      {messages.map((message, index) => {
        const day = formatChatDay(message.createdAt);
        const showDay = day && day !== lastDay;
        const preferReactionPickerAbove = index >= Math.max(0, messages.length - 2);
        lastDay = day || lastDay;
        return (
          <div key={message.id}>
            {showDay ? <div className="my-3 text-center text-[11px] font-black uppercase text-gray-400">{day}</div> : null}
            <MessageBubble
              message={message}
              currentUserId={currentUserId}
              canModerate={canModerate}
              actionsOpen={actionMessageId === message.id}
              reactionsOpen={reactionMessageId === message.id}
              preferReactionPickerAbove={preferReactionPickerAbove}
              onActionMessage={onActionMessage}
              onReactionMessage={onReactionMessage}
              onToggleReaction={onToggleReaction}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        );
      })}
    </div>
  );
});

MessageList.displayName = 'MessageList';

type MessageBubbleProps = {
  message: ChatMessage;
  currentUserId: string;
  canModerate: boolean;
  actionsOpen: boolean;
  reactionsOpen: boolean;
  preferReactionPickerAbove: boolean;
  onActionMessage: (messageId: string) => void;
  onReactionMessage: (messageId: string) => void;
  onToggleReaction: (messageId: string, reactionKey: string) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
};

const MessageBubble = memo(function MessageBubble({
  message,
  currentUserId,
  canModerate,
  actionsOpen,
  reactionsOpen,
  preferReactionPickerAbove,
  onActionMessage,
  onReactionMessage,
  onToggleReaction,
  onEdit,
  onDelete
}: MessageBubbleProps) {
  const isAi = message.ai === true;
  const isOwn = !isAi && message.senderId === currentUserId;
  const isDeleted = message.deleted === true;
  const senderLabel = useMemo(() => getMessageSenderLabel(message, currentUserId), [currentUserId, message]);
  const attachments = useMemo(
    () => getMessageAttachments(message).filter((attachment: any) => isSafeChatMediaUrl(attachment.url)),
    [message]
  );
  const reactions = useMemo(() => normalizeChatReactions(message), [message]);
  const messageHtml = useMemo(() => formatChatMessageHtml(message.text || ''), [message.text]);
  const createdAtLabel = useMemo(() => formatChatTime(message.createdAt), [message.createdAt]);
  const canEdit = isOwn && !isDeleted && Boolean(message.text);
  const canDelete = !isAi && !isDeleted && (isOwn || canModerate);

  if (isDeleted) {
    return (
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
        <div className="max-w-[82%] rounded-2xl bg-gray-100 px-4 py-2 text-sm font-semibold italic text-gray-400">
          Message removed
        </div>
      </div>
    );
  }

  return (
    <div className={`message-bubble group flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
      {!isOwn ? <MessageAvatar message={message} label={senderLabel} /> : null}
      <div className={`relative max-w-[82%] sm:max-w-[74%] ${isOwn ? 'items-end' : 'items-start'}`}>
        <div className={`mb-1 flex items-center gap-2 text-[11px] font-bold text-gray-500 ${isOwn ? 'justify-end' : 'justify-start'}`}>
          {!isOwn ? <span className="truncate">{senderLabel}</span> : null}
          {message.editedAt ? <span className="italic">(edited)</span> : null}
          <span>{createdAtLabel}</span>
        </div>
        <div className={`rounded-2xl px-3 py-2 shadow-sm ${
          isAi
            ? 'border border-indigo-100 bg-indigo-50 text-gray-900'
            : isOwn
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-900'
        } ${isOwn ? 'rounded-br-md' : 'rounded-bl-md'}`}>
          {attachments.length ? <MessageAttachments attachments={attachments} isOwn={isOwn} /> : null}
          {message.text ? (
            <div
              className={`chat-message-html text-sm font-semibold leading-6 ${isOwn ? 'chat-message-html-own' : ''}`}
              dangerouslySetInnerHTML={{ __html: messageHtml }}
            />
          ) : null}
        </div>
        <div className={`chat-reactions-anchor ${isOwn ? 'justify-end' : 'justify-start'}`}>
          <ReactionPills
            message={message}
            currentUserId={currentUserId}
            reactions={reactions}
            onToggleReaction={onToggleReaction}
            onOpenPicker={() => onReactionMessage(reactionsOpen ? '' : message.id)}
          />
          {reactionsOpen ? (
            <div className={`chat-reaction-picker ${preferReactionPickerAbove ? 'chat-reaction-picker-above' : 'chat-reaction-picker-below'} ${isOwn ? 'right-0' : 'left-0'}`}>
              {chatReactions.map((reaction) => (
                <button
                  key={reaction.key}
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-lg hover:bg-gray-50"
                  onClick={() => onToggleReaction(message.id, reaction.key)}
                  aria-label={reaction.label}
                >
                  {reaction.emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {(canEdit || canDelete) ? (
          <div className={`mt-1 flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm"
              onClick={() => onActionMessage(actionsOpen ? '' : message.id)}
              aria-label={`Open actions for ${senderLabel}`}
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {actionsOpen ? (
          <div className={`absolute z-10 mt-1 min-w-36 rounded-xl border border-gray-200 bg-white p-1 shadow-app-lg ${isOwn ? 'right-0' : 'left-0'}`}>
            {canEdit ? (
              <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-gray-700 hover:bg-gray-50" onClick={() => onEdit(message)}>
                <Edit3 className="h-4 w-4" aria-hidden="true" />
                Edit
              </button>
            ) : null}
            {canDelete ? (
              <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-rose-700 hover:bg-rose-50" onClick={() => onDelete(message)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {isOwn ? <MessageAvatar message={message} label={senderLabel} /> : null}
    </div>
  );
}, areMessageBubblePropsEqual);

MessageBubble.displayName = 'MessageBubble';

function areMessageBubblePropsEqual(previous: MessageBubbleProps, next: MessageBubbleProps) {
  return previous.currentUserId === next.currentUserId
    && previous.canModerate === next.canModerate
    && previous.actionsOpen === next.actionsOpen
    && previous.reactionsOpen === next.reactionsOpen
    && previous.preferReactionPickerAbove === next.preferReactionPickerAbove
    && previous.onActionMessage === next.onActionMessage
    && previous.onReactionMessage === next.onReactionMessage
    && previous.onToggleReaction === next.onToggleReaction
    && previous.onEdit === next.onEdit
    && previous.onDelete === next.onDelete
    && areMessagesEquivalent(previous.message, next.message);
}

function areMessagesEquivalent(previous: ChatMessage, next: ChatMessage) {
  return previous === next || (
    previous.id === next.id
    && previous.text === next.text
    && previous.ai === next.ai
    && previous.deleted === next.deleted
    && previous.senderId === next.senderId
    && previous.senderName === next.senderName
    && previous.senderEmail === next.senderEmail
    && previous.senderPhotoUrl === next.senderPhotoUrl
    && previous.aiName === next.aiName
    && normalizeTimestampValue(previous.createdAt) === normalizeTimestampValue(next.createdAt)
    && normalizeTimestampValue(previous.editedAt) === normalizeTimestampValue(next.editedAt)
    && JSON.stringify(getMessageAttachments(previous)) === JSON.stringify(getMessageAttachments(next))
    && JSON.stringify(normalizeChatReactions(previous)) === JSON.stringify(normalizeChatReactions(next))
  );
}

function normalizeTimestampValue(value: unknown) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as any)?.toDate === 'function') {
    const date = (value as any).toDate();
    return date instanceof Date ? date.toISOString() : '';
  }
  if (typeof (value as any)?.seconds === 'number') {
    return `${(value as any).seconds}:${(value as any).nanoseconds || 0}`;
  }
  return String(value);
}

function MessageAvatar({ message, label }: { message: ChatMessage; label: string }) {
  if (message.ai) {
    return <img src="./logo_small.png" alt="" className="h-8 w-8 rounded-full border border-indigo-200 object-cover" />;
  }
  if (message.senderPhotoUrl) {
    return <img src={message.senderPhotoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-black text-gray-600">
      {label.charAt(0).toUpperCase()}
    </div>
  );
}

function InlineAttachmentVideo({ src, label }: { src: string; label: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);

  const armVideoLoad = useCallback(() => {
    setShouldLoadVideo(true);
  }, []);

  return (
    <video
      ref={videoRef}
      controls
      preload={shouldLoadVideo ? 'metadata' : 'none'}
      className="max-h-72 w-full"
      src={shouldLoadVideo ? src : undefined}
      aria-label={label}
      data-chat-attachment-url={src}
      onFocus={armVideoLoad}
      onMouseEnter={armVideoLoad}
      onPlay={armVideoLoad}
      onPointerDown={armVideoLoad}
      onTouchStart={armVideoLoad}
    />
  );
}

function MessageAttachments({ attachments, isOwn }: { attachments: any[]; isOwn: boolean }) {
  return (
    <div className={`mb-2 grid gap-2 ${attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {attachments.map((attachment, index) => {
        const label = attachment.name || (attachment.type === 'video' ? 'Chat video' : 'Chat image');
        if (attachment.type === 'video') {
          return (
            <div key={`${attachment.url}-${index}`} className="overflow-hidden rounded-xl border border-gray-200 bg-black">
              <InlineAttachmentVideo src={attachment.url} label={label} />
              <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block truncate bg-white px-3 py-2 text-xs font-bold text-primary-600">
                {label}
              </a>
            </div>
          );
        }
        return (
          <a key={`${attachment.url}-${index}`} href={attachment.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-gray-200">
            <img
              src={attachment.url}
              alt={label}
              loading="lazy"
              decoding="async"
              className={`max-h-72 w-full object-cover ${isOwn ? 'bg-primary-500' : 'bg-white'}`}
            />
          </a>
        );
      })}
    </div>
  );
}

function ReactionPills({
  message,
  currentUserId,
  reactions,
  onToggleReaction,
  onOpenPicker
}: {
  message: ChatMessage;
  currentUserId: string;
  reactions: Partial<Record<string, string[]>>;
  onToggleReaction: (messageId: string, reactionKey: string) => void;
  onOpenPicker: () => void;
}) {
  const hasReactions = Object.values(reactions).some((users) => users && users.length);
  return (
    <div className="flex flex-wrap gap-1.5">
      {chatReactions.map((reaction) => {
        const users = reactions[reaction.key] || [];
        if (!users.length) return null;
        const active = users.includes(currentUserId);
        return (
          <button
            key={reaction.key}
            type="button"
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-black ${
              active ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'
            }`}
            title={getReactionNames(users, currentUserId)}
            onClick={() => onToggleReaction(message.id, reaction.key)}
          >
            <span>{reaction.emoji}</span>
            <span>{users.length}</span>
          </button>
        );
      })}
      <button
        type="button"
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm ${hasReactions ? '' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
        onClick={onOpenPicker}
        aria-label="Add reaction"
      >
        <Smile className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function AiThinkingBubble() {
  return (
    <div className="flex justify-start gap-2 px-3 pb-4 sm:px-4">
      <img src="./logo_small.png" alt="" className="h-8 w-8 rounded-full border border-indigo-200 object-cover" />
      <div className="max-w-[78%] rounded-2xl rounded-bl-md border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ALL PLAYS is thinking...
        </span>
      </div>
    </div>
  );
}

function Composer({
  teamName,
  text,
  filePreviews,
  sending,
  composerNotice,
  aiThinking,
  voiceListening,
  voiceSupported,
  canModerate,
  canSendTeamEmail,
  audienceSummary,
  onTextChange,
  onSubmit,
  onAttach,
  onRemoveFile,
  onVoice,
  onAudience,
  onTeamEmail,
  onMention
}: {
  teamName: string;
  text: string;
  filePreviews: FilePreview[];
  sending: boolean;
  composerNotice: string;
  aiThinking: boolean;
  voiceListening: boolean;
  voiceSupported: boolean;
  canModerate: boolean;
  canSendTeamEmail: boolean;
  audienceSummary: string;
  onTextChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onAttach: () => void;
  onRemoveFile: (index: number) => void;
  onVoice: () => void;
  onAudience: () => void;
  onTeamEmail: () => void;
  onMention: () => void;
}) {
  const canSend = Boolean(text.trim() || filePreviews.length) && !sending && !aiThinking;
  const showMentionQuickAction = /(^|\s)@\w*$/i.test(text) && !hasAllPlaysMention(text);
  const placeholder = teamName.length > 16 ? 'Message' : `Message ${teamName}`;
  const attachmentSummary = filePreviews.length
    ? `${filePreviews.length} attachment${filePreviews.length === 1 ? '' : 's'} ready`
    : '';
  const notice = composerNotice || attachmentSummary;

  return (
    <form className="chat-composer safe-bottom border border-gray-200 bg-white p-2 shadow-app" onSubmit={onSubmit}>
      {filePreviews.length ? (
        <div className="chat-attachment-strip">
          {filePreviews.map((preview, index) => (
            <div key={preview.url} className="relative h-12 w-12 flex-none overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
              {preview.file.type.startsWith('video/') ? (
                <video src={preview.url} className="h-full w-full object-cover" muted playsInline />
              ) : (
                <img src={preview.url} alt="" className="h-full w-full object-cover" />
              )}
              <button type="button" className="absolute right-1 top-1 rounded-full bg-gray-950/70 p-1 text-white" onClick={() => onRemoveFile(index)} aria-label="Remove attachment">
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {showMentionQuickAction ? (
        <button type="button" className="mb-2 flex w-full items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-left text-sm font-black text-indigo-700" onMouseDown={(event) => event.preventDefault()} onClick={onMention}>
          <Bot className="h-4 w-4" aria-hidden="true" />
          @ALL PLAYS
        </button>
      ) : null}

      <div className="chat-composer-input-shell">
        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          rows={1}
          maxLength={2000}
          className="chat-composer-textarea"
          placeholder={placeholder}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button type="submit" className="chat-composer-send primary-button" disabled={!canSend} aria-label="Send message">
          {sending || aiThinking ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      {notice ? (
        <div className="chat-composer-notice" aria-live="polite">
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />}
          <span className="truncate">{notice}</span>
        </div>
      ) : null}

      <div className="chat-composer-toolbar">
        <button type="button" className="chat-tool-button" onClick={onAttach} aria-label="Add attachment">
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </button>
        {voiceSupported ? (
          <button
            type="button"
            className={`chat-tool-button ${voiceListening ? 'chat-tool-button-active' : ''}`}
            onClick={onVoice}
            aria-label={voiceListening ? 'Stop voice input' : 'Voice to text'}
          >
            <Mic className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        {canModerate ? (
          <button type="button" className="chat-audience-pill" onClick={onAudience}>
            <Users className="h-4 w-4 flex-none" aria-hidden="true" />
            <span className="truncate">Audience: {audienceSummary}</span>
          </button>
        ) : null}
        {canSendTeamEmail ? (
          <button type="button" className="chat-audience-pill" onClick={onTeamEmail} aria-label="Open Team Email">
            <Mail className="h-4 w-4 flex-none" aria-hidden="true" />
            <span className="truncate">Team Email</span>
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ConversationSheet({
  conversations,
  team,
  selectedConversationId,
  onSelect,
  onClose
}: {
  conversations: ChatConversation[];
  team: Record<string, any>;
  selectedConversationId: string;
  onSelect: (conversationId: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Conversations" onClose={onClose}>
      <div className="space-y-2">
        {conversations.map((conversation) => {
          const active = conversation.id === selectedConversationId;
          const typeLabel = conversation.type === 'direct' ? 'Direct' : conversation.type === 'group' ? 'Group' : 'Team';
          return (
            <button
              key={conversation.id}
              type="button"
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${
                active ? 'border-primary-200 bg-primary-50' : 'border-gray-200 bg-white'
              }`}
              onClick={() => onSelect(conversation.id)}
            >
              <MessageCircle className={`h-5 w-5 flex-none ${active ? 'text-primary-600' : 'text-gray-400'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black text-gray-950">{getConversationDisplayName(conversation, team)}</span>
                <span className="mt-0.5 block text-xs font-bold text-gray-500">{typeLabel} conversation</span>
              </span>
              {active ? <Check className="h-5 w-5 flex-none text-primary-600" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

function AudienceSheet({
  selectedTarget,
  selectedRecipientIds,
  recipientOptions,
  recipientOptionsLoading,
  recipientOptionsError,
  onTargetChange,
  onRecipientsChange,
  onRetryRecipientOptions,
  onClose
}: {
  selectedTarget: ChatTargetType;
  selectedRecipientIds: string[];
  recipientOptions: ChatRecipientOption[];
  recipientOptionsLoading: boolean;
  recipientOptionsError: string | null;
  onTargetChange: (target: ChatTargetType) => void;
  onRecipientsChange: (ids: string[]) => void;
  onRetryRecipientOptions: () => void;
  onClose: () => void;
}) {
  const toggleRecipient = (recipientId: string) => {
    onRecipientsChange(
      selectedRecipientIds.includes(recipientId)
        ? selectedRecipientIds.filter((id) => id !== recipientId)
        : [...selectedRecipientIds, recipientId]
    );
  };
  const needsSelectedRecipient = selectedTarget === 'individuals' && selectedRecipientIds.length === 0;

  return (
    <Sheet title="Message audience" onClose={onClose}>
      <div className="space-y-2">
        {allTargetOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${
              selectedTarget === option.value ? 'border-primary-200 bg-primary-50' : 'border-gray-200 bg-white'
            }`}
            onClick={() => onTargetChange(option.value)}
          >
            <span className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border ${
              selectedTarget === option.value ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300'
            }`}>
              {selectedTarget === option.value ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </span>
            <span>
              <span className="block text-sm font-black text-gray-950">{option.label}</span>
              <span className="mt-0.5 block text-xs font-semibold leading-5 text-gray-500">{option.description}</span>
            </span>
          </button>
        ))}
      </div>

      {selectedTarget === 'individuals' ? (
        <>
          <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-gray-200">
            {recipientOptionsLoading ? (
              <div className="p-3 text-sm font-semibold text-gray-500">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
                Loading recipient options...
              </div>
            ) : recipientOptionsError ? (
              <div className="p-3 text-sm font-semibold text-rose-700">
                <div>{recipientOptionsError}</div>
                <button type="button" className="ghost-button mt-3 !h-8 !min-h-8 !px-2 text-xs" onClick={onRetryRecipientOptions}>
                  Retry recipient load
                </button>
              </div>
            ) : recipientOptions.length ? recipientOptions.map((option) => (
              <label key={option.id} className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600"
                  checked={selectedRecipientIds.includes(option.id)}
                  onChange={() => toggleRecipient(option.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-gray-800">{option.name}</span>
                  {option.detail ? <span className="block truncate text-xs font-semibold text-gray-500">{option.detail}</span> : null}
                </span>
              </label>
            )) : (
              <div className="p-3 text-sm font-semibold text-gray-500">No roster or community members are available yet.</div>
            )}
          </div>
          {needsSelectedRecipient && !recipientOptionsLoading && !recipientOptionsError ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
              Choose at least one selected member, or switch back to Full team.
            </div>
          ) : null}
        </>
      ) : null}

      <button type="button" className="primary-button mt-4 w-full" onClick={onClose} disabled={needsSelectedRecipient || recipientOptionsLoading}>Done</button>
    </Sheet>
  );
}

function AttachSheet({
  onPhoto,
  onVideo,
  onLink,
  onMention,
  onClose
}: {
  onPhoto: () => void;
  onVideo: () => void;
  onLink: () => void;
  onMention: () => void;
  onClose: () => void;
}) {
  const actions = [
    {
      label: 'Photo',
      description: 'Choose one or more images.',
      icon: Camera,
      tone: 'text-primary-600',
      onClick: onPhoto
    },
    {
      label: 'Video',
      description: 'Attach a short clip.',
      icon: Video,
      tone: 'text-rose-600',
      onClick: onVideo
    },
    {
      label: 'Link',
      description: 'Add a URL to the message.',
      icon: Link2,
      tone: 'text-sky-600',
      onClick: onLink
    },
    {
      label: '@ALL PLAYS',
      description: 'Ask the team assistant.',
      icon: Bot,
      tone: 'text-indigo-600',
      onClick: onMention
    }
  ];

  return (
    <Sheet title="Add to message" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              className="rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-primary-200 hover:bg-primary-50"
              onClick={() => {
                action.onClick();
                if (action.label !== 'Link') {
                  onClose();
                }
              }}
            >
              <Icon className={`h-6 w-6 ${action.tone}`} aria-hidden="true" />
              <div className="mt-2 text-sm font-black text-gray-950">{action.label}</div>
              <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">{action.description}</div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold leading-5 text-gray-500">
        Photos and videos can be up to 5MB each. Links are added to the message and become clickable after sending.
      </div>
    </Sheet>
  );
}

function LinkSheet({
  value,
  onChange,
  onAdd,
  onClose
}: {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Add link" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAdd();
        }}
      >
        <label className="block">
          <span className="app-label">URL</span>
          <input
            autoFocus
            type="text"
            inputMode="url"
            className="auth-input mt-2"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://example.com"
          />
        </label>
        <div className="mt-4 flex gap-2">
          <button type="button" className="ghost-button flex-1 justify-center" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button flex-1 justify-center">Add link</button>
        </div>
      </form>
    </Sheet>
  );
}

function MediaGallerySheet({
  mediaEntries,
  onClose,
  onStatus
}: {
  mediaEntries: any[];
  onClose: () => void;
  onStatus: (status: ChatStatus | null) => void;
}) {
  const copyLink = async (entry: any) => {
    try {
      await navigator.clipboard.writeText(entry.url);
      onStatus({ tone: 'success', message: 'Media link copied.' });
    } catch {
      onStatus({ tone: 'error', message: 'Unable to copy media link.' });
    }
  };

  const shareEntry = async (entry: any) => {
    const details = buildChatMediaShareDetails(entry);
    const result = await sharePublicUrl({
      title: details.title,
      text: details.text,
      url: details.url
    });
    if (result === 'shared') onStatus({ tone: 'success', message: 'Share sheet opened.' });
    if (result === 'copied') onStatus({ tone: 'success', message: 'Share unavailable here. Link copied instead.' });
    if (result === 'failed') onStatus({ tone: 'error', message: 'Sharing is unavailable in this browser.' });
  };

  const downloadEntry = (entry: any) => {
    const link = document.createElement('a');
    link.href = entry.url;
    link.download = getChatMediaDownloadName(entry);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <Sheet title="Photos & videos" onClose={onClose} wide>
      {mediaEntries.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {mediaEntries.map((entry, index) => (
            <article key={`${entry.url}-${index}`} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              {entry.type === 'video' ? (
                <video controls preload="metadata" className="aspect-video w-full bg-black object-cover" src={entry.url} />
              ) : (
                <a href={entry.url} target="_blank" rel="noopener noreferrer">
                  <img src={entry.url} alt={entry.name || 'Chat media'} className="aspect-video w-full object-cover" />
                </a>
              )}
              <div className="p-3">
                <div className="truncate text-sm font-black text-gray-900">{entry.name || (entry.type === 'video' ? 'Video' : 'Photo')}</div>
                <div className="mt-1 truncate text-xs font-semibold text-gray-500">{entry.senderName || 'Unknown'}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="secondary-button !h-8 !min-h-8 !px-2 !text-xs" onClick={() => shareEntry(entry)}>
                    <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Share
                  </button>
                  <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={() => downloadEntry(entry)}>
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Save
                  </button>
                  <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 !text-xs" onClick={() => copyLink(entry)}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copy
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center text-sm font-semibold text-gray-500">
          No media shared yet.
        </div>
      )}
    </Sheet>
  );
}

function EditMessageModal({
  value,
  onChange,
  onCancel,
  onSave
}: {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Edit message">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-app-lg">
        <div className="text-lg font-black text-gray-950">Edit message</div>
        <textarea
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          maxLength={2000}
          className="mt-3 w-full resize-none rounded-xl border border-gray-200 p-3 text-base font-semibold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary-button" onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Sheet({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-gray-950/40 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`safe-bottom max-h-[88vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-app-lg sm:rounded-2xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="text-base font-black text-gray-950">{title}</div>
          <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0" onClick={onClose} aria-label={`Close ${title}`}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[calc(88vh-64px)] overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
