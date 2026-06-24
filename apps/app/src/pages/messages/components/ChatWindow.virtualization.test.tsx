// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../lib/chatService';
import type { AuthState } from '../../../lib/types';
import { ChatWindow, buildVirtualizedChatWindow } from './ChatWindow';

const liveMessages = Array.from({ length: 220 }, (_, index) => buildMessage(`live-${index + 1}`, index + 101));
const olderPage = Array.from({ length: 50 }, (_, index) => buildMessage(`older-${index + 1}`, index + 1));

let scrollHeightValue = 2400;
let contentScrollHeightValue = 2400;

function buildMessage(id: string, seconds: number): ChatMessage {
  return {
    id,
    text: `Message ${id}`,
    senderId: seconds % 2 ? 'coach-1' : 'parent-1',
    senderName: seconds % 2 ? 'Coach Jamie' : 'Pat Parent',
    senderEmail: 'coach@example.com',
    createdAt: { seconds },
    reactions: {},
    deleted: false
  } as ChatMessage;
}

vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    Archive: Icon,
    BellOff: Icon,
    Bot: Icon,
    Camera: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    Copy: Icon,
    Download: Icon,
    Edit3: Icon,
    ImageIcon: Icon,
    Link2: Icon,
    Loader2: Icon,
    Mail: Icon,
    MessageCircle: Icon,
    MoreVertical: Icon,
    RefreshCw: Icon,
    Share2: Icon,
    ShieldCheck: Icon,
    Smile: Icon,
    Trash2: Icon,
    Video: Icon,
    X: Icon
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>
  };
});

vi.mock('../../../components/PageSkeletons', () => ({
  MessagesPageSkeleton: () => <div>Loading</div>
}));

vi.mock('../../../lib/publicActions', () => ({
  sharePublicUrl: vi.fn()
}));

vi.mock('../../../lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktopWeb: false })
}));

vi.mock('../../../lib/voiceService', () => ({
  voiceRecognition: {
    isNativeRuntime: () => false,
    hasBrowserSupport: () => false
  }
}));

vi.mock('../../../lib/chatService', () => ({
  deleteTeamChatMessage: vi.fn(),
  editTeamChatMessage: vi.fn(),
  ensureStaffChatConversation: vi.fn(),
  loadChatRecipientOptions: vi.fn().mockResolvedValue([]),
  loadSentTeamEmails: vi.fn().mockResolvedValue([]),
  loadTeamEmailDrafts: vi.fn().mockResolvedValue([]),
  loadTeamEmailTemplates: vi.fn().mockResolvedValue([]),
  markTeamChatRead: vi.fn(),
  muteTeamChat: vi.fn().mockResolvedValue(true),
  unmuteTeamChat: vi.fn().mockResolvedValue(true),
  saveTeamEmailDraft: vi.fn(),
  saveTeamEmailTemplate: vi.fn(),
  sendAllPlaysChatAnswer: vi.fn(),
  sendTeamChatMessage: vi.fn(),
  sendTeamEmailMessage: vi.fn(),
  toggleTeamChatReaction: vi.fn()
}));

vi.mock('../hooks/useChatSheets', () => ({
  useChatSheets: () => ({
    showConversationSheet: false,
    showAudienceSheet: false,
    showMediaGallery: false,
    showAttachSheet: false,
    showLinkSheet: false,
    showEmailSheet: false,
    openConversationSheet: vi.fn(),
    closeConversationSheet: vi.fn(),
    openAudienceSheet: vi.fn(),
    closeAudienceSheet: vi.fn(),
    openMediaGallery: vi.fn(),
    closeMediaGallery: vi.fn(),
    openAttachSheet: vi.fn(),
    closeAttachSheet: vi.fn(),
    openLinkSheet: vi.fn(),
    closeLinkSheet: vi.fn(),
    openEmailSheet: vi.fn(),
    closeEmailSheet: vi.fn()
  })
}));

vi.mock('../hooks/useChatTeam', () => ({
  useChatTeam: () => ({
    team: { id: 'team-1', name: 'Bears' },
    profile: { fullName: 'Pat Parent' },
    canModerate: true,
    conversations: [{ id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] }],
    setConversations: vi.fn(),
    selectedConversationId: 'team',
    setSelectedConversationId: vi.fn(),
    loadingContext: false,
    error: null,
    reloadConversations: vi.fn(),
    switchConversation: vi.fn(() => true)
  })
}));

vi.mock('../hooks/useChatMessages', async () => {
  const React = await import('react');
  return {
    useChatMessages: () => {
      const [olderMessages, setOlderMessages] = React.useState<ChatMessage[]>([]);
      const [loadingOlder, setLoadingOlder] = React.useState(false);
      return {
        messages: [...olderMessages, ...liveMessages],
        olderMessages,
        hasMoreMessages: true,
        loadingMessages: false,
        loadingOlder,
        error: null,
        loadOlderMessages: async () => {
          setLoadingOlder(true);
          scrollHeightValue = 3000;
          contentScrollHeightValue = 3000;
          await Promise.resolve();
          setOlderMessages(olderPage);
          setLoadingOlder(false);
        },
        initialSnapshotLoadedRef: { current: true }
      };
    }
  };
});

vi.mock('./ChatComposer', () => ({
  Composer: () => <div className="chat-composer">Composer</div>
}));

const auth: AuthState = {
  user: {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent'
  } as any,
  profile: {},
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

describe('ChatWindow virtualization', () => {
  beforeEach(() => {
    scrollHeightValue = 2400;
    contentScrollHeightValue = 2400;
    vi.stubGlobal('ResizeObserver', MockResizeObserver as any);
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    });
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.classList.contains('chat-messages-scroll') ? 480 : 0;
      }
    });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        if (this.classList.contains('chat-messages-scroll')) return scrollHeightValue;
        if (this.classList.contains('chat-messages-content')) return contentScrollHeightValue;
        return 0;
      }
    });
    Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        if (this.classList.contains('message-row-measure')) return 96;
        return 24;
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('returns a bounded render slice and spacer heights for long message lists', () => {
    const messages = Array.from({ length: 6 }, (_, index) => buildMessage(`message-${index + 1}`, index + 1));
    const windowed = buildVirtualizedChatWindow(messages, {
      scrollTop: 230,
      viewportHeight: 180,
      overscanPx: 50,
      measuredHeights: {
        'message-1': 100,
        'message-2': 110,
        'message-3': 120,
        'message-4': 130,
        'message-5': 140,
        'message-6': 150
      }
    });

    expect(windowed.visibleMessages.map((message) => message.id)).toEqual(['message-2', 'message-3', 'message-4']);
    expect(windowed.topSpacerHeight).toBe(132);
    expect(windowed.bottomSpacerHeight).toBe(290);
  });

  it('keeps modest threads fully rendered until the initial scroll settles at the latest message', () => {
    const messages = Array.from({ length: 6 }, (_, index) => buildMessage(`message-${index + 1}`, index + 1));
    const windowed = buildVirtualizedChatWindow(messages, {
      scrollTop: 0,
      viewportHeight: 180
    });

    expect(windowed.visibleMessages.map((message) => message.id)).toEqual([
      'message-1',
      'message-2',
      'message-3',
      'message-4',
      'message-5',
      'message-6'
    ]);
    expect(windowed.topSpacerHeight).toBe(0);
    expect(windowed.bottomSpacerHeight).toBe(0);
  });

  it('falls back to the oldest window when prepended history loads before viewport sizing is available', () => {
    const messages = Array.from({ length: 6 }, (_, index) => buildMessage(`message-${index + 1}`, index + 1));
    const windowed = buildVirtualizedChatWindow(messages, {
      scrollTop: 0,
      viewportHeight: 0,
      initialWindowCount: 3,
      preferTopWindow: true
    });

    expect(windowed.visibleMessages.map((message) => message.id)).toEqual(['message-1', 'message-2', 'message-3']);
    expect(windowed.topSpacerHeight).toBe(0);
    expect(windowed.bottomSpacerHeight).toBeGreaterThan(0);
  });

  it('keeps mounted message bubbles bounded below the full thread size', () => {
    const { container } = render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    const bubbleCount = container.querySelectorAll('.message-bubble').length;
    expect(bubbleCount).toBeGreaterThan(0);
    expect(bubbleCount).toBeLessThan(100);
    expect(bubbleCount).toBeLessThan(liveMessages.length);
  });

  it('preserves the scroll anchor when older history loads above the current viewport', async () => {
    const { container, getByRole } = render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    const thread = container.querySelector('.chat-messages-scroll') as HTMLDivElement;
    expect(thread).toBeTruthy();
    thread.scrollTop = 120;
    fireEvent.scroll(thread);

    fireEvent.click(getByRole('button', { name: 'Load older messages' }));

    await waitFor(() => {
      expect(thread.scrollTop).toBe(720);
    });
  });
});
