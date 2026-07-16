import { ChangeEvent, FormEvent, Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive,
  BellOff,
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
  MoreVertical,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smile,
  Trash2,
  Video,
  X
} from 'lucide-react';
import {
  deleteTeamChatMessage,
  editTeamChatMessage,
  ensureStaffChatConversation,
  loadChatRecipientOptions,
  markTeamChatRead,
  muteTeamChat,
  unmuteTeamChat,
  sendTeamChatMessage,
  toggleTeamChatReaction,
  type ChatAttachment,
  type ChatConversation,
  type ChatMessage,
  type ChatTeam
} from '../../../lib/chatService';
import { AvatarImage } from '../../../components/AvatarImage';
import { MessagesPageSkeleton } from '../../../components/PageSkeletons';
import {
  DEFAULT_TEAM_CONVERSATION_ID,
  MAX_CHAT_MEDIA_SIZE,
  buildChatAudienceMetadata,
  buildChatMentionSuggestions,
  buildChatViewportSignature,
  buildChatMediaShareDetails,
  chatReactions,
  collectThreadMedia,
  extractAllPlaysQuestion,
  formatChatDay,
  formatChatMessageHtml,
  formatChatTime,
  getAudienceSummaryText,
  getChatMediaDownloadName,
  getChatMentionInsertion,
  getConversationDisplayName,
  getMessageAttachments,
  getMessageSenderLabel,
  getReactionNames,
  hasChatMentionTrigger,
  hasAllPlaysMention,
  insertChatMention,
  isChatComposerLinkSafe,
  isDefaultTeamConversation,
  isStaffConversation,
  isSafeChatMediaUrl,
  mergeChatMessageLists,
  normalizeChatReactions,
  shouldRetryChatLastReadOnViewReturn,
  shouldUpdateChatLastRead,
  type ChatMentionSuggestion,
  type ChatRecipientOption,
  type ChatAudienceMetadata,
  type ChatTargetType
} from '../../../lib/chatLogic';
import { APP_BACK_DISMISS_EVENT } from '../../../lib/nativeBackButton';
import { sharePublicUrl } from '../../../lib/publicActions';
import { useShellLayout } from '../../../lib/useShellLayout';
import { useViewLoadTimer } from '../../../lib/viewLoadTiming';
import type { AuthState } from '../../../lib/types';
import { voiceRecognition, type VoiceListenerHandle } from '../../../lib/voiceService';
import { startInteractionTimer, UX_TIMING } from '../../../lib/uxTiming';
import type { sendAllPlaysChatAnswer } from '../../../lib/chatAiService';
import { useChatSheets } from '../hooks/useChatSheets';
import { useChatTeam } from '../hooks/useChatTeam';
import { getChatMessagesErrorMessage, useChatMessages } from '../hooks/useChatMessages';
import { Composer } from './ChatComposer';

const LazyTeamEmailSheet = lazy(() => import('./TeamEmailSheet'));

type StatusTone = 'neutral' | 'success' | 'error';

type ChatStatus = {
  tone: StatusTone;
  message: string;
};

type FilePreview = {
  file: File;
  url: string;
};

type ChatComposerDraft = {
  text: string;
  filePreviews: FilePreview[];
  selectedRecipientTarget: ChatTargetType;
  selectedRecipientIds: string[];
};

type OptimisticChatMessage = ChatMessage & {
  clientMessageId: string;
  sendStatus: 'pending' | 'failed';
  sendError?: string | null;
  attachmentCount?: number;
};

type PendingChatSendRequest = {
  clientMessageId: string;
  text: string;
  files: File[];
  attachmentCount: number;
  user: NonNullable<AuthState['user']>;
  profile: Record<string, any>;
  team: Record<string, any>;
  selectedConversation: ChatConversation | null;
  selectedConversationId: string;
  selectedRecipientTarget: ChatTargetType;
  selectedRecipientIds: string[];
  interaction?: ReturnType<typeof startInteractionTimer>;
};

type VirtualizedChatWindow = {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  visibleMessages: ChatMessage[];
};

type VirtualizedChatLayout = {
  offsets: number[];
  totalHeight: number;
};

type SafeChatAttachment = ChatAttachment & {
  url: string;
};

const CHAT_MESSAGE_INITIAL_WINDOW_COUNT = 40;
const CHAT_MESSAGE_WINDOW_OVERSCAN_PX = 480;
const CHAT_MESSAGE_BASE_ESTIMATED_HEIGHT = 104;
const CHAT_MESSAGE_DAY_DIVIDER_ESTIMATED_HEIGHT = 28;
const CHAT_MESSAGE_ATTACHMENT_ESTIMATED_HEIGHT = 144;
const messageRevisionSignatureCache = new WeakMap<ChatMessage, string>();

const allTargetOptions: Array<{ value: ChatTargetType; label: string; description: string }> = [
  { value: 'full_team', label: 'Full team', description: 'Visible to everyone in this team chat.' },
  { value: 'individuals', label: 'Selected members', description: 'Starts a direct or group conversation.' }
];
const STAFF_CONVERSATION_PLACEHOLDER_ID = '__staff_conversation__';
const CANONICAL_STAFF_CONVERSATION_ID = 'group_role%3Astaff';

function isStaffOnlyConversation(conversation?: ChatConversation | null) {
  return conversation?.id === CANONICAL_STAFF_CONVERSATION_ID && isStaffConversation(conversation);
}

function getStaffConversationErrorMessage(error: unknown) {
  const safeMessage = getChatMessagesErrorMessage(error);
  const rawMessage = error instanceof Error ? error.message.trim() : '';
  return rawMessage && safeMessage === rawMessage
    ? 'Unable to open staff chat. Please try again.'
    : safeMessage;
}

export async function sendLazyAllPlaysChatAnswer(input: Parameters<typeof sendAllPlaysChatAnswer>[0]) {
  const chatAiService = await import('../../../lib/chatAiService');
  return chatAiService.sendAllPlaysChatAnswer(input);
}

function createChatClientMessageId(userId: string) {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `client_${userId}_${Date.now()}_${randomPart}`
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 120);
}

function getChatSendErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Failed to send message. Tap retry to try again.';
}

function startPendingChatSendInteraction(request: Pick<PendingChatSendRequest, 'attachmentCount' | 'selectedRecipientTarget'>) {
  return startInteractionTimer(UX_TIMING.chatSend, {
    attachments: request.attachmentCount,
    target: request.selectedRecipientTarget
  });
}

function createOptimisticChatMessage(request: PendingChatSendRequest): OptimisticChatMessage {
  return {
    id: request.clientMessageId,
    clientMessageId: request.clientMessageId,
    text: request.text,
    senderId: request.user.uid,
    senderName: request.profile.fullName || request.user.displayName || 'You',
    senderEmail: request.user.email || null,
    senderPhotoUrl: request.profile.photoUrl || request.user.photoUrl || null,
    attachments: [],
    createdAt: new Date(),
    editedAt: null,
    deleted: false,
    reactions: {},
    targetType: request.selectedRecipientTarget,
    recipientIds: request.selectedRecipientTarget === 'individuals' ? request.selectedRecipientIds : [],
    targetRole: request.selectedRecipientTarget === 'staff' ? 'staff' : null,
    conversationId: isDefaultTeamConversation(request.selectedConversationId) ? null : request.selectedConversationId,
    sendStatus: 'pending',
    sendError: null,
    attachmentCount: request.attachmentCount
  };
}

function getMessageConversationId(message: Pick<ChatMessage, 'conversationId'>) {
  return normalizeConversationId(message.conversationId);
}

function toStoredMessageConversationId(conversationId: string) {
  return isDefaultTeamConversation(conversationId) ? null : conversationId;
}

export function mergeVisibleChatMessages(liveMessages: ChatMessage[], optimisticMessages: OptimisticChatMessage[], selectedConversationId: string) {
  const activeConversationId = normalizeConversationId(selectedConversationId);
  const liveClientIds = new Set(liveMessages.map((message) => String(message.clientMessageId || message.id || '')).filter(Boolean));
  const pendingOnly = optimisticMessages.filter((message) => (
    getMessageConversationId(message) === activeConversationId &&
    !liveClientIds.has(message.clientMessageId || message.id)
  ));
  return mergeChatMessageLists(pendingOnly, liveMessages) as ChatMessage[];
}

export function normalizeConversationId(conversationId: string | null | undefined) {
  return String(conversationId || '').trim() || DEFAULT_TEAM_CONVERSATION_ID;
}

export function getChatComposerDraftKey(teamId: string, conversationId: string | null | undefined) {
  return `${encodeURIComponent(String(teamId || '').trim())}|${encodeURIComponent(normalizeConversationId(conversationId))}`;
}

export function isSelectedConversation(conversationId: string, selectedConversationId: string) {
  return conversationId === selectedConversationId;
}

export function TeamAvatar({ team }: { team: Pick<ChatTeam, 'name' | 'photoUrl' | 'unreadCount'> }) {
  return (
    <div className="relative flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-primary-50 text-primary-700 shadow-sm">
      {team.photoUrl ? (
        <AvatarImage
          src={team.photoUrl}
          alt={`${team.name} team photo`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          fallback={<span className="text-base font-black">{team.name.charAt(0).toUpperCase()}</span>}
        />
      ) : (
        <span className="text-base font-black">{team.name.charAt(0).toUpperCase()}</span>
      )}
      {team.unreadCount > 0 ? <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-600" /> : null}
    </div>
  );
}

export function ChatWindow({
  auth,
  teamId,
  inboxTeam,
  preferredConversationId = '',
  onInboxMuteChange,
  embedded = false
}: {
  auth: AuthState;
  teamId: string;
  inboxTeam?: ChatTeam;
  preferredConversationId?: string;
  onInboxMuteChange?: (conversationId: string, isMuted: boolean) => void;
  embedded?: boolean;
}) {
  const navigate = useNavigate();
  const { isDesktopWeb } = useShellLayout();
  const [recipientOptions, setRecipientOptions] = useState<ChatRecipientOption[]>([]);
  const [recipientOptionsLoading, setRecipientOptionsLoading] = useState(false);
  const [recipientOptionsLoaded, setRecipientOptionsLoaded] = useState(false);
  const [recipientOptionsError, setRecipientOptionsError] = useState<string | null>(null);
  const [selectedRecipientTarget, setSelectedRecipientTarget] = useState<ChatTargetType>('full_team');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [composerNotice, setComposerNotice] = useState('');
  const [text, setText] = useState('');
  const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]);
  const [pendingSendCount, setPendingSendCount] = useState(0);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticChatMessage[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(() => voiceRecognition.isNativeRuntime() || voiceRecognition.hasBrowserSupport());
  const [teamEmailSheetRequested, setTeamEmailSheetRequested] = useState(false);
  const {
    showConversationSheet,
    showAudienceSheet,
    showMediaGallery,
    showAttachSheet,
    showLinkSheet,
    showEmailSheet,
    openConversationSheet,
    closeConversationSheet,
    openAudienceSheet,
    closeAudienceSheet,
    openMediaGallery,
    closeMediaGallery,
    openAttachSheet,
    closeAttachSheet,
    openLinkSheet,
    closeLinkSheet,
    openEmailSheet: openTeamEmailSheet,
    closeEmailSheet: closeTeamEmailSheet
  } = useChatSheets();
  const [linkDraft, setLinkDraft] = useState('');
  const [reactionMessageId, setReactionMessageId] = useState('');
  const [actionMessageId, setActionMessageId] = useState('');
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState('');
  const [isMuted, setIsMuted] = useState(() => resolveMutedState(teamId, DEFAULT_TEAM_CONVERSATION_ID, inboxTeam, {}));
  const [composerCursorPosition, setComposerCursorPosition] = useState<number | undefined>(undefined);
  const [messageViewportState, setMessageViewportState] = useState({ scrollTop: 0, viewportHeight: 0 });
  const [measuredMessageHeights, setMeasuredMessageHeights] = useState<Record<string, number>>({});
  const [staffRepairState, setStaffRepairState] = useState<{
    key: string;
    status: 'idle' | 'repairing' | 'ready' | 'error';
    error: string | null;
  }>({ key: '', status: 'idle', error: null });
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
  const pendingScrollRef = useRef(false);
  const stickToLatestRef = useRef(true);
  const recipientOptionsPromiseRef = useRef<Promise<ChatRecipientOption[]> | null>(null);
  const recipientOptionsRequestIdRef = useRef(0);
  const currentTeamIdRef = useRef(teamId);
  const programmaticScrollRef = useRef(false);
  const mountedRef = useRef(true);
  const scheduledViewportFrameRef = useRef<number | null>(null);
  const scheduledScrollFrameRef = useRef<number | null>(null);
  const scheduledScrollBehaviorRef = useRef<ScrollBehavior>('auto');
  const scheduledScrollForceRef = useRef(false);
  const scheduledScrollTimeoutsRef = useRef<number[]>([]);
  const lastObservedViewportSignatureRef = useRef('');
  const olderLoadAnchorRef = useRef<{ previousScrollHeight: number; previousScrollTop: number } | null>(null);
  const pendingSendRequestsRef = useRef(new Map<string, PendingChatSendRequest>());
  const sendQueueRef = useRef(Promise.resolve());
  const composerDraftsRef = useRef(new Map<string, ChatComposerDraft>());

  const resetChatSelectionState = useCallback(() => {
    setStatus(null);
    setStaffRepairState({ key: '', status: 'idle', error: null });
    recipientOptionsPromiseRef.current = null;
    recipientOptionsRequestIdRef.current += 1;
    setRecipientOptions([]);
    setRecipientOptionsLoading(false);
    setRecipientOptionsLoaded(false);
    setRecipientOptionsError(null);
    pendingScrollRef.current = true;
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  const {
    team,
    profile,
    canModerate,
    conversations,
    setConversations,
    selectedConversationId,
    setSelectedConversationId,
    loadingContext,
    error: teamError,
    reloadConversations,
    switchConversation: switchChatConversation
  } = useChatTeam({
    teamId,
    user: auth.user,
    inboxTeam,
    preferredConversationId,
    onTeamReset: resetChatSelectionState
  });
  const effectiveConversationId = normalizeConversationId(selectedConversationId);
  const activeComposerDraftKey = getChatComposerDraftKey(teamId, effectiveConversationId);
  const activeComposerDraftKeyRef = useRef(activeComposerDraftKey);
  const latestComposerDraftRef = useRef<ChatComposerDraft>({
    text,
    filePreviews,
    selectedRecipientTarget,
    selectedRecipientIds
  });
  latestComposerDraftRef.current = {
    text,
    filePreviews,
    selectedRecipientTarget,
    selectedRecipientIds
  };
  const activeConversationForRepair = conversations.find((conversation) => conversation.id === effectiveConversationId) || null;
  const activeConversationIsStaff = effectiveConversationId === CANONICAL_STAFF_CONVERSATION_ID
    || isStaffOnlyConversation(activeConversationForRepair);
  const activeStaffRepairKey = `${teamId}:${effectiveConversationId}`;
  const activeStaffRepairError = activeConversationIsStaff
    && staffRepairState.key === activeStaffRepairKey
    && staffRepairState.status === 'error'
    ? staffRepairState.error
    : null;
  const staffConversationReady = !activeConversationIsStaff || (
    staffRepairState.key === activeStaffRepairKey && staffRepairState.status === 'ready'
  );

  const repairStaffConversation = useCallback(async (requestedConversationId = CANONICAL_STAFF_CONVERSATION_ID) => {
    if (!auth.user || !team) return null;
    const requestedKey = `${teamId}:${requestedConversationId}`;
    setStatus(null);
    setStaffRepairState({ key: requestedKey, status: 'repairing', error: null });
    try {
      const staffConversation = await ensureStaffChatConversation(teamId, auth.user, conversations);
      setConversations((current) => {
        const withoutLegacyStaffConversations = current.filter((conversation) => (
          !isStaffOnlyConversation(conversation) || conversation.id === staffConversation.id
        ));
        return withoutLegacyStaffConversations.some((conversation) => conversation.id === staffConversation.id)
          ? withoutLegacyStaffConversations.map((conversation) => conversation.id === staffConversation.id ? staffConversation : conversation)
          : [...withoutLegacyStaffConversations, staffConversation];
      });
      setStaffRepairState({
        key: `${teamId}:${staffConversation.id}`,
        status: 'ready',
        error: null
      });
      return staffConversation;
    } catch (error) {
      const errorMessage = getStaffConversationErrorMessage(error);
      setStaffRepairState({
        key: requestedKey,
        status: 'error',
        error: errorMessage
      });
      setStatus({ tone: 'error', message: errorMessage });
      return null;
    }
  }, [auth.user, conversations, setConversations, team, teamId]);

  useEffect(() => {
    if (!activeConversationIsStaff || loadingContext || !auth.user || !team) return;
    if (staffRepairState.key === activeStaffRepairKey && (
      staffRepairState.status === 'repairing' || staffRepairState.status === 'ready' || staffRepairState.status === 'error'
    )) return;
    void repairStaffConversation(effectiveConversationId).then((staffConversation) => {
      if (staffConversation && staffConversation.id !== effectiveConversationId) {
        switchChatConversation(staffConversation.id);
      }
    });
  }, [activeConversationIsStaff, activeStaffRepairKey, auth.user, effectiveConversationId, loadingContext, repairStaffConversation, staffRepairState.key, staffRepairState.status, switchChatConversation, team]);

  const handleBeforeLiveUpdate = useCallback(() => isNearBottom(messagesRef.current), []);
  const handleLiveUpdateState = useCallback(({ isInitialSnapshot, wasNearBottom }: { isInitialSnapshot: boolean; wasNearBottom: boolean }) => {
    if (isInitialSnapshot || pendingScrollRef.current || wasNearBottom) {
      pendingScrollRef.current = true;
      stickToLatestRef.current = true;
      setShowJumpToLatest(false);
    } else {
      stickToLatestRef.current = false;
      setShowJumpToLatest(true);
    }
  }, []);
  const handleMessagesReset = useCallback(() => {
    pendingScrollRef.current = true;
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
  }, []);
  const handleMarkRead = useCallback(() => {
    maybeMarkRead(auth.user, teamId, true, effectiveConversationId);
  }, [auth.user, effectiveConversationId, teamId]);

  const {
    messages,
    olderMessages,
    hasMoreMessages,
    loadingMessages,
    loadingOlder,
    error: messagesError,
    retryMessages,
    loadOlderMessages: loadOlderChatMessages,
    initialSnapshotLoadedRef
  } = useChatMessages({
    teamId,
    team,
    user: auth.user,
    selectedConversationId: effectiveConversationId,
    enabled: !loadingContext && staffConversationReady,
    onBeforeLiveUpdate: handleBeforeLiveUpdate,
    onLiveUpdateState: handleLiveUpdateState,
    onMessagesReset: handleMessagesReset,
    onMarkRead: handleMarkRead
  });
  useViewLoadTimer({
    viewName: 'messages choose team',
    route: `/messages/${teamId}`,
    ready: Boolean(team && !loadingContext && !loadingMessages),
    resetKey: `${auth.user?.uid || 'anonymous'}:${teamId}:${effectiveConversationId}`,
    disabled: !auth.user || !teamId,
    getBaseMeta: () => ({
      page: 'messages',
      teamId,
      conversationId: effectiveConversationId,
      embedded
    }),
    getCompleteMeta: () => ({
      messageCount: messages.length,
      conversationCount: conversations.length,
      unreadCount: inboxTeam?.unreadCount || 0,
      canModerate,
      embedded,
      error: teamError || messagesError || undefined
    })
  });
  const sending = pendingSendCount > 0;
  const visibleMessages = useMemo(
    () => mergeVisibleChatMessages(messages, optimisticMessages, effectiveConversationId),
    [effectiveConversationId, messages, optimisticMessages]
  );
  const messageLayout = useMemo(() => buildVirtualizedChatLayout(visibleMessages, measuredMessageHeights), [measuredMessageHeights, visibleMessages]);
  const messageWindow = useMemo(() => buildVirtualizedChatWindowFromLayout(visibleMessages, messageLayout, {
    scrollTop: messageViewportState.scrollTop,
    viewportHeight: messageViewportState.viewportHeight,
    preferTopWindow: olderMessages.length > 0 && messageViewportState.scrollTop <= 0
  }), [messageLayout, messageViewportState.scrollTop, messageViewportState.viewportHeight, olderMessages.length, visibleMessages]);
  const error = teamError || activeStaffRepairError || messagesError;
  const canRetryMessagesError = Boolean((activeStaffRepairError || messagesError) && !teamError);

  const handleMessageRowHeightChange = useCallback((messageId: string, height: number) => {
    if (!messageId || !Number.isFinite(height) || height <= 0) return;
    setMeasuredMessageHeights((current) => current[messageId] === height ? current : { ...current, [messageId]: height });
  }, []);

  useEffect(() => {
    const liveClientIds = new Set(messages.map((message) => String(message.clientMessageId || message.id || '')).filter(Boolean));
    if (!liveClientIds.size) return;
    const confirmedClientIds = optimisticMessages
      .map((message) => message.clientMessageId || message.id)
      .filter((id) => liveClientIds.has(id));
    if (!confirmedClientIds.length) return;
    setOptimisticMessages((current) => current.filter((message) => {
      return !liveClientIds.has(message.clientMessageId || message.id);
    }));
    confirmedClientIds.forEach((id) => {
      pendingSendRequestsRef.current.get(id)?.interaction?.end({ status: 'visible_sent' });
      pendingSendRequestsRef.current.delete(id);
    });
  }, [messages, optimisticMessages]);

  const selectedConversation = useMemo(() => (
    conversations.find((conversation) => conversation.id === effectiveConversationId) || conversations[0] || null
  ), [conversations, effectiveConversationId]);
  const conversationSheetConversations = useMemo<ChatConversation[]>(() => {
    if (!canModerate || conversations.some((conversation) => isStaffOnlyConversation(conversation))) {
      return conversations;
    }
    const staffPlaceholderConversation = {
      id: STAFF_CONVERSATION_PLACEHOLDER_ID,
      type: 'group',
      name: 'Staff only',
      participantIds: [],
      participantRoles: ['staff']
    } satisfies ChatConversation;
    return [...conversations, staffPlaceholderConversation];
  }, [canModerate, conversations]);
  const audienceMetadata = useMemo(() => buildChatAudienceMetadata({
    selectedConversation,
    selectedConversationId: effectiveConversationId,
    selectedRecipientTarget,
    selectedRecipientIds
  }), [effectiveConversationId, selectedConversation, selectedRecipientIds, selectedRecipientTarget]);
  const audienceSummary = useMemo(() => getAudienceSummaryText(audienceMetadata, recipientOptions), [audienceMetadata, recipientOptions]);
  const mentionSuggestions = useMemo(
    () => buildChatMentionSuggestions(recipientOptions, text, 5, composerCursorPosition),
    [composerCursorPosition, recipientOptions, text]
  );
  const mentionTriggerActive = hasChatMentionTrigger(text, composerCursorPosition);
  const mediaEntries = useMemo(() => collectThreadMedia(visibleMessages), [visibleMessages]);
  const teamName = team?.name || inboxTeam?.name || 'Team chat';
  const composerDisabled = showConversationSheet
    || showAudienceSheet
    || showMediaGallery
    || showAttachSheet
    || showLinkSheet
    || showEmailSheet
    || Boolean(editingMessage);

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

  useEffect(() => {
    if (!mentionTriggerActive) return;
    void ensureRecipientOptionsLoaded().catch(() => undefined);
  }, [ensureRecipientOptionsLoaded, mentionTriggerActive]);

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

  const syncMessageViewportState = useCallback((container: HTMLDivElement | null) => {
    if (!container) return;
    setMessageViewportState((current) => (
      current.scrollTop === container.scrollTop && current.viewportHeight === container.clientHeight
        ? current
        : { scrollTop: container.scrollTop, viewportHeight: container.clientHeight }
    ));
  }, []);

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
    syncMessageViewportState(container);
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior });
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
    window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 80);
  }, [syncMessageViewportState]);

  const clearScheduledScrollTimeouts = useCallback(() => {
    scheduledScrollTimeoutsRef.current.forEach((timerId) => window.clearTimeout(timerId));
    scheduledScrollTimeoutsRef.current = [];
  }, []);

  const scheduleMessageViewportStateUpdate = useCallback((immediate = false) => {
    const container = messagesRef.current;
    if (!container) return;
    if (immediate || typeof window.requestAnimationFrame !== 'function') {
      if (scheduledViewportFrameRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(scheduledViewportFrameRef.current);
      }
      scheduledViewportFrameRef.current = null;
      syncMessageViewportState(container);
      return;
    }
    if (scheduledViewportFrameRef.current !== null) return;
    scheduledViewportFrameRef.current = window.requestAnimationFrame(() => {
      scheduledViewportFrameRef.current = null;
      syncMessageViewportState(messagesRef.current);
    });
  }, [syncMessageViewportState]);

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

  useLayoutEffect(() => {
    if (activeComposerDraftKeyRef.current === activeComposerDraftKey) return;
    composerDraftsRef.current.set(activeComposerDraftKeyRef.current, {
      ...latestComposerDraftRef.current,
      filePreviews: [...latestComposerDraftRef.current.filePreviews],
      selectedRecipientIds: [...latestComposerDraftRef.current.selectedRecipientIds]
    });
    const nextDraft = composerDraftsRef.current.get(activeComposerDraftKey) || {
      text: '',
      filePreviews: [],
      selectedRecipientTarget: 'full_team' as ChatTargetType,
      selectedRecipientIds: []
    };
    activeComposerDraftKeyRef.current = activeComposerDraftKey;
    latestComposerDraftRef.current = nextDraft;
    setText(nextDraft.text);
    setFilePreviews([...nextDraft.filePreviews]);
    setSelectedRecipientTarget(nextDraft.selectedRecipientTarget);
    setSelectedRecipientIds([...nextDraft.selectedRecipientIds]);
    setComposerCursorPosition(undefined);
  }, [activeComposerDraftKey]);

  useEffect(() => {
    setMeasuredMessageHeights({});
    setMessageViewportState({ scrollTop: 0, viewportHeight: 0 });
    olderLoadAnchorRef.current = null;
  }, [effectiveConversationId]);

  useEffect(() => {
    setIsMuted(resolveMutedState(teamId, effectiveConversationId, inboxTeam, profile));
  }, [effectiveConversationId, inboxTeam, profile, teamId]);

  useLayoutEffect(() => {
    if (!pendingScrollRef.current) return;
    scrollToLatest('auto');
    pendingScrollRef.current = false;
    scheduleScrollToLatest('auto');
  }, [visibleMessages.length, aiThinking, scheduleScrollToLatest, scrollToLatest, selectedConversationId]);

  useLayoutEffect(() => {
    const anchor = olderLoadAnchorRef.current;
    if (!anchor || loadingOlder) return;
    const container = messagesRef.current;
    if (!container) {
      olderLoadAnchorRef.current = null;
      return;
    }
    const nextHeight = Math.max(container.scrollHeight, messagesContentRef.current?.scrollHeight || 0);
    const delta = Math.max(0, nextHeight - anchor.previousScrollHeight);
    container.scrollTop = anchor.previousScrollTop + delta;
    syncMessageViewportState(container);
    lastObservedViewportSignatureRef.current = buildChatViewportSignature(nextHeight, container.clientHeight, container.scrollTop);
    olderLoadAnchorRef.current = null;
  }, [loadingOlder, olderMessages.length, syncMessageViewportState]);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    syncMessageViewportState(container);
  }, [messageWindow.topSpacerHeight, messageWindow.bottomSpacerHeight, messageWindow.visibleMessages.length, syncMessageViewportState]);

  useEffect(() => {
    const container = messagesRef.current;
    const content = messagesContentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      const nextHeight = Math.max(container.scrollHeight, content.scrollHeight);
      const distanceFromBottom = Math.max(0, nextHeight - container.clientHeight - container.scrollTop);
      const nextSignature = buildChatViewportSignature(nextHeight, container.clientHeight, container.scrollTop);
      syncMessageViewportState(container);
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
  }, [scheduleScrollToLatest, scrollToLatest, selectedConversationId, syncMessageViewportState]);

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
        maybeMarkRead(auth.user, teamId, true, effectiveConversationId);
      }
    };
    document.addEventListener('visibilitychange', handleReturn);
    window.addEventListener('focus', handleReturn);
    return () => {
      document.removeEventListener('visibilitychange', handleReturn);
      window.removeEventListener('focus', handleReturn);
    };
  }, [auth.user, effectiveConversationId, initialSnapshotLoadedRef, messages.length, teamId]);

  useEffect(() => {
    mountedRef.current = true;
    lastObservedViewportSignatureRef.current = '';
    const composerDrafts = composerDraftsRef.current;

    return () => {
      mountedRef.current = false;
      if (scheduledViewportFrameRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(scheduledViewportFrameRef.current);
      }
      clearScheduledScrollToLatest();
      const previewUrls = new Set(latestComposerDraftRef.current.filePreviews.map((preview) => preview.url));
      composerDrafts.forEach((draft) => {
        draft.filePreviews.forEach((preview) => previewUrls.add(preview.url));
      });
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      stopVoiceCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearScheduledScrollToLatest]);

  const switchConversation = (conversationId: string) => {
    const nextConversationId = normalizeConversationId(conversationId);
    if (!conversationId || nextConversationId === effectiveConversationId) return;
    pendingScrollRef.current = true;
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
    if (!switchChatConversation(conversationId)) return;
    composerDraftsRef.current.set(activeComposerDraftKeyRef.current, {
      text,
      filePreviews: [...filePreviews],
      selectedRecipientTarget,
      selectedRecipientIds: [...selectedRecipientIds]
    });
    const nextDraftKey = getChatComposerDraftKey(teamId, nextConversationId);
    const nextDraft = composerDraftsRef.current.get(nextDraftKey) || {
      text: '',
      filePreviews: [],
      selectedRecipientTarget: 'full_team' as ChatTargetType,
      selectedRecipientIds: []
    };
    activeComposerDraftKeyRef.current = nextDraftKey;
    latestComposerDraftRef.current = nextDraft;
    setText(nextDraft.text);
    setFilePreviews([...nextDraft.filePreviews]);
    setSelectedRecipientTarget(nextDraft.selectedRecipientTarget);
    setSelectedRecipientIds([...nextDraft.selectedRecipientIds]);
    setComposerCursorPosition(undefined);
    setReactionMessageId('');
    setActionMessageId('');
    closeConversationSheet();
  };

  const ensureAndSwitchStaffConversation = async () => {
    if (!auth.user || !team) return;
    const staffConversation = await repairStaffConversation(
      activeConversationIsStaff ? effectiveConversationId : CANONICAL_STAFF_CONVERSATION_ID
    );
    if (!staffConversation) return;
    if (selectedConversationId !== staffConversation.id) {
      switchConversation(staffConversation.id);
    }
    closeConversationSheet();
  };

  const handleConversationSelect = (conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (conversationId === STAFF_CONVERSATION_PLACEHOLDER_ID || isStaffOnlyConversation(conversation)) {
      void ensureAndSwitchStaffConversation();
      return;
    }
    switchConversation(conversationId);
  };

  const handleBackFromError = () => {
    if (messagesError && !teamError && !isDefaultTeamConversation(effectiveConversationId)) {
      switchConversation(DEFAULT_TEAM_CONVERSATION_ID);
      return;
    }
    navigate('/messages');
  };

  const handleRetryMessages = async () => {
    if (!activeConversationIsStaff) {
      retryMessages();
      return;
    }
    const staffConversation = await repairStaffConversation(effectiveConversationId);
    if (!staffConversation) return;
    if (staffConversation.id !== effectiveConversationId) {
      switchConversation(staffConversation.id);
      return;
    }
    retryMessages();
  };

  const handleAudienceTargetChange = async (target: ChatTargetType) => {
    setSelectedRecipientTarget(target);
    if (target !== 'individuals') {
      setSelectedRecipientIds([]);
    }

    if (target === 'full_team') {
      if (!isDefaultTeamConversation(effectiveConversationId)) {
        switchConversation(DEFAULT_TEAM_CONVERSATION_ID);
      }
      closeAudienceSheet();
    }
  };

  const loadOlderMessages = async () => {
    try {
      const container = messagesRef.current;
      if (container) {
        olderLoadAnchorRef.current = {
          previousScrollHeight: Math.max(container.scrollHeight, messagesContentRef.current?.scrollHeight || 0),
          previousScrollTop: container.scrollTop
        };
      }
      await loadOlderChatMessages();
    } catch (loadError: any) {
      olderLoadAnchorRef.current = null;
      setStatus({ tone: 'error', message: loadError?.message || 'Unable to load older messages.' });
    }
  };

  const handleMessagesScroll = () => {
    scheduleMessageViewportStateUpdate();
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
    closeAttachSheet();
  };

  const removeFile = (index: number) => {
    setFilePreviews((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      current[index] && URL.revokeObjectURL(current[index].url);
      return next;
    });
  };

  const handleOpenLinkSheet = () => {
    setLinkDraft('');
    openLinkSheet();
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
    closeLinkSheet();
    setLinkDraft('');
  };

  const performQueuedSend = useCallback(async (request: PendingChatSendRequest) => {
    const attachmentNotice = `Uploading ${request.attachmentCount} attachment${request.attachmentCount === 1 ? '' : 's'}...`;
    setComposerNotice(request.attachmentCount ? attachmentNotice : 'Sending...');

    try {
      const result = await sendTeamChatMessage({
        teamId,
        clientMessageId: request.clientMessageId,
        user: request.user,
        profile: request.profile,
        text: request.text,
        files: request.files,
        selectedConversation: request.selectedConversation,
        selectedConversationId: request.selectedConversationId,
        selectedRecipientTarget: request.selectedRecipientTarget,
        selectedRecipientIds: request.selectedRecipientIds,
        onProgress: (stage) => {
          setComposerNotice(stage === 'uploading' ? attachmentNotice : 'Posting message...');
        },
        skipInteractionTiming: true
      });
      if (result.createdConversation) {
        await reloadConversations();
      }
      const resultConversationId = normalizeConversationId(result.conversationId);
      setOptimisticMessages((current) => current.map((candidate) => (
        candidate.clientMessageId === request.clientMessageId
          ? { ...candidate, conversationId: toStoredMessageConversationId(resultConversationId) }
          : candidate
      )));
      if (resultConversationId !== effectiveConversationId) {
        setSelectedConversationId(resultConversationId);
      }

      if (result.wantsAi) {
        setComposerNotice('Asking ALL PLAYS...');
        const question = extractAllPlaysQuestion(request.text);
        if (!question) {
          setStatus({ tone: 'error', message: 'Ask a question after @ALL PLAYS.' });
        } else {
          setAiThinking(true);
          try {
            await sendLazyAllPlaysChatAnswer({
              teamId,
              team: request.team,
              user: request.user,
              question,
              selectedConversation: result.createdConversation || request.selectedConversation,
              selectedConversationId: normalizeConversationId(result.conversationId),
              selectedRecipientTarget: request.selectedRecipientTarget,
              selectedRecipientIds: request.selectedRecipientIds
            });
          } catch (aiError: any) {
            setStatus({ tone: 'error', message: aiError?.message || 'ALL PLAYS could not answer. Please try again.' });
          } finally {
            setAiThinking(false);
          }
        }
      }
    } catch (sendError) {
      const message = getChatSendErrorMessage(sendError);
      request.interaction?.end({ error: message });
      setOptimisticMessages((current) => current.map((candidate) => (
        candidate.clientMessageId === request.clientMessageId
          ? { ...candidate, sendStatus: 'failed', sendError: message }
          : candidate
      )));
      setStatus({ tone: 'error', message });
    } finally {
      setPendingSendCount((current) => Math.max(0, current - 1));
      setComposerNotice('');
    }
  }, [effectiveConversationId, reloadConversations, setSelectedConversationId, teamId]);

  const enqueueChatSend = useCallback((request: PendingChatSendRequest) => {
    setPendingSendCount((current) => current + 1);
    sendQueueRef.current = sendQueueRef.current
      .catch(() => undefined)
      .then(() => performQueuedSend(request));
  }, [performQueuedSend]);

  const retryChatSend = useCallback((clientMessageId: string) => {
    const request = pendingSendRequestsRef.current.get(clientMessageId);
    if (!request) {
      setStatus({ tone: 'error', message: 'This message can no longer be retried.' });
      return;
    }

    setStatus(null);
    request.interaction = startPendingChatSendInteraction(request);
    pendingScrollRef.current = true;
    setOptimisticMessages((current) => current.map((message) => (
      message.clientMessageId === clientMessageId
        ? { ...message, sendStatus: 'pending', sendError: null }
        : message
    )));
    enqueueChatSend(request);
  }, [enqueueChatSend]);

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!auth.user || !team) return;
    const trimmed = text.trim();
    const files = filePreviews.map((preview) => preview.file);
    if (!trimmed && !files.length) return;

    const hasEmptySelectedAudience = selectedRecipientTarget === 'individuals'
      && selectedRecipientIds.map((id) => String(id || '').trim()).filter(Boolean).length === 0;
    if (hasEmptySelectedAudience) {
      setStatus({ tone: 'error', message: 'Choose at least one selected member before sending.' });
      openAudienceSheet();
      return;
    }

    const clientMessageId = createChatClientMessageId(auth.user.uid);
    const request: PendingChatSendRequest = {
      clientMessageId,
      text: trimmed,
      files,
      attachmentCount: files.length,
      user: auth.user,
      profile,
      team,
      selectedConversation,
      selectedConversationId: effectiveConversationId,
      selectedRecipientTarget,
      selectedRecipientIds: [...selectedRecipientIds],
      interaction: startPendingChatSendInteraction({
        attachmentCount: files.length,
        selectedRecipientTarget
      })
    };

    setStatus(null);
    stopVoiceCapture();
    pendingScrollRef.current = true;
    pendingSendRequestsRef.current.set(clientMessageId, request);
    setOptimisticMessages((current) => [...current, createOptimisticChatMessage(request)]);
    composerDraftsRef.current.delete(getChatComposerDraftKey(teamId, request.selectedConversationId));
    latestComposerDraftRef.current = {
      text: '',
      filePreviews: [],
      selectedRecipientTarget: 'full_team',
      selectedRecipientIds: []
    };
    setText('');
    setComposerCursorPosition(undefined);
    setFilePreviews((current) => {
      current.forEach((preview) => URL.revokeObjectURL(preview.url));
      return [];
    });
    setSelectedRecipientTarget('full_team');
    setSelectedRecipientIds([]);
    enqueueChatSend(request);
  };

  const openEmailSheet = () => {
    if (!canModerate) return;
    setTeamEmailSheetRequested(true);
    openTeamEmailSheet();
    void ensureRecipientOptionsLoaded().catch(() => undefined);
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

  const insertRecipientMention = (mentionLabel: string, cursorPosition?: number) => {
    const nextInsertionCursor = typeof cursorPosition === 'number' ? cursorPosition : composerCursorPosition;
    if (typeof nextInsertionCursor !== 'number') {
      setText((current) => insertChatMention(current, mentionLabel));
      setComposerCursorPosition(undefined);
      return;
    }
    const insertion = getChatMentionInsertion(text, mentionLabel, nextInsertionCursor);
    setText(insertion.text);
    setComposerCursorPosition(insertion.cursorPosition);
  };

  const handleToggleReaction = useCallback(async (messageId: string, reactionKey: string) => {
    if (!auth.user) return;
    try {
      await toggleTeamChatReaction(teamId, messageId, reactionKey, auth.user.uid, effectiveConversationId);
      setReactionMessageId('');
    } catch (reactionError: any) {
      setStatus({ tone: 'error', message: reactionError?.message || 'Failed to update reaction.' });
    }
  }, [auth.user, effectiveConversationId, teamId]);

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
      await editTeamChatMessage(teamId, editingMessage.id, trimmed, effectiveConversationId);
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
      await deleteTeamChatMessage(teamId, message.id, effectiveConversationId);
    } catch (deleteError: any) {
      setStatus({ tone: 'error', message: deleteError?.message || 'Failed to delete message.' });
    }
  }, [effectiveConversationId, teamId]);

  const handleToggleMute = useCallback(async () => {
    if (!auth.user?.uid) return;
    const next = !isMuted;
    const conversationId = effectiveConversationId;
    setIsMuted(next);
    onInboxMuteChange?.(conversationId, next);
    try {
      if (next) {
        await muteTeamChat(auth.user.uid, teamId, conversationId);
      } else {
        await unmuteTeamChat(auth.user.uid, teamId, conversationId);
      }
    } catch {
      setIsMuted(!next);
      onInboxMuteChange?.(conversationId, !next);
    }
  }, [auth.user?.uid, effectiveConversationId, isMuted, onInboxMuteChange, teamId]);

  if (loadingContext) {
    return <MessagesPageSkeleton embedded={embedded} />;
  }

  if (error) {
    return (
      <section className={`chat-window app-card p-5 ${embedded ? 'chat-window-embedded' : ''}`}>
        <div className="text-base font-black text-rose-700">{error}</div>
        <div className="mt-4 flex flex-wrap gap-2">
          {canRetryMessagesError ? (
            <button type="button" className="primary-button" onClick={() => { void handleRetryMessages(); }}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </button>
          ) : null}
          <button type="button" className="secondary-button" onClick={handleBackFromError}>Back to messages</button>
        </div>
      </section>
    );
  }

  return (
    <div className={`chat-window ${embedded ? 'chat-window-embedded' : 'chat-window-mobile'}`}>
      <section className={`chat-topbar ${embedded ? 'rounded-xl' : 'safe-top sticky top-0'} ${!embedded && !isDesktopWeb ? 'pr-28' : ''} z-20 border border-gray-200 bg-white/95 px-3 py-3 shadow-app backdrop-blur`}>
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
              onClick={openConversationSheet}
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
          <button
            type="button"
            className={`ghost-button !h-10 !min-h-10 !w-10 !p-0 ${isMuted ? 'text-gray-500' : ''}`}
            onClick={handleToggleMute}
            aria-label={isMuted ? 'Unmute notifications' : 'Mute notifications'}
            aria-pressed={isMuted}
          >
            <BellOff className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" className="ghost-button !h-10 !min-h-10 !w-10 !p-0" onClick={openMediaGallery} aria-label="Open photos and videos">
            <ImageIcon className="h-5 w-5" aria-hidden="true" />
            {mediaEntries.length ? <span className="sr-only">{mediaEntries.length} shared media items</span> : null}
          </button>
        </div>

        {isDesktopWeb ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {conversations.map((conversation) => {
              const active = conversation.id === effectiveConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${
                    active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-primary-50 hover:text-primary-700'
                  }`}
                  onClick={() => handleConversationSelect(conversation.id)}
                >
                  {getConversationDisplayName(conversation, team || {})}
                </button>
              );
            })}
          </div>
        ) : null}

        {!isDesktopWeb && conversationSheetConversations.length > 1 ? (
          <div
            className="chat-mobile-conversation-chips mt-3 flex w-full max-w-full gap-2 overflow-x-auto pb-1"
            aria-label="Quick conversation switcher"
            data-testid="mobile-conversation-chips"
          >
            {conversationSheetConversations.map((conversation) => {
              const active = conversation.id === effectiveConversationId;
              const label = getConversationDisplayName(conversation, team || {});
              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black transition ${
                    active
                      ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700'
                  }`}
                  onClick={() => handleConversationSelect(conversation.id)}
                  aria-label={`Switch to ${label}`}
                  aria-pressed={active}
                >
                  {label}
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
            ) : visibleMessages.length === 0 && !aiThinking ? (
              <div className="flex min-h-64 items-center justify-center p-8 text-center">
                <div>
                  <MessageCircle className="mx-auto h-12 w-12 text-gray-300" aria-hidden="true" />
                  <div className="mt-3 text-base font-black text-gray-950">No messages yet</div>
                  <div className="mt-1 text-sm font-semibold text-gray-500">Send the first update to {teamName}.</div>
                </div>
              </div>
            ) : (
              <MessageList
                messages={messageWindow.visibleMessages}
                topSpacerHeight={messageWindow.topSpacerHeight}
                bottomSpacerHeight={messageWindow.bottomSpacerHeight}
                currentUserId={auth.user?.uid || ''}
                canModerate={canModerate}
                actionMessageId={actionMessageId}
                reactionMessageId={reactionMessageId}
                onMessageRowHeightChange={handleMessageRowHeightChange}
                onActionMessage={setActionMessageId}
                onReactionMessage={setReactionMessageId}
                onToggleReaction={handleToggleReaction}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onRetrySend={retryChatSend}
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
        canModerate={canModerate && isDefaultTeamConversation(effectiveConversationId)}
        canSendTeamEmail={canModerate}
        mentionSuggestions={mentionSuggestions}
        mentionSuggestionsLoading={mentionTriggerActive && recipientOptionsLoading}
        mentionTriggerActive={mentionTriggerActive}
        audienceSummary={audienceSummary}
        disabled={composerDisabled}
        onCursorChange={setComposerCursorPosition}
        onTextChange={setText}
        onSubmit={handleSend}
        onAttach={openAttachSheet}
        onRemoveFile={removeFile}
        onVoice={toggleVoiceCapture}
        onAudience={() => {
          openAudienceSheet();
          void ensureRecipientOptionsLoaded().catch(() => undefined);
        }}
        onTeamEmail={openEmailSheet}
        onMention={insertAllPlaysMention}
        onRecipientMention={insertRecipientMention}
      />

      <input ref={photoInputRef} type="file" className="chat-file-input" accept="image/*" multiple onChange={handleFiles} aria-hidden="true" tabIndex={-1} />
      <input ref={videoInputRef} type="file" className="chat-file-input" accept="video/*" multiple onChange={handleFiles} aria-hidden="true" tabIndex={-1} />

      {showConversationSheet ? (
        <ConversationSheet
          conversations={conversationSheetConversations}
          team={team || {}}
          selectedConversationId={effectiveConversationId}
          onSelect={handleConversationSelect}
          onClose={closeConversationSheet}
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
          onClose={closeAudienceSheet}
        />
      ) : null}

      {showAttachSheet ? (
        <AttachSheet
          onPhoto={() => photoInputRef.current?.click()}
          onVideo={() => videoInputRef.current?.click()}
          onLink={handleOpenLinkSheet}
          onMention={insertAllPlaysMention}
          onClose={closeAttachSheet}
        />
      ) : null}

      {showLinkSheet ? (
        <LinkSheet
          value={linkDraft}
          onChange={setLinkDraft}
          onAdd={addLinkToComposer}
          onClose={closeLinkSheet}
        />
      ) : null}

      {teamEmailSheetRequested && canModerate ? (
        <Suspense fallback={<Sheet title="Team Email" onClose={closeTeamEmailSheet}><div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm font-bold text-gray-500">Loading Team Email...</div></Sheet>}>
          <LazyTeamEmailSheet
            key={teamId}
            open={showEmailSheet}
            auth={auth}
            teamId={teamId}
            profile={profile}
            selectedConversation={selectedConversation}
            selectedConversationId={effectiveConversationId}
            selectedRecipientTarget={selectedRecipientTarget}
            selectedRecipientIds={selectedRecipientIds}
            recipientOptions={recipientOptions}
            recipientOptionsLoading={recipientOptionsLoading}
            recipientOptionsError={recipientOptionsError}
            ensureRecipientOptionsLoaded={ensureRecipientOptionsLoaded}
            setSelectedRecipientTarget={setSelectedRecipientTarget}
            setSelectedRecipientIds={setSelectedRecipientIds}
            switchConversation={switchConversation}
            onClose={closeTeamEmailSheet}
          />
        </Suspense>
      ) : null}

      {showMediaGallery ? (
        <MediaGallerySheet mediaEntries={mediaEntries} onClose={closeMediaGallery} onStatus={setStatus} />
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

export { buildChatViewportSignature };

export function getSafeMessageAttachments(message: ChatMessage): SafeChatAttachment[] {
  return getMessageAttachments(message).filter((attachment): attachment is SafeChatAttachment => (
    typeof attachment?.url === 'string' && isSafeChatMediaUrl(attachment.url)
  ));
}

export function estimateChatMessageRowHeight(message: ChatMessage, previousMessage: ChatMessage | null = null) {
  const attachments = getMessageAttachments(message);
  const textLength = String(message.text || '').trim().length;
  const showDayDivider = formatChatDay(message.createdAt) !== formatChatDay(previousMessage?.createdAt);
  const textLines = Math.max(1, Math.ceil(textLength / 72));
  return CHAT_MESSAGE_BASE_ESTIMATED_HEIGHT
    + ((textLines - 1) * 20)
    + (attachments.length ? CHAT_MESSAGE_ATTACHMENT_ESTIMATED_HEIGHT : 0)
    + (showDayDivider ? CHAT_MESSAGE_DAY_DIVIDER_ESTIMATED_HEIGHT : 0);
}

export function buildVirtualizedChatLayout(
  messages: ChatMessage[],
  measuredHeights?: Record<string, number>
): VirtualizedChatLayout {
  const offsets = [0];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const measuredHeight = Number(measuredHeights?.[String(message.id)] || 0);
    const estimatedHeight = estimateChatMessageRowHeight(message, index > 0 ? messages[index - 1] : null);
    const height = Math.max(measuredHeight, estimatedHeight);
    offsets.push(offsets[offsets.length - 1] + height);
  }

  return {
    offsets,
    totalHeight: offsets[offsets.length - 1] || 0
  };
}

function findFirstVisibleChatRow(offsets: number[], boundary: number, rowCount: number) {
  let low = 0;
  let high = rowCount - 1;
  let candidate = rowCount - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid + 1] >= boundary) {
      candidate = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return Math.max(0, Math.min(candidate, rowCount - 1));
}

export function buildVirtualizedChatWindowFromLayout(
  messages: ChatMessage[],
  layout: VirtualizedChatLayout,
  {
    scrollTop,
    viewportHeight,
    overscanPx = CHAT_MESSAGE_WINDOW_OVERSCAN_PX,
    initialWindowCount = CHAT_MESSAGE_INITIAL_WINDOW_COUNT,
    preferTopWindow = false
  }: {
    scrollTop: number;
    viewportHeight: number;
    overscanPx?: number;
    initialWindowCount?: number;
    preferTopWindow?: boolean;
  }
): VirtualizedChatWindow {
  const { offsets, totalHeight } = layout;
  if (!messages.length) {
    return {
      startIndex: 0,
      endIndex: -1,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      visibleMessages: []
    };
  }

  if (messages.length <= Math.max(1, initialWindowCount)) {
    return {
      startIndex: 0,
      endIndex: messages.length - 1,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      visibleMessages: messages
    };
  }

  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    if (preferTopWindow) {
      const endIndex = Math.min(messages.length - 1, Math.max(0, initialWindowCount - 1));
      return {
        startIndex: 0,
        endIndex,
        topSpacerHeight: 0,
        bottomSpacerHeight: Math.max(0, totalHeight - offsets[endIndex + 1]),
        visibleMessages: messages.slice(0, endIndex + 1)
      };
    }
    const startIndex = Math.max(0, messages.length - Math.max(1, initialWindowCount));
    return {
      startIndex,
      endIndex: messages.length - 1,
      topSpacerHeight: offsets[startIndex],
      bottomSpacerHeight: 0,
      visibleMessages: messages.slice(startIndex)
    };
  }

  const startBoundary = Math.max(0, scrollTop - Math.max(0, overscanPx));
  const endBoundary = Math.min(totalHeight, scrollTop + viewportHeight + Math.max(0, overscanPx));
  const startIndex = findFirstVisibleChatRow(offsets, startBoundary, messages.length);
  const endIndex = Math.max(startIndex, findFirstVisibleChatRow(offsets, endBoundary, messages.length));

  return {
    startIndex,
    endIndex,
    topSpacerHeight: offsets[startIndex],
    bottomSpacerHeight: Math.max(0, totalHeight - offsets[endIndex + 1]),
    visibleMessages: messages.slice(startIndex, endIndex + 1)
  };
}

export function buildVirtualizedChatWindow(
  messages: ChatMessage[],
  {
    scrollTop,
    viewportHeight,
    measuredHeights,
    overscanPx = CHAT_MESSAGE_WINDOW_OVERSCAN_PX,
    initialWindowCount = CHAT_MESSAGE_INITIAL_WINDOW_COUNT,
    preferTopWindow = false
  }: {
    scrollTop: number;
    viewportHeight: number;
    measuredHeights?: Record<string, number>;
    overscanPx?: number;
    initialWindowCount?: number;
    preferTopWindow?: boolean;
  }
): VirtualizedChatWindow {
  return buildVirtualizedChatWindowFromLayout(
    messages,
    buildVirtualizedChatLayout(messages, measuredHeights),
    {
      scrollTop,
      viewportHeight,
      overscanPx,
      initialWindowCount,
      preferTopWindow
    }
  );
}

function resolveMutedState(
  teamId: string,
  conversationId: string,
  inboxTeam?: ChatTeam,
  profile: Record<string, any> = {}
) {
  const teamChatState = profile?.teamChatState;
  const mutedConversations = teamChatState && typeof teamChatState === 'object'
    ? teamChatState?.[teamId]?.mutedConversations
    : null;
  if (mutedConversations && typeof mutedConversations === 'object' && mutedConversations[conversationId]) {
    return true;
  }
  if (isDefaultTeamConversation(conversationId)) {
    const chatMuted = profile?.chatMuted;
    if (chatMuted && typeof chatMuted === 'object' && chatMuted[teamId]) {
      return true;
    }
  }
  if (inboxTeam?.id === teamId && typeof inboxTeam.isMuted === 'boolean') {
    const inboxConversationId = inboxTeam.preferredConversationId || DEFAULT_TEAM_CONVERSATION_ID;
    if (inboxConversationId === conversationId) {
      return inboxTeam.isMuted;
    }
  }
  return false;
}

function maybeMarkRead(
  user: AuthState['user'] | null | undefined,
  teamId: string,
  hasTeamId: boolean,
  conversationId = DEFAULT_TEAM_CONVERSATION_ID
) {
  const isPageVisible = document.visibilityState === 'visible' && !document.hidden;
  const isWindowFocused = document.hasFocus();
  if (shouldUpdateChatLastRead({
    hasCurrentUser: Boolean(user?.uid),
    hasTeamId,
    isPageVisible,
    isWindowFocused
  })) {
    if (user?.uid) {
      void markTeamChatRead(user.uid, teamId, conversationId);
    }
  }
}

function isNearBottom(container: HTMLDivElement | null) {
  if (!container) return true;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= 96;
}

export function StatusBanner({ status, onClose }: { status: ChatStatus; onClose: () => void }) {
  const toneClass = status.tone === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : status.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-primary-200 bg-primary-50 text-primary-700';
  return (
    <div
      role={status.tone === 'error' ? 'alert' : 'status'}
      aria-live={status.tone === 'error' ? 'assertive' : 'polite'}
      className={`mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm font-bold ${toneClass}`}
    >
      <span>{status.message}</span>
      <button type="button" className="rounded-lg p-1" onClick={onClose} aria-label="Close status">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

type MessageListProps = {
  messages: ChatMessage[];
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  currentUserId: string;
  canModerate: boolean;
  actionMessageId: string;
  reactionMessageId: string;
  onMessageRowHeightChange: (messageId: string, height: number) => void;
  onActionMessage: (messageId: string) => void;
  onReactionMessage: (messageId: string) => void;
  onToggleReaction: (messageId: string, reactionKey: string) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onRetrySend: (clientMessageId: string) => void;
};

const MessageList = memo(function MessageList({
  messages,
  topSpacerHeight,
  bottomSpacerHeight,
  currentUserId,
  canModerate,
  actionMessageId,
  reactionMessageId,
  onMessageRowHeightChange,
  onActionMessage,
  onReactionMessage,
  onToggleReaction,
  onEdit,
  onDelete,
  onRetrySend
}: MessageListProps) {
  let lastDay = '';
  return (
    <div className="space-y-3 p-3 sm:p-4">
      {topSpacerHeight > 0 ? <div aria-hidden="true" data-testid="chat-top-spacer" style={{ height: `${topSpacerHeight}px` }} /> : null}
      {messages.map((message, index) => {
        const day = formatChatDay(message.createdAt);
        const showDay = day && day !== lastDay;
        const preferReactionPickerAbove = index >= Math.max(0, messages.length - 2);
        lastDay = day || lastDay;
        return (
          <div
            key={message.id}
            className="message-row-measure"
            ref={(node) => {
              if (!node) return;
              const nextHeight = node.offsetHeight;
              if (nextHeight > 0) {
                onMessageRowHeightChange(String(message.id), nextHeight);
              }
            }}
          >
            {showDay ? <div className="my-3 text-center text-[11px] font-black uppercase text-gray-400">{day}</div> : null}
            <MessageBubble
              message={message}
              messageRevisionSignature={getMessageRevisionSignature(message)}
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
              onRetrySend={onRetrySend}
            />
          </div>
        );
      })}
      {bottomSpacerHeight > 0 ? <div aria-hidden="true" data-testid="chat-bottom-spacer" style={{ height: `${bottomSpacerHeight}px` }} /> : null}
    </div>
  );
});

MessageList.displayName = 'MessageList';

type MessageBubbleProps = {
  message: ChatMessage;
  messageRevisionSignature: string;
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
  onRetrySend: (clientMessageId: string) => void;
};

const MessageBubble = memo(function MessageBubble({
  message,
  messageRevisionSignature: _messageRevisionSignature,
  currentUserId,
  canModerate,
  actionsOpen,
  reactionsOpen,
  preferReactionPickerAbove,
  onActionMessage,
  onReactionMessage,
  onToggleReaction,
  onEdit,
  onDelete,
  onRetrySend
}: MessageBubbleProps) {
  const isAi = message.ai === true;
  const isOwn = !isAi && message.senderId === currentUserId;
  const isDeleted = message.deleted === true;
  const isLocalSend = message.sendStatus === 'pending' || message.sendStatus === 'failed';
  const senderLabel = useMemo(() => getMessageSenderLabel(message, currentUserId), [currentUserId, message]);
  const attachments = useMemo(() => getSafeMessageAttachments(message), [message]);
  const reactions = useMemo(() => normalizeChatReactions(message), [message]);
  const messageHtml = useMemo(() => formatChatMessageHtml(message.text || ''), [message.text]);
  const createdAtLabel = useMemo(() => formatChatTime(message.createdAt), [message.createdAt]);
  const canEdit = isOwn && !isLocalSend && !isDeleted && Boolean(message.text);
  const canDelete = !isAi && !isLocalSend && !isDeleted && (isOwn || canModerate);

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
          {!message.text && isLocalSend && message.attachmentCount ? (
            <div className="text-sm font-semibold leading-6">
              {message.attachmentCount} attachment{message.attachmentCount === 1 ? '' : 's'} queued
            </div>
          ) : null}
        </div>
        <div className={`chat-reactions-anchor ${isOwn ? 'justify-end' : 'justify-start'}`}>
          {!isLocalSend ? (
            <ReactionPills
              message={message}
              currentUserId={currentUserId}
              reactions={reactions}
              onToggleReaction={onToggleReaction}
              onOpenPicker={() => onReactionMessage(reactionsOpen ? '' : message.id)}
            />
          ) : null}
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
        {isLocalSend ? (
          <div className={`mt-1 flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
            {message.sendStatus === 'failed' ? (
              <div className="flex max-w-full flex-wrap items-center justify-end gap-2 text-xs font-bold text-rose-700">
                <span>{message.sendError || 'Failed to send message.'}</span>
                <button type="button" className="ghost-button !h-7 !min-h-7 px-2 text-xs" onClick={() => onRetrySend(message.clientMessageId || message.id)}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </button>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Sending
              </span>
            )}
          </div>
        ) : null}
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
    && previous.messageRevisionSignature === next.messageRevisionSignature
    && previous.onActionMessage === next.onActionMessage
    && previous.onReactionMessage === next.onReactionMessage
    && previous.onToggleReaction === next.onToggleReaction
    && previous.onEdit === next.onEdit
    && previous.onDelete === next.onDelete
    && previous.onRetrySend === next.onRetrySend;
}

export function areMessagesEquivalent(previous: ChatMessage, next: ChatMessage) {
  return previous === next || (
    getMessageRevisionSignature(previous) === getMessageRevisionSignature(next)
  );
}

export function getMessageRevisionSignature(message: ChatMessage) {
  const cachedSignature = messageRevisionSignatureCache.get(message);
  if (cachedSignature) {
    return cachedSignature;
  }

  const attachmentSignature = getMessageAttachments(message)
    .map((attachment) => [
      attachment?.type || '',
      attachment?.url || '',
      attachment?.path || '',
      attachment?.thumbnailUrl || '',
      attachment?.name || '',
      attachment?.mimeType || '',
      attachment?.size ?? '',
      normalizeTimestampValue(attachment?.uploadedAt)
    ].join('\u001f'))
    .join('\u001e');
  const normalizedReactions = normalizeChatReactions(message);
  const reactionSignature = chatReactions
    .map(({ key }) => {
      const users = normalizedReactions[key] || [];
      return users.length ? `${key}:${users.join(',')}` : '';
    })
    .filter(Boolean)
    .join('|');
  const signature = [
    message.id,
    message.clientMessageId || '',
    message.text || '',
    message.ai === true ? '1' : '0',
    message.deleted === true ? '1' : '0',
    message.sendStatus || '',
    message.sendError || '',
    message.attachmentCount ?? '',
    message.senderId || '',
    message.senderName || '',
    message.senderEmail || '',
    message.senderPhotoUrl || '',
    message.aiName || '',
    normalizeTimestampValue(message.createdAt),
    normalizeTimestampValue(message.editedAt),
    attachmentSignature,
    reactionSignature
  ].join('\u001d');

  messageRevisionSignatureCache.set(message, signature);
  return signature;
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

export function MessageAvatar({ message, label }: { message: ChatMessage; label: string }) {
  const initialsBadge = (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-black text-gray-600">
      {label.charAt(0).toUpperCase()}
    </div>
  );
  if (message.ai) {
    return <img src="./logo_small.png" alt="ALL PLAYS assistant avatar" className="h-8 w-8 rounded-full border border-indigo-200 object-cover" />;
  }
  if (message.senderPhotoUrl) {
    return <AvatarImage src={message.senderPhotoUrl} alt={`${label} profile photo`} loading="lazy" decoding="async" className="h-8 w-8 rounded-full object-cover" fallback={initialsBadge} />;
  }
  return initialsBadge;
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

function MessageAttachments({ attachments, isOwn }: { attachments: SafeChatAttachment[]; isOwn: boolean }) {
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
          const active = isSelectedConversation(conversation.id, selectedConversationId);
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

export function AudienceSheet({
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
  const [recipientSearch, setRecipientSearch] = useState('');
  const normalizedRecipientSearch = recipientSearch.trim().toLowerCase();
  const selectedRecipientIdSet = useMemo(() => new Set(selectedRecipientIds), [selectedRecipientIds]);
  const matchesRecipientSearch = useCallback((option: ChatRecipientOption) => {
    if (!normalizedRecipientSearch) return true;
    const label = `${option.name} ${option.detail || ''}`.toLowerCase();
    return label.includes(normalizedRecipientSearch);
  }, [normalizedRecipientSearch]);
  const matchingRecipientOptions = useMemo(
    () => recipientOptions.filter((option) => matchesRecipientSearch(option)),
    [matchesRecipientSearch, recipientOptions]
  );
  const selectedRecipientOptions = useMemo(
    () => recipientOptions.filter((option) => selectedRecipientIdSet.has(option.id)),
    [recipientOptions, selectedRecipientIdSet]
  );
  const browseRecipientOptions = useMemo(
    () => matchingRecipientOptions.filter((option) => !selectedRecipientIdSet.has(option.id)),
    [matchingRecipientOptions, selectedRecipientIdSet]
  );
  const hasMatchingRecipientOptions = matchingRecipientOptions.length > 0;
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
          <div className="mt-4">
            <label htmlFor="chat-audience-recipient-search" className="mb-1 block text-xs font-black uppercase tracking-[0.18em] text-gray-500">
              Search recipients
            </label>
            <input
              id="chat-audience-recipient-search"
              type="search"
              value={recipientSearch}
              onChange={(event) => setRecipientSearch(event.target.value)}
              placeholder="Search by member or guardian name"
              className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </div>

          {selectedRecipientOptions.length ? (
            <div className="mt-4 rounded-xl border border-primary-100 bg-primary-50/60 p-3">
              <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-primary-700">Selected</div>
              <div className="space-y-2">
                {selectedRecipientOptions.map((option) => (
                  <label key={option.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-primary-100 bg-white px-3 py-2">
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
                ))}
              </div>
            </div>
          ) : null}

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
            ) : recipientOptions.length ? browseRecipientOptions.length ? browseRecipientOptions.map((option) => (
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
            )) : normalizedRecipientSearch && !hasMatchingRecipientOptions ? (
              <div className="p-3 text-sm font-semibold text-gray-500">No recipients match that search yet.</div>
            ) : (
              <div className="p-3 text-sm font-semibold text-gray-500">No roster or community members are available yet.</div>
            ) : (
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
                  <img src={entry.url} alt={entry.name || 'Chat media'} loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
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

export function Sheet({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const handleNativeBackDismiss = (event: Event) => {
      if (event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      onCloseRef.current();
    };

    window.addEventListener(APP_BACK_DISMISS_EVENT, handleNativeBackDismiss);
    return () => {
      window.removeEventListener(APP_BACK_DISMISS_EVENT, handleNativeBackDismiss);
    };
  }, []);

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
