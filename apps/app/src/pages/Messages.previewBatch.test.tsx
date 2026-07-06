// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Messages } from './Messages';
import type { ChatInboxPreviewUpdate, ChatTeam } from '../lib/chatService';
import type { AuthState } from '../lib/types';
import type { ReactNode } from 'react';

const chatServiceMocks = vi.hoisted(() => ({
  getChatInboxPreview: vi.fn((message: any) => message ? `${message.senderName}: ${message.text}` : 'No messages yet'),
  loadChatInbox: vi.fn()
}));

vi.mock('../lib/chatService', () => chatServiceMocks);
vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktopWeb: false })
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
  ChatWindow: () => <div>Chat window</div>,
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
    chatServiceMocks.loadChatInbox.mockReset();
    chatServiceMocks.getChatInboxPreview.mockClear();
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
    expect(screen.getByPlaceholderText('Search team chats')).toBeEnabled();

    await waitFor(() => expect(screen.getByRole('link', { name: /Bears/ })).toHaveTextContent('Coach Jamie: Practice packet is posted.'));
    expect(screen.getByRole('link', { name: /Thunder/ })).toHaveTextContent('Coach Jamie: Tournament schedule changed.');
    expect(screen.getByRole('link', { name: /Falcons/ })).toHaveTextContent('Coach Jamie: Lineup card is ready.');
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
});
