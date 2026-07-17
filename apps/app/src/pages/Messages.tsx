import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  BellOff,
  ChevronDown,
  MessageCircle,
  RefreshCw,
  Search
} from 'lucide-react';
import {
  getChatInboxPreview,
  loadChatInbox,
  type ChatInboxPreviewUpdate,
  type ChatMessage,
  type ChatTeam
} from '../lib/chatService';
import { OpportunityConversation } from '../components/OpportunityConversation';
import { listOpportunityInquiries } from '../lib/opportunityService';
import type { OpportunityInquiry } from '../lib/opportunityLogic';
import { MessagesPageSkeleton } from '../components/PageSkeletons';
import { PullToRefresh } from '../components/PullToRefresh';
import {
  DEFAULT_TEAM_CONVERSATION_ID,
  formatInboxTime,
  isDefaultTeamConversation
} from '../lib/chatLogic';
import { useShellLayout } from '../lib/useShellLayout';
import { useRefreshOnResume } from '../lib/useRefreshOnResume';
import { startScreenMountTimer } from '../lib/uxTiming';
import { completeParentCoreWorkflowTimer } from '../lib/parentWorkflowTiming';
import type { AuthState } from '../lib/types';
import { ChatWindow, TeamAvatar } from './messages/components/ChatWindow';

export {
  MessageAvatar,
  StatusBanner,
  TeamAvatar,
  buildChatViewportSignature,
  isSelectedConversation,
  mergeVisibleChatMessages,
  normalizeConversationId
} from './messages/components/ChatWindow';

export function Messages({ auth }: { auth: AuthState }) {
  const { teamId } = useParams();
  const location = useLocation();
  const { isDesktopWeb } = useShellLayout();
  const [teams, setTeams] = useState<ChatTeam[]>([]);
  const [inquiries, setInquiries] = useState<OpportunityInquiry[]>([]);
  const [inquiryError, setInquiryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedDesktopTeamId, setSelectedDesktopTeamId] = useState<string | undefined>(undefined);
  const shouldLoadInbox = isDesktopWeb || !teamId;
  const inboxLoadRouteKey = getMessagesInboxLoadRouteKey(shouldLoadInbox, teamId);
  const inboxRequestIdRef = useRef(0);
  const directThreadMountRecordedTeamIdRef = useRef<string | null>(null);

  const refreshInbox = useCallback(async () => {
    if (!auth.user) return;
    const requestId = inboxRequestIdRef.current + 1;
    const previewUpdates = new Map<string, ChatInboxPreviewUpdate>();
    const pendingPreviewUpdates = new Map<string, ChatInboxPreviewUpdate>();
    let cancelScheduledPreviewFlush: (() => void) | null = null;
    const flushPreviewUpdates = () => {
      cancelScheduledPreviewFlush = null;
      if (pendingPreviewUpdates.size === 0) return;
      if (inboxRequestIdRef.current !== requestId) {
        pendingPreviewUpdates.clear();
        return;
      }
      const updates = new Map(pendingPreviewUpdates);
      pendingPreviewUpdates.clear();
      setTeams((current) => mergeInboxTeams(current, updates));
    };
    const schedulePreviewFlush = () => {
      if (cancelScheduledPreviewFlush) return;
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        const frameId = window.requestAnimationFrame(flushPreviewUpdates);
        cancelScheduledPreviewFlush = () => window.cancelAnimationFrame(frameId);
        return;
      }
      const timeoutId = globalThis.setTimeout(flushPreviewUpdates, 16);
      cancelScheduledPreviewFlush = () => globalThis.clearTimeout(timeoutId);
    };
    const cancelPreviewFlush = () => {
      if (cancelScheduledPreviewFlush) {
        cancelScheduledPreviewFlush();
        cancelScheduledPreviewFlush = null;
      }
      pendingPreviewUpdates.clear();
    };
    const timer = startScreenMountTimer('messages', {
      mode: 'inbox',
      hasTeamRoute: Boolean(teamId)
    });
    inboxRequestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    setInquiryError(null);
    try {
      const [result, inquiryPage] = await Promise.all([
        loadChatInbox(auth.user, {
          includeLastMessages: false,
          onPreview: (previewUpdate) => {
            if (inboxRequestIdRef.current !== requestId) return;
            previewUpdates.set(previewUpdate.teamId, previewUpdate);
            pendingPreviewUpdates.set(previewUpdate.teamId, previewUpdate);
            schedulePreviewFlush();
          }
        }),
        listOpportunityInquiries().catch((loadError: any) => {
          setInquiryError(loadError?.message || 'Unable to load opportunity conversations.');
          return { items: [] as OpportunityInquiry[], nextCursor: null };
        })
      ]);
      if (inboxRequestIdRef.current !== requestId) {
        cancelPreviewFlush();
        return;
      }
      cancelPreviewFlush();
      setTeams(mergeInboxTeams(result.teams, previewUpdates));
      setInquiries(inquiryPage.items);
      const totalUnread = result.teams.reduce((sum, team) => sum + team.unreadCount, 0);
      completeParentCoreWorkflowTimer('messages', {
        targetPage: 'messages',
        mode: 'inbox',
        teamId: teamId || '',
        teamCount: result.teams.length,
        unreadCount: totalUnread,
        completedRoute: teamId ? `/messages/${teamId}` : '/messages'
      });
      timer.end({
        teamCount: result.teams.length,
        unreadCount: totalUnread,
        deferredPreviewTargetCount: result.teams.length,
        deferredPreviewUpdateCount: previewUpdates.size
      });
    } catch (loadError: any) {
      if (inboxRequestIdRef.current !== requestId) {
        cancelPreviewFlush();
        return;
      }
      cancelPreviewFlush();
      const message = loadError?.message || 'Unable to load messages.';
      setError(message);
      setTeams([]);
      setInquiries([]);
      timer.end({
        teamCount: 0,
        unreadCount: 0,
        deferredPreviewTargetCount: 0,
        deferredPreviewUpdateCount: previewUpdates.size,
        error: message
      });
    } finally {
      if (inboxRequestIdRef.current === requestId) {
        setLoading(false);
      } else {
        cancelPreviewFlush();
      }
    }
  }, [auth.user, teamId]);

  useEffect(() => {
    if (!shouldLoadInbox) {
      setLoading(false);
      setError(null);
      setTeams([]);
      const directThreadTeamId = inboxLoadRouteKey;
      if (auth.user && shouldRecordDirectThreadMount(directThreadMountRecordedTeamIdRef.current, directThreadTeamId)) {
        directThreadMountRecordedTeamIdRef.current = directThreadTeamId;
        const timer = startScreenMountTimer('messages', {
          mode: 'direct_thread',
          hasTeamRoute: Boolean(directThreadTeamId)
        });
        timer.end({
          teamCount: 0,
          unreadCount: 0,
          deferredPreviewTargetCount: 0,
          deferredPreviewUpdateCount: 0
        });
        completeParentCoreWorkflowTimer('messages', {
          targetPage: 'messages',
          mode: 'direct_thread',
          teamId: directThreadTeamId,
          completedRoute: directThreadTeamId ? `/messages/${directThreadTeamId}` : '/messages'
        });
      }
      return;
    }
    directThreadMountRecordedTeamIdRef.current = null;
    if (!auth.user) {
      return;
    }
    refreshInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, shouldLoadInbox, inboxLoadRouteKey]);

  useRefreshOnResume(
    () => {
      if (shouldLoadInbox) void refreshInbox();
    },
    { enabled: Boolean(auth.user?.uid) && shouldLoadInbox }
  );

  // Keep the desktop selection in sync with the current inbox contents.
  useEffect(() => {
    if (!isDesktopWeb || teamId) return;
    if (!teams.length) {
      if (selectedDesktopTeamId) {
        setSelectedDesktopTeamId(undefined);
      }
      return;
    }
    if (!selectedDesktopTeamId || !teams.some((team) => team.id === selectedDesktopTeamId)) {
      setSelectedDesktopTeamId(teams[0].id);
    }
  }, [isDesktopWeb, selectedDesktopTeamId, teamId, teams]);

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

  const filteredInquiries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return inquiries;
    return inquiries.filter((inquiry) => [
      inquiry.listingTitle,
      inquiry.lastMessageAuthorName,
      inquiry.lastMessagePreview,
      'opportunity'
    ].join(' ').toLowerCase().includes(normalized));
  }, [inquiries, query]);

  const preferredConversationId = useMemo(() => getPreferredConversationIdFromSearch(location.search), [location.search]);
  const selectedInquiryId = useMemo(() => getOpportunityInquiryIdFromSearch(location.search), [location.search]);
  const initialRecipient = useMemo(() => getComposeRecipientFromSearch(location.search), [location.search]);

  const activeTeamId = selectedInquiryId ? undefined : teamId || (isDesktopWeb ? selectedDesktopTeamId : undefined);

  if (isDesktopWeb) {
    return (
      <div className="messages-page messages-page-web">
        <MessagesHeader teams={teams} inquiries={inquiries} loading={loading} onRefresh={refreshInbox} />
        <section className="messages-two-pane mt-4">
          <aside className="messages-list-pane">
            <InboxSearch query={query} onChange={setQuery} />
            <div className="messages-list-scroll">
              <OpportunityInboxList inquiries={filteredInquiries} activeInquiryId={selectedInquiryId} error={inquiryError} />
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
            {selectedInquiryId ? (
              <OpportunityConversation
                auth={auth}
                inquiryId={selectedInquiryId}
                embedded
                onReplied={(updated) => setInquiries((current) => current.map((item) => item.id === updated.id ? updated : item))}
              />
            ) : activeTeamId ? (
              <ChatWindow
                auth={auth}
                teamId={activeTeamId}
                inboxTeam={teams.find((team) => team.id === activeTeamId)}
                preferredConversationId={teamId === activeTeamId ? preferredConversationId : ''}
                initialRecipient={teamId === activeTeamId ? initialRecipient : null}
                onInboxMuteChange={(nextConversationId, nextIsMuted) => {
                  setTeams((current) => updateInboxTeamMuteState(current, activeTeamId, nextConversationId, nextIsMuted));
                }}
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

  if (selectedInquiryId) {
    return <OpportunityConversation auth={auth} inquiryId={selectedInquiryId} onReplied={(updated) => setInquiries((current) => current.map((item) => item.id === updated.id ? updated : item))} />;
  }

  if (activeTeamId) {
    return (
      <ChatWindow
        auth={auth}
        teamId={activeTeamId}
        inboxTeam={teams.find((team) => team.id === activeTeamId)}
        preferredConversationId={preferredConversationId}
        initialRecipient={initialRecipient}
        onInboxMuteChange={(nextConversationId, nextIsMuted) => {
          setTeams((current) => updateInboxTeamMuteState(current, activeTeamId, nextConversationId, nextIsMuted));
        }}
      />
    );
  }

  return (
    <PullToRefresh onRefresh={() => refreshInbox()} disabled={!auth.user?.uid}>
    <div className="messages-page space-y-4">
      <MessagesHeader teams={teams} inquiries={inquiries} loading={loading} onRefresh={refreshInbox} />
      <InboxSearch query={query} onChange={setQuery} />
      <OpportunityInboxList inquiries={filteredInquiries} activeInquiryId="" error={inquiryError} />
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
    </PullToRefresh>
  );
}

function MessagesHeader({ teams, inquiries, loading, onRefresh }: { teams: ChatTeam[]; inquiries: OpportunityInquiry[]; loading: boolean; onRefresh: () => void }) {
  const unread = teams.reduce((total, team) => total + team.unreadCount, 0);
  const staffTeams = teams.filter((team) => team.canModerate).length;

  return (
    <section className="messages-header app-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="app-label">Messages</div>
          <h1 className="mt-1 text-xl font-black text-gray-950 sm:text-2xl">Conversations</h1>
          <div className="mt-1 text-xs font-bold text-gray-500 sm:text-sm">
            {teams.length} team chat{teams.length === 1 ? '' : 's'} · {inquiries.length} opportunit{inquiries.length === 1 ? 'y' : 'ies'} · {unread} unread · {staffTeams} staff
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
        placeholder="Search conversations"
        enterKeyHint="search"
      />
    </label>
  );
}

function OpportunityInboxList({ inquiries, activeInquiryId, error }: { inquiries: OpportunityInquiry[]; activeInquiryId: string; error: string | null }) {
  if (!inquiries.length && !error) return null;
  return (
    <section className="mb-3 space-y-2" aria-labelledby="opportunity-conversations-title">
      <div className="flex items-center justify-between px-1">
        <h2 id="opportunity-conversations-title" className="app-label">Opportunity conversations</h2>
        {inquiries.length ? <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-black text-primary-700">{inquiries.length}</span> : null}
      </div>
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</div> : null}
      {inquiries.map((inquiry) => (
        <Link
          key={inquiry.id}
          to={`/messages?inquiry=${encodeURIComponent(inquiry.id)}`}
          className={`message-row app-card flex items-center gap-3 p-3 transition hover:border-primary-200 hover:shadow-app-lg ${activeInquiryId === inquiry.id ? '!border-primary-200 bg-primary-50/50' : ''}`}
        >
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-primary-100 bg-primary-50 text-primary-700"><MessageCircle className="h-5 w-5" /></div>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black text-gray-950">{inquiry.listingTitle}</span>
            <span className="mt-1 block truncate text-xs font-semibold text-gray-600">
              {inquiry.lastMessagePreview
                ? `${inquiry.lastMessageAuthorName ? `${inquiry.lastMessageAuthorName}: ` : ''}${inquiry.lastMessagePreview}`
                : 'Private opportunity conversation'}
            </span>
          </span>
          <span className="flex-none text-[10px] font-black uppercase text-primary-700">Opportunity</span>
        </Link>
      ))}
    </section>
  );
}

export function getDirectThreadMountKey(teamId: string | null | undefined) {
  return String(teamId || '').trim();
}

export function shouldRecordDirectThreadMount(recordedTeamId: string | null, teamId: string | null | undefined) {
  return recordedTeamId !== getDirectThreadMountKey(teamId);
}

export function getMessagesInboxLoadRouteKey(shouldLoadInbox: boolean, teamId: string | null | undefined) {
  return shouldLoadInbox ? '' : getDirectThreadMountKey(teamId);
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
  const listRef = useRef<HTMLElement | null>(null);
  const compactScrollContainerRef = useRef<HTMLElement | null>(null);
  const shouldWindow = teams.length > INBOX_WINDOWING_THRESHOLD;
  const activeTeamIndex = useMemo(
    () => activeTeamId ? teams.findIndex((team) => team.id === activeTeamId) : -1,
    [activeTeamId, teams]
  );
  const [rowWindow, setRowWindow] = useState<InboxRowWindow>(() => ({
    startIndex: 0,
    endIndex: Math.min(teams.length, INBOX_WINDOWING_THRESHOLD)
  }));
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState<number | null>(null);

  const updateRowWindow = useCallback(() => {
    if (!shouldWindow || !listRef.current) {
      setRowWindow({ startIndex: 0, endIndex: teams.length });
      return;
    }

    if (compact) {
      const scrollContainer = compactScrollContainerRef.current || listRef.current.parentElement;
      setRowWindow(getInboxRowWindow({
        itemCount: teams.length,
        scrollOffset: scrollContainer?.scrollTop || 0,
        viewportSize: scrollContainer?.clientHeight || DEFAULT_INBOX_VIEWPORT_HEIGHT
      }));
      return;
    }

    const listOffset = listRef.current.getBoundingClientRect().top + window.scrollY;
    setRowWindow(getInboxRowWindow({
      itemCount: teams.length,
      scrollOffset: window.scrollY,
      viewportSize: window.innerHeight || DEFAULT_INBOX_VIEWPORT_HEIGHT,
      listOffset
    }));
  }, [compact, shouldWindow, teams.length]);

  useEffect(() => {
    if (!shouldWindow) {
      setRowWindow({ startIndex: 0, endIndex: teams.length });
      return;
    }

    const scrollTarget = compact ? listRef.current?.parentElement : window;
    if (compact) {
      compactScrollContainerRef.current = scrollTarget instanceof HTMLElement ? scrollTarget : null;
    }
    let animationFrame = 0;
    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        updateRowWindow();
      });
    };

    updateRowWindow();
    if (scrollTarget) {
      scrollTarget.addEventListener('scroll', scheduleUpdate, { passive: true });
    }
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      if (scrollTarget) {
        scrollTarget.removeEventListener('scroll', scheduleUpdate);
      }
      window.removeEventListener('resize', scheduleUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [compact, shouldWindow, teams.length, updateRowWindow]);

  useEffect(() => {
    if (!shouldWindow || !compact || activeTeamIndex < 0 || !listRef.current) return;
    if (keyboardFocusIndex !== null) return;
    const scrollContainer = listRef.current.parentElement;
    if (!scrollContainer) return;
    const viewportHeight = scrollContainer.clientHeight || DEFAULT_INBOX_VIEWPORT_HEIGHT;
    const rowTop = activeTeamIndex * INBOX_ROW_HEIGHT;
    const rowBottom = rowTop + INBOX_ROW_HEIGHT;
    if (rowTop < scrollContainer.scrollTop || rowBottom > scrollContainer.scrollTop + viewportHeight) {
      scrollContainer.scrollTop = Math.max(0, rowTop - Math.floor((viewportHeight - INBOX_ROW_HEIGHT) / 2));
      updateRowWindow();
    }
  }, [activeTeamIndex, compact, keyboardFocusIndex, shouldWindow, updateRowWindow]);

  const focusWindowedTeam = useCallback((teamIndex: number) => {
    if (!shouldWindow || !compact || !listRef.current) return;
    const nextIndex = Math.min(teams.length - 1, Math.max(0, teamIndex));
    setKeyboardFocusIndex(nextIndex);
    const scrollContainer = compactScrollContainerRef.current || listRef.current.parentElement;
    const viewportHeight = scrollContainer?.clientHeight || DEFAULT_INBOX_VIEWPORT_HEIGHT;
    const rowTop = nextIndex * INBOX_ROW_HEIGHT;
    const rowBottom = rowTop + INBOX_ROW_HEIGHT;
    let scrollOffset = scrollContainer?.scrollTop || 0;

    if (rowTop < scrollOffset || rowBottom > scrollOffset + viewportHeight) {
      scrollOffset = Math.max(0, rowTop - Math.floor((viewportHeight - INBOX_ROW_HEIGHT) / 2));
      if (scrollContainer) scrollContainer.scrollTop = scrollOffset;
    }

    setRowWindow(getInboxRowWindow({
      itemCount: teams.length,
      scrollOffset,
      viewportSize: viewportHeight
    }));
    window.requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-inbox-index="${nextIndex}"]`)
        ?.focus();
    });
  }, [compact, shouldWindow, teams.length]);

  const handleWindowedListKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (!shouldWindow || !compact) return;
    const focusedRow = (event.target as HTMLElement).closest<HTMLElement>('[data-inbox-index]');
    const focusedIndex = focusedRow ? Number(focusedRow.dataset.inboxIndex) : activeTeamIndex;
    let nextIndex: number | null = null;

    if (event.key === 'ArrowDown') nextIndex = Math.min(teams.length - 1, Math.max(0, focusedIndex + 1));
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, focusedIndex < 0 ? 0 : focusedIndex - 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = teams.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    focusWindowedTeam(nextIndex);
  }, [activeTeamIndex, compact, focusWindowedTeam, shouldWindow, teams.length]);

  const displayedRowWindow = keyboardFocusIndex === null
    ? rowWindow
    : getInboxRowWindow({
      itemCount: teams.length,
      scrollOffset: keyboardFocusIndex * INBOX_ROW_HEIGHT,
      viewportSize: compactScrollContainerRef.current?.clientHeight || DEFAULT_INBOX_VIEWPORT_HEIGHT
    });

  if (loading && !teams.length) {
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

  if (!shouldWindow) {
    return (
      <section className={compact ? 'space-y-2' : 'space-y-3'}>
        {teams.map((team) => (
          <InboxRow key={team.id} team={team} active={activeTeamId === team.id} compact={compact} onSelect={onSelect} />
        ))}
      </section>
    );
  }

  const visibleTeams = teams.slice(displayedRowWindow.startIndex, displayedRowWindow.endIndex);
  return (
    <section
      ref={listRef}
      className="relative"
      style={{ height: teams.length * INBOX_ROW_HEIGHT }}
      data-testid="messages-inbox-window"
      tabIndex={compact ? 0 : undefined}
      aria-label={compact ? 'Team chats. Use the Up and Down Arrow, Home, and End keys to move through all teams.' : undefined}
      onKeyDown={handleWindowedListKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardFocusIndex(null);
      }}
    >
      {visibleTeams.map((team, visibleIndex) => {
        const teamIndex = displayedRowWindow.startIndex + visibleIndex;
        return (
          <InboxRow
            key={team.id}
            team={team}
            active={activeTeamId === team.id}
            compact={compact}
            onSelect={onSelect}
            inboxIndex={teamIndex}
            managedKeyboard={compact}
            style={{
              position: 'absolute',
              top: teamIndex * INBOX_ROW_HEIGHT,
              height: INBOX_ROW_HEIGHT - INBOX_ROW_GAP
            }}
          />
        );
      })}
    </section>
  );
}

function InboxRow({ team, active, compact, onSelect, inboxIndex, managedKeyboard = false, style }: { team: ChatTeam; active: boolean; compact: boolean; onSelect?: (teamId: string) => void; inboxIndex?: number; managedKeyboard?: boolean; style?: CSSProperties }) {
  const preview = getChatInboxPreview(team.lastMessage);
  const timeLabel = formatInboxTime(team.lastMessage?.createdAt);
  const route = buildMessagesRoute(team.id, team.preferredConversationId);

  return (
    <Link
      to={route}
      onClick={onSelect ? () => onSelect(team.id) : undefined}
      style={style}
      data-inbox-index={inboxIndex}
      tabIndex={managedKeyboard ? -1 : undefined}
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
      ) : team.isMuted ? (
        <BellOff className="h-4 w-4 flex-none text-gray-400" aria-label="Notifications muted" />
      ) : compact ? null : (
        <ChevronDown className="-rotate-90 h-5 w-5 flex-none text-gray-300" aria-hidden="true" />
      )}
    </Link>
  );
}

export const INBOX_ROW_HEIGHT = 80;
export const INBOX_ROW_GAP = 8;
export const INBOX_WINDOW_OVERSCAN = 4;
export const INBOX_WINDOWING_THRESHOLD = 40;
export const DEFAULT_INBOX_VIEWPORT_HEIGHT = 640;

export type InboxRowWindow = {
  startIndex: number;
  endIndex: number;
};

export function getInboxRowWindow({
  itemCount,
  scrollOffset,
  viewportSize,
  listOffset = 0,
  rowHeight = INBOX_ROW_HEIGHT,
  overscan = INBOX_WINDOW_OVERSCAN
}: {
  itemCount: number;
  scrollOffset: number;
  viewportSize: number;
  listOffset?: number;
  rowHeight?: number;
  overscan?: number;
}): InboxRowWindow {
  const safeItemCount = Math.max(0, Math.floor(itemCount));
  if (safeItemCount === 0) return { startIndex: 0, endIndex: 0 };
  const safeRowHeight = Math.max(1, rowHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const safeViewportSize = Math.max(0, viewportSize);
  const maxScrollOffset = Math.max(0, safeItemCount * safeRowHeight - safeViewportSize);
  const relativeOffset = Math.min(maxScrollOffset, Math.max(0, scrollOffset - listOffset));
  const firstVisibleIndex = Math.min(safeItemCount - 1, Math.floor(relativeOffset / safeRowHeight));
  const visibleRowCount = Math.max(1, Math.ceil(safeViewportSize / safeRowHeight));
  const startIndex = Math.max(0, firstVisibleIndex - safeOverscan);
  const endIndex = Math.min(safeItemCount, firstVisibleIndex + visibleRowCount + safeOverscan);
  return { startIndex, endIndex };
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

function getPreferredConversationIdFromSearch(search: string) {
  const params = new URLSearchParams(search || '');
  return String(params.get('conversation') || params.get('conversationId') || '').trim();
}

export function getOpportunityInquiryIdFromSearch(search: string) {
  const params = new URLSearchParams(search || '');
  return String(params.get('inquiry') || '').trim();
}

export function getComposeRecipientFromSearch(search: string) {
  const params = new URLSearchParams(search || '');
  const id = String(params.get('compose') || '').trim();
  if (!/^user:[A-Za-z0-9_-]{1,160}$/.test(id)) return null;
  return {
    id,
    name: String(params.get('recipientName') || 'Friend').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Friend'
  };
}

function buildMessagesRoute(teamId: string, preferredConversationId?: string | null) {
  const normalizedTeamId = String(teamId || '').trim();
  if (!normalizedTeamId) return '/messages';
  const route = `/messages/${encodeURIComponent(normalizedTeamId)}`;
  const normalizedConversationId = String(preferredConversationId || '').trim();
  if (!normalizedConversationId) return route;
  return `${route}?conversationId=${encodeURIComponent(normalizedConversationId)}`;
}

export function mergeInboxTeams(nextTeams: ChatTeam[], previewUpdates: Map<string, ChatInboxPreviewUpdate>) {
  return sortInboxTeams(nextTeams.map((team) => {
    const previewUpdate = previewUpdates.get(team.id);
    if (!previewUpdate) return team;
    return {
      ...team,
      lastMessage: previewUpdate.lastMessage,
      preferredConversationId: previewUpdate.preferredConversationId,
      isMuted: previewUpdate.isMuted
    };
  }));
}

function updateInboxTeamMuteState(
  teams: ChatTeam[],
  teamId: string,
  conversationId: string,
  isMuted: boolean
) {
  const normalizedConversationId = String(conversationId || DEFAULT_TEAM_CONVERSATION_ID).trim() || DEFAULT_TEAM_CONVERSATION_ID;
  let changed = false;
  const nextTeams = teams.map((team) => {
    if (team.id !== teamId) return team;
    changed = true;
    return {
      ...team,
      preferredConversationId: isDefaultTeamConversation(normalizedConversationId) ? null : normalizedConversationId,
      isMuted
    };
  });
  return changed ? nextTeams : teams;
}

function sortInboxTeams(teams: ChatTeam[]) {
  return [...teams].sort((a, b) => {
    const aTime = toInboxSortTime(a.lastMessage);
    const bTime = toInboxSortTime(b.lastMessage);
    if (aTime !== bTime) return bTime - aTime;
    return a.name.localeCompare(b.name);
  });
}

function toInboxSortTime(message: ChatMessage | null | undefined) {
  if (!message?.createdAt) return 0;
  if (message.createdAt instanceof Date) return message.createdAt.getTime();
  if (typeof (message.createdAt as any)?.toDate === 'function') {
    const date = (message.createdAt as any).toDate();
    return date instanceof Date ? date.getTime() : 0;
  }
  if (typeof (message.createdAt as any)?.seconds === 'number') {
    return Number((message.createdAt as any).seconds || 0) * 1000;
  }
  const date = new Date(message.createdAt as any);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
