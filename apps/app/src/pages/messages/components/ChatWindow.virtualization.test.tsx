// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureStaffChatConversation, type ChatConversation, type ChatMessage } from '../../../lib/chatService';
import type { AuthState } from '../../../lib/types';
import {
  AudienceSheet,
  ChatWindow,
  areMessagesEquivalent,
  getMessageRevisionSignature,
  getSafeMessageAttachments,
  buildVirtualizedChatLayout,
  buildVirtualizedChatWindow,
  buildVirtualizedChatWindowFromLayout
} from './ChatWindow';

const mockRouter = vi.hoisted(() => ({
  navigate: vi.fn()
}));
const teamEmailSheetMocks = vi.hoisted(() => ({
  importModule: vi.fn(),
  render: vi.fn()
}));
const normalizeChatReactionsSpy = vi.fn();
const getMessageAttachmentsSpy = vi.fn();
const mockShellLayoutState = { isDesktopWeb: false };
type MockActiveChatSheet = 'conversation' | 'audience' | 'media' | 'attach' | 'link' | 'email' | null;
let useStatefulChatSheets = false;
let mockThreadLoadScenario: 'normal' | 'retrySuccess' = 'normal';
const mockChatSheetsState = {
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
};
const mockChatTeamState: {
  team: { id: string; name: string };
  profile: { fullName: string };
  canModerate: boolean;
  conversations: ChatConversation[];
  setConversations: ReturnType<typeof vi.fn>;
  selectedConversationId: string;
  setSelectedConversationId: ReturnType<typeof vi.fn>;
  loadingContext: boolean;
  error: string | null;
  reloadConversations: ReturnType<typeof vi.fn>;
  switchConversation: ReturnType<typeof vi.fn>;
} = {
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
};

vi.mock('../../../lib/chatLogic', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/chatLogic')>('../../../lib/chatLogic');
  return {
    ...actual,
    normalizeChatReactions: vi.fn((message: any) => {
      normalizeChatReactionsSpy(message);
      return actual.normalizeChatReactions(message);
    }),
    getMessageAttachments: vi.fn((message: any) => {
      getMessageAttachmentsSpy(message);
      return actual.getMessageAttachments(message);
    })
  };
});

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
    useNavigate: () => mockRouter.navigate,
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
  useShellLayout: () => mockShellLayoutState
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

vi.mock('./TeamEmailSheet', async () => {
  const React = await import('react');
  teamEmailSheetMocks.importModule();
  return {
    default: (props: { open: boolean }) => {
      teamEmailSheetMocks.render(props.open);
      return props.open ? React.createElement('div', { role: 'dialog', 'aria-label': 'Team Email' }, 'Lazy Team Email Mock') : null;
    }
  };
});

vi.mock('../hooks/useChatSheets', async () => {
  const React = await import('react');
  const closeIfActive = (setActiveSheet: React.Dispatch<React.SetStateAction<MockActiveChatSheet>>, sheet: MockActiveChatSheet) => {
    setActiveSheet((current) => (current === sheet ? null : current));
  };

  return {
    useChatSheets: () => {
      const [activeSheet, setActiveSheet] = React.useState<MockActiveChatSheet>(null);
      if (!useStatefulChatSheets) {
        return mockChatSheetsState;
      }

      return {
        showConversationSheet: activeSheet === 'conversation',
        showAudienceSheet: activeSheet === 'audience',
        showMediaGallery: activeSheet === 'media',
        showAttachSheet: activeSheet === 'attach',
        showLinkSheet: activeSheet === 'link',
        showEmailSheet: activeSheet === 'email',
        openConversationSheet: () => setActiveSheet('conversation'),
        closeConversationSheet: () => closeIfActive(setActiveSheet, 'conversation'),
        openAudienceSheet: () => setActiveSheet('audience'),
        closeAudienceSheet: () => closeIfActive(setActiveSheet, 'audience'),
        openMediaGallery: () => setActiveSheet('media'),
        closeMediaGallery: () => closeIfActive(setActiveSheet, 'media'),
        openAttachSheet: () => setActiveSheet('attach'),
        closeAttachSheet: () => closeIfActive(setActiveSheet, 'attach'),
        openLinkSheet: () => setActiveSheet('link'),
        closeLinkSheet: () => closeIfActive(setActiveSheet, 'link'),
        openEmailSheet: () => setActiveSheet('email'),
        closeEmailSheet: () => closeIfActive(setActiveSheet, 'email')
      };
    }
  };
});

vi.mock('../hooks/useChatTeam', () => ({
  useChatTeam: () => mockChatTeamState
}));

vi.mock('../hooks/useChatMessages', async () => {
  const React = await import('react');
  return {
    getChatMessagesErrorMessage: (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      return /missing or insufficient permissions/i.test(message)
        ? "We couldn't open this conversation. Your team access may have changed."
        : (message || 'Unable to load chat messages.');
    },
    useChatMessages: () => {
      const [phase, setPhase] = React.useState<'error' | 'loading' | 'ready'>('error');
      const [olderMessages, setOlderMessages] = React.useState<ChatMessage[]>([]);
      const [loadingOlder, setLoadingOlder] = React.useState(false);

      if (mockThreadLoadScenario === 'retrySuccess') {
        return {
          messages: phase === 'ready' ? [buildMessage('recovered-message', 999)] : [],
          olderMessages: [],
          hasMoreMessages: false,
          loadingMessages: phase === 'loading',
          loadingOlder: false,
          error: phase === 'error' ? 'Unable to load chat messages.' : null,
          retryMessages: () => {
            setPhase('loading');
            window.setTimeout(() => setPhase('ready'), 0);
          },
          loadOlderMessages: async () => {},
          initialSnapshotLoadedRef: { current: phase === 'ready' }
        };
      }

      return {
        messages: [...olderMessages, ...liveMessages],
        olderMessages,
        hasMoreMessages: true,
        loadingMessages: false,
        loadingOlder,
        error: null,
        retryMessages: () => {},
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

vi.mock('./ChatComposer', async () => {
  const React = await import('react');
  return {
    Composer: ({ canSendTeamEmail, onTeamEmail }: { canSendTeamEmail: boolean; onTeamEmail: () => void }) => {
      const [showStaffActions, setShowStaffActions] = React.useState(false);
      return (
        <div className="chat-composer">
          Composer
          {canSendTeamEmail ? (
            <>
              <button type="button" onClick={() => setShowStaffActions((current) => !current)} aria-label="Open staff actions">Staff actions</button>
              {showStaffActions ? (
                <button type="button" onClick={onTeamEmail} aria-label="Open Team Email">Team Email</button>
              ) : null}
            </>
          ) : null}
        </div>
      );
    }
  };
});

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

beforeEach(() => {
  useStatefulChatSheets = false;
  mockThreadLoadScenario = 'normal';
  mockRouter.navigate.mockReset();
  mockShellLayoutState.isDesktopWeb = false;
  mockChatSheetsState.showConversationSheet = false;
  mockChatSheetsState.showAudienceSheet = false;
  mockChatSheetsState.showMediaGallery = false;
  mockChatSheetsState.showAttachSheet = false;
  mockChatSheetsState.showLinkSheet = false;
  mockChatSheetsState.showEmailSheet = false;
  Object.values(mockChatSheetsState).forEach((value) => {
    if (typeof value === 'function' && 'mockReset' in value) {
      value.mockReset();
    }
  });
  mockChatTeamState.team = { id: 'team-1', name: 'Bears' };
  mockChatTeamState.profile = { fullName: 'Pat Parent' };
  mockChatTeamState.canModerate = true;
  mockChatTeamState.conversations = [{ id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] }];
  mockChatTeamState.selectedConversationId = 'team';
  mockChatTeamState.loadingContext = false;
  mockChatTeamState.error = null;
  mockChatTeamState.setConversations.mockReset();
  mockChatTeamState.setSelectedConversationId.mockReset();
  mockChatTeamState.reloadConversations.mockReset();
  mockChatTeamState.switchConversation.mockReset();
  mockChatTeamState.switchConversation.mockReturnValue(true);
  vi.mocked(ensureStaffChatConversation).mockReset();
  vi.mocked(ensureStaffChatConversation).mockResolvedValue({
    id: 'group_role%3Astaff',
    type: 'group',
    name: 'Staff only',
    participantIds: [],
    participantRoles: ['staff']
  } as ChatConversation);
  teamEmailSheetMocks.importModule.mockClear();
  teamEmailSheetMocks.render.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ChatWindow lazy Team Email loading', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver as any);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
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
        return 104;
      }
    });
  });

  it('does not render Team Email controls or import the lazy sheet for parents', () => {
    mockChatTeamState.canModerate = false;
    useStatefulChatSheets = true;

    render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: 'Open staff actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Team Email' })).not.toBeInTheDocument();
    expect(teamEmailSheetMocks.importModule).not.toHaveBeenCalled();
    expect(teamEmailSheetMocks.render).not.toHaveBeenCalled();
  });

  it('imports and renders the lazy Team Email sheet only after a coach opens it', async () => {
    mockChatTeamState.canModerate = true;
    useStatefulChatSheets = true;

    render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: 'Open staff actions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Team Email' })).not.toBeInTheDocument();
    expect(teamEmailSheetMocks.importModule).not.toHaveBeenCalled();
    expect(teamEmailSheetMocks.render).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open staff actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Team Email' }));

    await waitFor(() => expect(teamEmailSheetMocks.importModule).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Lazy Team Email Mock')).toBeInTheDocument();
    expect(teamEmailSheetMocks.render).toHaveBeenCalledWith(true);
  });
});

describe('ChatWindow virtualization', () => {
  beforeEach(() => {
    scrollHeightValue = 2400;
    contentScrollHeightValue = 2400;
    vi.stubGlobal('ResizeObserver', MockResizeObserver as any);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
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
    normalizeChatReactionsSpy.mockClear();
    getMessageAttachmentsSpy.mockClear();
  });

  it('recognizes unchanged message content without JSON serialization', () => {
    const previous = {
      ...buildMessage('message-1', 1),
      text: 'Same message',
      attachments: [{ type: 'image', url: 'https://example.com/a.png', name: 'a.png', mimeType: 'image/png', size: 128 }],
      reactions: { thumbs_up: ['user-1'], '👍': ['user-1'] },
      editedAt: { seconds: 5 }
    } as ChatMessage;
    const next = {
      ...previous,
      attachments: [{ type: 'image', url: 'https://example.com/a.png', name: 'a.png', mimeType: 'image/png', size: 128 }],
      reactions: { thumbs_up: ['user-1'] }
    } as ChatMessage;
    const stringifySpy = vi.spyOn(JSON, 'stringify');

    expect(areMessagesEquivalent(previous, next)).toBe(true);
    expect(stringifySpy).not.toHaveBeenCalled();

    stringifySpy.mockRestore();
  });

  it('includes attachment fields in the message revision signature', () => {
    const message = {
      ...buildMessage('message-with-attachment', 10),
      attachments: [{ type: 'image', url: 'https://example.com/a.png', name: 'a.png', mimeType: 'image/png', size: 128 }]
    } as ChatMessage;
    const changedAttachmentMessage = {
      ...message,
      attachments: [{ type: 'image', url: 'https://example.com/b.png', name: 'b.png', mimeType: 'image/png', size: 128 }]
    } as ChatMessage;

    expect(getMessageRevisionSignature(message)).not.toBe(getMessageRevisionSignature(changedAttachmentMessage));
  });

  it('filters message attachments to safe media urls', () => {
    const message = {
      ...buildMessage('message-with-attachment', 10),
      attachments: [
        { type: 'image', url: 'https://example.com/a.png', name: 'a.png', mimeType: 'image/png', size: 128 },
        { type: 'image', url: 'javascript:alert(1)', name: 'bad.png', mimeType: 'image/png', size: 128 }
      ]
    } as ChatMessage;

    expect(getSafeMessageAttachments(message)).toMatchObject([
      { type: 'image', url: 'https://example.com/a.png', name: 'a.png', mimeType: 'image/png', size: 128 }
    ]);
  });

  it('returns a bounded render slice and spacer heights for long message lists', () => {
    const messages = Array.from({ length: 60 }, (_, index) => buildMessage(`message-${index + 1}`, index + 1));
    const windowed = buildVirtualizedChatWindow(messages, {
      scrollTop: 230,
      viewportHeight: 180,
      overscanPx: 50,
      initialWindowCount: 10,
      measuredHeights: {
        'message-1': 100,
        'message-2': 110,
        'message-3': 120,
        'message-4': 130,
        'message-5': 140,
        'message-6': 150
      }
    });

    expect(windowed.visibleMessages.slice(0, 3).map((message) => message.id)).toEqual(['message-2', 'message-3', 'message-4']);
    expect(windowed.topSpacerHeight).toBe(132);
    expect(windowed.bottomSpacerHeight).toBeGreaterThan(0);
    expect(windowed.visibleMessages.length).toBeLessThan(messages.length);
  });

  it('keeps modest threads fully rendered even after the thread auto-scrolls to the latest message', () => {
    const messages = Array.from({ length: 6 }, (_, index) => buildMessage(`message-${index + 1}`, index + 1));
    const windowed = buildVirtualizedChatWindow(messages, {
      scrollTop: 240,
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

  it('reuses precomputed offsets for scroll-only window updates and rebuilds layout only when inputs change', () => {
    const messages = Array.from({ length: 220 }, (_, index) => buildMessage(`message-${index + 1}`, index + 1));
    const measuredHeights = {
      'message-1': 132,
      'message-2': 148,
      'message-3': 124,
      'message-4': 156
    };

    const cachedLayout = buildVirtualizedChatLayout(messages, measuredHeights);
    const firstWindow = buildVirtualizedChatWindowFromLayout(messages, cachedLayout, {
      scrollTop: 0,
      viewportHeight: 320,
      overscanPx: 0
    });
    const scrolledWindow = buildVirtualizedChatWindowFromLayout(messages, cachedLayout, {
      scrollTop: 1400,
      viewportHeight: 320,
      overscanPx: 0
    });

    expect(scrolledWindow.startIndex).toBeGreaterThan(firstWindow.startIndex);
    expect(cachedLayout.offsets[firstWindow.startIndex]).toBe(firstWindow.topSpacerHeight);
    expect(cachedLayout.offsets[scrolledWindow.startIndex]).toBe(scrolledWindow.topSpacerHeight);

    const updatedHeightLayout = buildVirtualizedChatLayout(messages, {
      ...measuredHeights,
      'message-1': 180
    });
    const prependedLayout = buildVirtualizedChatLayout([buildMessage('message-0', 0), ...messages], measuredHeights);

    expect(updatedHeightLayout.totalHeight).toBeGreaterThan(cachedLayout.totalHeight);
    expect(prependedLayout.totalHeight).toBeGreaterThan(cachedLayout.totalHeight);
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

  it('offers in-place retry for a failed message subscription and keeps back navigation available', async () => {
    mockThreadLoadScenario = 'retrySuccess';
    render(
      <MemoryRouter initialEntries={['/messages/team-1']}>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    expect(screen.getByText('Unable to load chat messages.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to messages' }));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/messages');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Loading messages...')).toBeVisible();
    await waitFor(() => expect(screen.getByText('Message recovered-message')).toBeVisible());
    expect(screen.getByText('Composer')).toBeVisible();
    expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
  });

  it('returns an errored staff conversation to the team thread in place', () => {
    mockThreadLoadScenario = 'retrySuccess';
    mockChatTeamState.selectedConversationId = 'group_role%3Astaff';
    mockChatTeamState.conversations = [
      { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] },
      { id: 'group_role%3Astaff', type: 'group', name: 'Staff only', participantIds: [], participantRoles: ['staff'] }
    ];
    render(
      <MemoryRouter initialEntries={['/messages/team-1']}>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to messages' }));

    expect(mockChatTeamState.switchConversation).toHaveBeenCalledWith('team');
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('replaces an open conversation sheet when the media gallery opens', async () => {
    useStatefulChatSheets = true;
    render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /^Team chat$/ }));
    expect(screen.getByRole('dialog', { name: 'Conversations' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Open photos and videos' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Photos & videos' })).toBeVisible();
    });
    expect(screen.queryByRole('dialog', { name: 'Conversations' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
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

  it('keeps long-thread rendering bounded across repeated scroll-only updates', async () => {
    const { container } = render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    const thread = container.querySelector('.chat-messages-scroll') as HTMLDivElement;
    expect(thread).toBeTruthy();

    for (const scrollTop of [180, 420, 760]) {
      thread.scrollTop = scrollTop;
      fireEvent.scroll(thread);
      await waitFor(() => {
        const bubbleCount = container.querySelectorAll('.message-bubble').length;
        expect(bubbleCount).toBeGreaterThan(0);
        expect(bubbleCount).toBeLessThan(100);
      });
    }
  });

  it('avoids JSON serialization during scroll-only viewport updates for unchanged bubbles', async () => {
    const { container } = render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    const thread = container.querySelector('.chat-messages-scroll') as HTMLDivElement;
    expect(thread).toBeTruthy();

    thread.scrollTop = 180;
    fireEvent.scroll(thread);

    await waitFor(() => {
      expect(container.querySelectorAll('.message-bubble').length).toBeGreaterThan(0);
    });

    const stringifySpy = vi.spyOn(JSON, 'stringify');

    for (const scrollTop of [181, 182, 183]) {
      thread.scrollTop = scrollTop;
      fireEvent.scroll(thread);
      await waitFor(() => {
        expect(container.querySelectorAll('.message-bubble').length).toBeGreaterThan(0);
      });
    }

    expect(stringifySpy).not.toHaveBeenCalled();

    stringifySpy.mockRestore();
  });
});

describe('ChatWindow deferred conversation hydration', () => {
  it('renders the active thread before conversations finish hydrating and keeps it visible afterward', async () => {
    mockChatTeamState.loadingContext = false;
    mockChatTeamState.conversations = [];
    mockChatTeamState.selectedConversationId = 'team';

    const { rerender } = render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    expect(screen.getByText('Composer')).toBeVisible();
    expect(document.querySelectorAll('.message-bubble').length).toBeGreaterThan(0);
    expect(screen.queryByText('Loading')).toBeNull();

    mockChatTeamState.conversations = [
      { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] },
      { id: 'staff-conversation', type: 'group', name: 'Staff only', participantIds: ['coach-1'], participantRoles: ['staff'] }
    ];

    rerender(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    await waitFor(() => expect(document.querySelectorAll('.message-bubble').length).toBeGreaterThan(0));
    expect(screen.getByText('Composer')).toBeVisible();
    expect(screen.queryByText('Loading')).toBeNull();
  });
});

describe('ChatWindow conversation switching', () => {
  it('repairs an existing staff conversation before quick-switching to it', async () => {
    mockChatTeamState.conversations = [
      { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] },
      { id: 'staff-conversation', type: 'group', name: 'Staff only', participantIds: ['coach-1'], participantRoles: ['staff', 'coach'] },
      { id: 'direct-parent', type: 'direct', name: 'Pat Parent', participantIds: ['parent-1'], participantRoles: ['parent'] },
      { id: 'travel-group', type: 'group', name: 'Tournament travel', participantIds: ['coach-1', 'parent-1'], participantRoles: ['staff', 'parent'] }
    ];
    vi.mocked(ensureStaffChatConversation).mockResolvedValue({
      id: 'group_role%3Astaff',
      type: 'group',
      name: 'Staff only',
      participantIds: [],
      participantRoles: ['staff']
    } as ChatConversation);

    render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    const quickSwitcher = screen.getByTestId('mobile-conversation-chips');
    expect(quickSwitcher.classList.contains('overflow-x-auto')).toBe(true);
    expect(within(quickSwitcher).getAllByRole('button')).toHaveLength(4);
    expect(within(quickSwitcher).getByRole('button', { name: 'Switch to Team chat' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(quickSwitcher).getByRole('button', { name: 'Switch to Staff only' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('dialog', { name: 'Conversations' })).toBeNull();

    fireEvent.click(within(quickSwitcher).getByRole('button', { name: 'Switch to Staff only' }));

    await waitFor(() => expect(ensureStaffChatConversation).toHaveBeenCalledWith('team-1', auth.user, mockChatTeamState.conversations));
    expect(mockChatTeamState.switchConversation).toHaveBeenCalledWith('group_role%3Astaff');
    expect(mockChatSheetsState.openConversationSheet).not.toHaveBeenCalled();
  });

  it('repairs a preferred canonical staff conversation before enabling its subscription', async () => {
    mockChatTeamState.selectedConversationId = 'group_role%3Astaff';
    mockChatTeamState.conversations = [
      { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] },
      { id: 'group_role%3Astaff', type: 'group', name: 'Staff only', participantIds: ['coach-1'], participantRoles: ['staff', 'coach'] }
    ];

    render(
      <MemoryRouter initialEntries={['/messages/team-1?conversation=group_role%253Astaff']}>
        <ChatWindow auth={auth} teamId="team-1" preferredConversationId="group_role%3Astaff" />
      </MemoryRouter>
    );

    await waitFor(() => expect(ensureStaffChatConversation).toHaveBeenCalledWith(
      'team-1',
      auth.user,
      mockChatTeamState.conversations
    ));
    expect(mockChatTeamState.switchConversation).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('mobile-conversation-chips')).getAllByRole('button')).toHaveLength(2);
  });

  it('repairs the selected staff conversation again before retrying its subscription', async () => {
    mockThreadLoadScenario = 'retrySuccess';
    mockChatTeamState.selectedConversationId = 'group_role%3Astaff';
    mockChatTeamState.conversations = [
      { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] },
      { id: 'group_role%3Astaff', type: 'group', name: 'Staff only', participantIds: ['coach-1'], participantRoles: ['staff', 'coach'] }
    ];

    render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" preferredConversationId="group_role%3Astaff" />
      </MemoryRouter>
    );

    await waitFor(() => expect(ensureStaffChatConversation).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(ensureStaffChatConversation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Message recovered-message')).toBeVisible());
  });

  it('uses safe copy when staff conversation repair fails', async () => {
    mockChatTeamState.selectedConversationId = 'group_role%3Astaff';
    mockChatTeamState.conversations = [
      { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] },
      { id: 'group_role%3Astaff', type: 'group', name: 'Staff only', participantIds: ['coach-1'], participantRoles: ['staff', 'coach'] }
    ];
    vi.mocked(ensureStaffChatConversation).mockRejectedValue(new Error('internal document payload leaked'));

    render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" preferredConversationId="group_role%3Astaff" />
      </MemoryRouter>
    );

    expect(await screen.findByText('Unable to open staff chat. Please try again.')).toBeVisible();
    expect(screen.queryByText('internal document payload leaked')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it('creates and switches to Staff only from the mobile quick-switcher', async () => {
    mockChatTeamState.conversations = [
      { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] }
    ];
    vi.mocked(ensureStaffChatConversation).mockResolvedValue({
      id: 'staff-conversation',
      type: 'group',
      name: 'Staff only',
      participantIds: [],
      participantRoles: ['staff']
    } as ChatConversation);

    render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    const quickSwitcher = screen.getByTestId('mobile-conversation-chips');
    expect(screen.queryByRole('dialog', { name: 'Conversations' })).toBeNull();
    fireEvent.click(within(quickSwitcher).getByRole('button', { name: 'Switch to Staff only' }));

    await waitFor(() => {
      expect(ensureStaffChatConversation).toHaveBeenCalledWith('team-1', auth.user, [
        { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] }
      ]);
    });
    expect(mockChatTeamState.switchConversation).toHaveBeenCalledWith('staff-conversation');
    expect(mockChatSheetsState.openConversationSheet).not.toHaveBeenCalled();
  });

  it('repairs staff chat selected from the conversation selector', async () => {
    mockChatSheetsState.showConversationSheet = true;
    mockChatTeamState.conversations = [
      { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] },
      { id: 'staff-conversation', type: 'group', name: 'Staff only', participantIds: ['coach-1'], participantRoles: ['staff'] }
    ];
    vi.mocked(ensureStaffChatConversation).mockResolvedValue({
      id: 'group_role%3Astaff',
      type: 'group',
      name: 'Staff only',
      participantIds: [],
      participantRoles: ['staff']
    } as ChatConversation);

    render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByRole('button', { name: /Staff only/i })[0]);

    await waitFor(() => expect(ensureStaffChatConversation).toHaveBeenCalledWith('team-1', auth.user, mockChatTeamState.conversations));
    expect(mockChatTeamState.switchConversation).toHaveBeenCalledWith('group_role%3Astaff');
  });

  it('creates the staff conversation from the selector when a team has never opened it', async () => {
    mockChatSheetsState.showConversationSheet = true;
    mockChatTeamState.conversations = [
      { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] }
    ];
    vi.mocked(ensureStaffChatConversation).mockResolvedValue({
      id: 'staff-conversation',
      type: 'group',
      name: 'Staff only',
      participantIds: [],
      participantRoles: ['staff']
    } as ChatConversation);

    render(
      <MemoryRouter>
        <ChatWindow auth={auth} teamId="team-1" />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /Staff only.*Group conversation/i })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Staff only.*Group conversation/i }));

    await waitFor(() => {
      expect(ensureStaffChatConversation).toHaveBeenCalledWith('team-1', auth.user, [
        { id: 'team', type: 'team', name: 'Team chat', participantIds: [], participantRoles: ['team'] }
      ]);
    });
    expect(mockChatTeamState.switchConversation).toHaveBeenCalledWith('staff-conversation');
  });
});

describe('AudienceSheet recipient search', () => {
  function getRecipientCheckbox(name: string) {
    return screen.getByText(name).closest('label')?.querySelector('input') as HTMLInputElement;
  }

  function renderAudienceSheet(initialSelectedRecipientIds: string[] = []) {
    const recipientOptions = [
      { id: 'player-sam', name: 'Sam Player', detail: '#12' },
      { id: 'guardian-taylor', name: 'Taylor Guardian', detail: 'Guardian for Sam Player' },
      { id: 'player-casey', name: 'Casey Center', detail: '#34' }
    ];

    function AudienceSheetHarness() {
      const [selectedRecipientIds, setSelectedRecipientIds] = React.useState(initialSelectedRecipientIds);
      return (
        <AudienceSheet
          selectedTarget="individuals"
          selectedRecipientIds={selectedRecipientIds}
          recipientOptions={recipientOptions}
          recipientOptionsLoading={false}
          recipientOptionsError={null}
          onTargetChange={vi.fn() as any}
          onRecipientsChange={setSelectedRecipientIds}
          onRetryRecipientOptions={vi.fn()}
          onClose={vi.fn()}
        />
      );
    }

    return render(<AudienceSheetHarness />);
  }

  it('shows only full team and selected members as audience choices', () => {
    render(
      <AudienceSheet
        selectedTarget="full_team"
        selectedRecipientIds={[]}
        recipientOptions={[]}
        recipientOptionsLoading={false}
        recipientOptionsError={null}
        onTargetChange={vi.fn() as any}
        onRecipientsChange={vi.fn()}
        onRetryRecipientOptions={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Full team/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Selected members/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Staff only/i })).toBeNull();
  });

  it('filters recipient options immediately by name or detail text', () => {
    renderAudienceSheet();

    fireEvent.change(screen.getByPlaceholderText('Search by member or guardian name'), {
      target: { value: 'guardian for sam' }
    });

    expect(screen.getByText('Taylor Guardian')).not.toBeNull();
    expect(screen.queryByText('Sam Player')).toBeNull();
    expect(screen.queryByText('Casey Center')).toBeNull();
  });

  it('keeps selected recipients pinned and checked while filtering and after clearing search', () => {
    renderAudienceSheet(['player-sam']);

    expect(getRecipientCheckbox('Sam Player').checked).toBe(true);
    expect(screen.getByText('Selected')).not.toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Search by member or guardian name'), {
      target: { value: 'zzz' }
    });

    expect(getRecipientCheckbox('Sam Player').checked).toBe(true);
    expect(screen.getByText('No recipients match that search yet.')).not.toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Search by member or guardian name'), {
      target: { value: '' }
    });

    expect(getRecipientCheckbox('Sam Player').checked).toBe(true);
    expect(screen.queryByText('No recipients match that search yet.')).toBeNull();
  });

  it('blocks Done with no selected recipients and allows it after choosing a filtered recipient', () => {
    renderAudienceSheet();

    const doneButton = screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement;
    expect(doneButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Search by member or guardian name'), {
      target: { value: 'casey' }
    });
    fireEvent.click(getRecipientCheckbox('Casey Center'));

    expect(doneButton.disabled).toBe(false);
  });
});
