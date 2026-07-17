// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Messages } from './Messages';
import type { ChatInboxPreviewUpdate, ChatTeam } from '../lib/chatService';
import type { OpportunityInquiry } from '../lib/opportunityLogic';
import type { AuthState } from '../lib/types';
import type { ReactNode } from 'react';

const chatServiceMocks = vi.hoisted(() => ({
  getChatInboxPreview: vi.fn((message: any) => message ? `${message.senderName}: ${message.text}` : 'No messages yet'),
  loadChatInbox: vi.fn()
}));
const layoutMocks = vi.hoisted(() => ({ isDesktopWeb: false }));
const opportunityMocks = vi.hoisted(() => ({
  listOpportunityInquiries: vi.fn().mockResolvedValue({ items: [], nextCursor: null })
}));

vi.mock('../lib/chatService', () => chatServiceMocks);
vi.mock('../lib/opportunityService', () => opportunityMocks);
vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktopWeb: layoutMocks.isDesktopWeb })
}));
vi.mock('../lib/useRefreshOnResume', () => ({
  useRefreshOnResume: vi.fn()
}));
vi.mock('../lib/uxTiming', () => ({
  startScreenMountTimer: vi.fn(() => ({ end: vi.fn() }))
}));
vi.mock('../lib/parentWorkflowTiming', () => ({
  completeParentCoreWorkflowTimer: vi.fn()
}));
vi.mock('../components/PageSkeletons', () => ({
  MessagesPageSkeleton: () => <div>Loading messages inbox</div>
}));
vi.mock('../components/PullToRefresh', () => ({
  PullToRefresh: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));
vi.mock('./messages/components/ChatWindow', () => ({
  ChatWindow: ({ teamId }: { teamId: string }) => <div data-testid="chat-window-team">Chat window {teamId}</div>,
  TeamAvatar: ({ team }: { team: ChatTeam }) => <div aria-hidden="true">{team.name.slice(0, 1)}</div>,
  MessageAvatar: () => null,
  StatusBanner: () => null,
  buildChatViewportSignature: vi.fn(),
  isSelectedConversation: vi.fn(),
  mergeVisibleChatMessages: vi.fn(),
  normalizeConversationId: vi.fn()
}));

const auth: AuthState = {
  user: {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    roles: ['parent']
  },
  profile: {},
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: async () => null,
  signOut: async () => {}
};

function team(overrides: Partial<ChatTeam> = {}): ChatTeam {
  return {
    id: overrides.id || 'team-1',
    name: overrides.name || 'Bears',
    sport: overrides.sport || 'Basketball',
    photoUrl: overrides.photoUrl || null,
    active: overrides.active ?? true,
    role: overrides.role || 'Admin',
    canModerate: overrides.canModerate ?? true,
    unreadCount: overrides.unreadCount ?? 0,
    lastMessage: overrides.lastMessage ?? null,
    preferredConversationId: overrides.preferredConversationId ?? null,
    isMuted: overrides.isMuted ?? false
  };
}

function preview(teamId: string, text: string, createdAt: string): ChatInboxPreviewUpdate {
  return {
    teamId,
    lastMessage: {
      id: `${teamId}-${text}`,
      text,
      senderId: 'coach-1',
      senderName: 'Coach Jamie',
      senderEmail: 'coach@example.com',
      createdAt: new Date(createdAt),
      reactions: {},
      deleted: false
    },
    preferredConversationId: null,
    isMuted: false
  };
}

function opportunityInquiry(overrides: Partial<OpportunityInquiry> = {}): OpportunityInquiry {
  return {
    id: overrides.id || 'inquiry-1',
    listingId: overrides.listingId || 'opportunity-1',
    listingTitle: overrides.listingTitle || 'Need a tournament opponent',
    listingKind: overrides.listingKind || 'coach_or_staff',
    teamId: overrides.teamId || 'team-1',
    participantIds: overrides.participantIds || ['user-1', 'coach-1', 'owner-1'],
    status: overrides.status || 'open',
    lastMessagePreview: overrides.lastMessagePreview || 'Could we play Saturday morning?',
    lastMessageAuthorName: overrides.lastMessageAuthorName || 'Pat Parent',
    createdAt: overrides.createdAt ?? '2026-06-15T02:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-15T03:00:00.000Z',
    messages: overrides.messages || []
  };
}

function renderMessages() {
  return render(
    <MemoryRouter initialEntries={['/messages']}>
      <Messages auth={auth} />
    </MemoryRouter>
  );
}

describe('Messages deferred inbox preview batching', () => {
  beforeEach(() => {
    vi.useRealTimers();
    layoutMocks.isDesktopWeb = false;
    chatServiceMocks.loadChatInbox.mockReset();
    chatServiceMocks.getChatInboxPreview.mockClear();
    opportunityMocks.listOpportunityInquiries.mockReset();
    opportunityMocks.listOpportunityInquiries.mockResolvedValue({ items: [], nextCursor: null });
    window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16);
    window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders placeholder inbox rows, then hydrates a burst of deferred previews through the batch flush', async () => {
    chatServiceMocks.loadChatInbox.mockImplementation(async (_user, options) => {
      window.setTimeout(() => {
        options.onPreview(preview('team-1', 'Practice packet is posted.', '2026-06-15T04:00:00Z'));
        options.onPreview(preview('team-2', 'Tournament schedule changed.', '2026-06-15T03:00:00Z'));
        options.onPreview(preview('team-3', 'Lineup card is ready.', '2026-06-15T02:00:00Z'));
      }, 0);
      return {
        teams: [
          team({ id: 'team-1', name: 'Bears' }),
          team({ id: 'team-2', name: 'Thunder', role: 'Parent', canModerate: false }),
          team({ id: 'team-3', name: 'Falcons', role: 'Coach' })
        ]
      };
    });

    renderMessages();

    expect(await screen.findByRole('link', { name: /Bears/ })).toHaveTextContent('No messages yet');
    expect(screen.getByRole('button', { name: 'Refresh messages' })).toBeEnabled();
    expect(screen.getByPlaceholderText('Search conversations')).toBeEnabled();

    await waitFor(() => expect(screen.getByRole('link', { name: /Bears/ })).toHaveTextContent('Coach Jamie: Practice packet is posted.'));
    expect(screen.getByRole('link', { name: /Thunder/ })).toHaveTextContent('Coach Jamie: Tournament schedule changed.');
    expect(screen.getByRole('link', { name: /Falcons/ })).toHaveTextContent('Coach Jamie: Lineup card is ready.');
  });

  it('surfaces private opportunity threads beside team chats', async () => {
    chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: [team()] });
    opportunityMocks.listOpportunityInquiries.mockResolvedValue({
      items: [opportunityInquiry()],
      nextCursor: null
    });

    renderMessages();

    expect(await screen.findByRole('link', { name: /Need a tournament opponent/ })).toHaveAttribute(
      'href',
      '/messages?inquiry=inquiry-1'
    );
    expect(screen.getByRole('link', { name: /Need a tournament opponent/ })).toHaveTextContent(
      'Pat Parent: Could we play Saturday morning?'
    );
    expect(screen.getByText(/1 team chat · 1 opportunity/)).toBeInTheDocument();
  });

  it('does not apply stale buffered previews after a newer inbox refresh supersedes the request', async () => {
    chatServiceMocks.loadChatInbox
      .mockImplementationOnce(async (_user, options) => {
        window.setTimeout(() => {
          options.onPreview(preview('team-1', 'Stale older request preview.', '2026-06-15T05:00:00Z'));
        }, 25);
        return { teams: [team({ id: 'team-1', name: 'Bears' })] };
      })
      .mockImplementationOnce(async (_user, options) => {
        window.setTimeout(() => {
          options.onPreview(preview('team-1', 'Current request preview.', '2026-06-15T04:00:00Z'));
        }, 0);
        return { teams: [team({ id: 'team-1', name: 'Bears' })] };
      });

    renderMessages();

    expect(await screen.findByRole('link', { name: /Bears/ })).toHaveTextContent('No messages yet');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh messages' }));

    await waitFor(() => expect(screen.getByRole('link', { name: /Bears/ })).toHaveTextContent('Coach Jamie: Current request preview.'));
    await new Promise((resolve) => window.setTimeout(resolve, 60));

    expect(screen.getByRole('link', { name: /Bears/ })).toHaveTextContent('Coach Jamie: Current request preview.');
    expect(screen.getByRole('link', { name: /Bears/ })).not.toHaveTextContent('Stale older request preview.');
  });

  it('does not show an older inquiry failure after a newer inbox refresh succeeds', async () => {
    let rejectStaleInquiry!: (reason: Error) => void;
    const staleInquiryRequest = new Promise<never>((_resolve, reject) => {
      rejectStaleInquiry = reject;
    });
    chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: [team()] });
    opportunityMocks.listOpportunityInquiries
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockReturnValueOnce(staleInquiryRequest)
      .mockResolvedValueOnce({ items: [], nextCursor: null });

    renderMessages();
    expect(await screen.findByRole('link', { name: /Bears/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh messages' }));
    await waitFor(() => expect(opportunityMocks.listOpportunityInquiries).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh messages' }));
    await waitFor(() => expect(opportunityMocks.listOpportunityInquiries).toHaveBeenCalledTimes(3));

    await act(async () => {
      rejectStaleInquiry(new Error('Stale opportunity failure.'));
      await staleInquiryRequest.catch(() => undefined);
    });

    expect(screen.queryByText('Stale opportunity failure.')).not.toBeInTheDocument();
  });
});

describe('Messages inbox windowing', () => {
  beforeEach(() => {
    vi.useRealTimers();
    layoutMocks.isDesktopWeb = false;
    chatServiceMocks.loadChatInbox.mockReset();
    chatServiceMocks.getChatInboxPreview.mockClear();
    opportunityMocks.listOpportunityInquiries.mockReset();
    opportunityMocks.listOpportunityInquiries.mockResolvedValue({ items: [], nextCursor: null });
    window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0);
    window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
  });

  afterEach(() => {
    cleanup();
  });

  function largeInbox() {
    return Array.from({ length: 250 }, (_, index) => {
      const number = String(index + 1).padStart(3, '0');
      return team({ id: `team-${number}`, name: `Team ${number}` });
    });
  }

  it('bounds a 250-team DOM while preserving offscreen search links and empty states', async () => {
    chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: largeInbox() });
    renderMessages();

    expect(await screen.findByRole('link', { name: /Team 001/ })).toHaveAttribute('href', '/messages/team-001');
    expect(document.querySelectorAll('.message-row').length).toBeLessThan(60);
    expect(screen.getByText(/250 team chats/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search conversations'), { target: { value: 'Team 250' } });
    const offscreenTeam = await screen.findByRole('link', { name: /Team 250/ });
    expect(offscreenTeam).toHaveAttribute('href', '/messages/team-250');
    expect(document.querySelectorAll('.message-row')).toHaveLength(1);

    fireEvent.change(screen.getByPlaceholderText('Search conversations'), { target: { value: 'not a real team' } });
    expect(await screen.findByText('No team chats match “not a real team”')).toBeInTheDocument();
    expect(screen.getByText(/250 team chats/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(document.querySelectorAll('.message-row').length).toBeGreaterThan(0));
    expect(document.querySelectorAll('.message-row').length).toBeLessThan(60);
  });

  it('keeps desktop two-pane selection working for a team found outside the initial window', async () => {
    layoutMocks.isDesktopWeb = true;
    chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: largeInbox() });
    renderMessages();

    expect(await screen.findByTestId('chat-window-team')).toHaveTextContent('team-001');
    expect(document.querySelectorAll('.message-row').length).toBeLessThan(60);

    fireEvent.change(screen.getByPlaceholderText('Search conversations'), { target: { value: 'Team 250' } });
    const offscreenTeam = await screen.findByRole('link', { name: /Team 250/ });
    expect(offscreenTeam).toHaveAttribute('href', '/messages/team-250');
    fireEvent.click(offscreenTeam);

    await waitFor(() => expect(screen.getByTestId('chat-window-team')).toHaveTextContent('team-250'));
    expect(document.querySelectorAll('.message-row')).toHaveLength(1);
  });

  it('provides keyboard navigation to desktop teams outside the rendered window', async () => {
    layoutMocks.isDesktopWeb = true;
    chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: largeInbox() });
    renderMessages();

    const inboxWindow = await screen.findByTestId('messages-inbox-window');
    expect(inboxWindow).toHaveAttribute('tabindex', '0');
    expect(inboxWindow).toHaveAccessibleName(/Use the Up and Down Arrow, Home, and End keys/i);
    inboxWindow.focus();

    expect(fireEvent.keyDown(inboxWindow, { key: 'End' })).toBe(false);
    const lastTeam = await screen.findByRole('link', { name: /Team 250/ });
    await waitFor(() => expect(lastTeam).toHaveFocus());
    expect(lastTeam).toHaveAttribute('href', '/messages/team-250');

    fireEvent.keyDown(lastTeam, { key: 'ArrowUp' });
    const previousTeam = await screen.findByRole('link', { name: /Team 249/ });
    await waitFor(() => expect(previousTeam).toHaveFocus());

    fireEvent.keyDown(previousTeam, { key: 'Home' });
    const firstTeam = await screen.findByRole('link', { name: /Team 001/ });
    await waitFor(() => expect(firstTeam).toHaveFocus());
  });

  it('removes the compact scroll listener from the mounted container during unmount cleanup', async () => {
    layoutMocks.isDesktopWeb = true;
    chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: largeInbox() });
    const originalAddEventListener = HTMLElement.prototype.addEventListener;
    const originalRemoveEventListener = HTMLElement.prototype.removeEventListener;
    const addedScrollTargets: HTMLElement[] = [];
    const removedScrollTargets: HTMLElement[] = [];
    const addSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener').mockImplementation(function (
      this: HTMLElement,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) {
      if (type === 'scroll' && this.classList.contains('messages-list-scroll')) {
        addedScrollTargets.push(this);
      }
      return originalAddEventListener.call(this, type, listener, options);
    });
    const removeSpy = vi.spyOn(HTMLElement.prototype, 'removeEventListener').mockImplementation(function (
      this: HTMLElement,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions
    ) {
      if (type === 'scroll' && this.classList.contains('messages-list-scroll')) {
        removedScrollTargets.push(this);
      }
      return originalRemoveEventListener.call(this, type, listener, options);
    });

    try {
      const { unmount } = renderMessages();
      expect(await screen.findByTestId('messages-inbox-window')).toBeInTheDocument();
      expect(addedScrollTargets).toHaveLength(1);

      unmount();

      expect(removedScrollTargets).toContain(addedScrollTargets[0]);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
