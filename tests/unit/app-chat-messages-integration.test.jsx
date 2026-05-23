// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const chatMocks = vi.hoisted(() => ({
    deleteTeamChatMessage: vi.fn(),
    editTeamChatMessage: vi.fn(),
    ensureStaffChatConversation: vi.fn(),
    getChatInboxPreview: vi.fn((message) => message ? `${message.senderName || 'Unknown'}: ${message.text || 'Attachment'}` : 'No messages yet'),
    loadChatConversations: vi.fn(),
    loadChatInbox: vi.fn(),
    loadChatRecipientOptions: vi.fn(),
    loadChatTeamContext: vi.fn(),
    loadOlderTeamChatMessages: vi.fn(),
    markTeamChatRead: vi.fn(),
    sendAllPlaysChatAnswer: vi.fn(),
    sendTeamChatMessage: vi.fn(),
    subscribeToTeamChatMessages: vi.fn(),
    toggleTeamChatReaction: vi.fn()
}));

const layoutMocks = vi.hoisted(() => ({
    isDesktopWeb: false
}));

const nativeMocks = vi.hoisted(() => ({
    isNativePlatform: false
}));

const publicActionMocks = vi.hoisted(() => ({
    sharePublicUrl: vi.fn()
}));

const voiceMocks = vi.hoisted(() => {
    const listeners = {};
    return {
        listeners,
        addErrorListener: vi.fn(async (listener) => {
            listeners.error = listener;
            return {
                remove: vi.fn(async () => {
                    if (listeners.error === listener) {
                        delete listeners.error;
                    }
                })
            };
        }),
        addListeningStateListener: vi.fn(async (listener) => {
            listeners.listeningState = listener;
            return {
                remove: vi.fn(async () => {
                    if (listeners.listeningState === listener) {
                        delete listeners.listeningState;
                    }
                })
            };
        }),
        addPartialResultsListener: vi.fn(async (listener) => {
            listeners.partialResults = listener;
            return {
                remove: vi.fn(async () => {
                    if (listeners.partialResults === listener) {
                        delete listeners.partialResults;
                    }
                })
            };
        }),
        addListener: vi.fn(async (eventName, listener) => {
            listeners[eventName] = listener;
            return {
                remove: vi.fn(async () => {
                    if (listeners[eventName] === listener) {
                        delete listeners[eventName];
                    }
                })
            };
        }),
        available: vi.fn(async () => ({ available: true })),
        checkPermissions: vi.fn(async () => ({ speechRecognition: 'granted' })),
        forceStop: vi.fn(async () => {}),
        getLastPartialResult: vi.fn(async () => ({ available: false, text: '', matches: [] })),
        hasBrowserSupport: vi.fn(() => false),
        isNativeRuntime: vi.fn(() => nativeMocks.isNativePlatform),
        requestPermissions: vi.fn(async () => ({ speechRecognition: 'granted' })),
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => {})
    };
});

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => nativeMocks.isNativePlatform
    }
}));
vi.mock('@capgo/capacitor-speech-recognition', () => ({
    SpeechRecognition: voiceMocks
}));
vi.mock('../../apps/app/src/lib/voiceService.ts', () => ({
    voiceRecognition: voiceMocks
}));
vi.mock('../../apps/app/src/lib/chatService.ts', () => chatMocks);
vi.mock('../../apps/app/src/lib/useShellLayout.ts', () => ({
    useShellLayout: () => layoutMocks
}));
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent', 'admin']
    },
    profile: {},
    loading: false,
    error: null,
    roles: ['parent', 'admin'],
    isParent: true,
    isCoach: false,
    isAdmin: true,
    isPlatformAdmin: false,
    refresh: async () => {},
    signOut: async () => {}
};

function chatMessage(overrides = {}) {
    return {
        id: overrides.id || 'msg-1',
        text: overrides.text || 'Bring both jerseys.',
        senderId: overrides.senderId || 'coach-1',
        senderName: overrides.senderName || 'Coach Jamie',
        senderEmail: 'coach@example.com',
        createdAt: overrides.createdAt || new Date('2026-05-21T14:00:00Z'),
        reactions: overrides.reactions || {},
        deleted: false,
        ...overrides
    };
}

async function renderMessages(initialEntry) {
    const { Messages } = await import('../../apps/app/src/pages/Messages.tsx');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: [initialEntry] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: '/messages', element: React.createElement(Messages, { auth }) }),
                React.createElement(Route, { path: '/messages/:teamId', element: React.createElement(Messages, { auth }) })
            )
        ));
    });

    await flush();
    return { container, root };
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function buttonByText(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.trim() === text || candidate.getAttribute('aria-label') === text);
    if (!button) {
        const partial = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.trim().includes(text) || String(candidate.getAttribute('aria-label') || '').includes(text));
        if (partial) return partial;
    }
    if (!button) {
        const labels = Array.from(container.querySelectorAll('button')).map((candidate) => candidate.textContent.trim() || candidate.getAttribute('aria-label') || '(unlabeled)');
        throw new Error(`Button not found: ${text}. Available buttons: ${labels.join(', ')}`);
    }
    return button;
}

async function click(container, text) {
    await act(async () => {
        buttonByText(container, text).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

async function setFieldValue(field, value) {
    const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value')?.set;
    await act(async () => {
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
}

beforeEach(() => {
    vi.clearAllMocks();
    layoutMocks.isDesktopWeb = false;
    nativeMocks.isNativePlatform = false;
    Object.keys(voiceMocks.listeners).forEach((eventName) => {
        delete voiceMocks.listeners[eventName];
    });
    voiceMocks.available.mockResolvedValue({ available: true });
    voiceMocks.checkPermissions.mockResolvedValue({ speechRecognition: 'granted' });
    voiceMocks.forceStop.mockResolvedValue(undefined);
    voiceMocks.getLastPartialResult.mockResolvedValue({ available: false, text: '', matches: [] });
    voiceMocks.hasBrowserSupport.mockReturnValue(false);
    voiceMocks.isNativeRuntime.mockImplementation(() => nativeMocks.isNativePlatform);
    voiceMocks.requestPermissions.mockResolvedValue({ speechRecognition: 'granted' });
    voiceMocks.start.mockResolvedValue(undefined);
    voiceMocks.stop.mockResolvedValue(undefined);
    publicActionMocks.sharePublicUrl.mockResolvedValue('shared');
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: vi.fn()
    });
    Object.defineProperty(window.HTMLAnchorElement.prototype, 'click', {
        configurable: true,
        value: vi.fn()
    });
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: vi.fn(async () => {})
        }
    });
    window.requestAnimationFrame = (callback) => {
        callback(0);
        return 0;
    };
    window.setTimeout = vi.fn((callback) => {
        callback();
        return 0;
    });
    window.confirm = vi.fn(() => true);
    URL.createObjectURL = vi.fn(() => 'blob:chat-upload');
    URL.revokeObjectURL = vi.fn();

    chatMocks.loadChatInbox.mockResolvedValue({
        teams: [
            {
                id: 'team-1',
                name: 'Bears',
                sport: 'Basketball',
                role: 'Admin',
                canModerate: true,
                unreadCount: 2,
                lastMessage: chatMessage({ id: 'last-1', text: 'Practice packet posted.' })
            }
        ]
    });
    chatMocks.loadChatTeamContext.mockResolvedValue({
        team: { id: 'team-1', name: 'Bears', sport: 'Basketball' },
        profile: { fullName: 'Pat Parent', photoUrl: '' },
        canModerate: true
    });
    chatMocks.loadChatConversations.mockResolvedValue([
        { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] }
    ]);
    chatMocks.ensureStaffChatConversation.mockResolvedValue({
        id: 'staff-conversation',
        type: 'group',
        name: 'Staff only',
        participantIds: ['user-1'],
        participantRoles: ['staff']
    });
    chatMocks.loadChatRecipientOptions.mockResolvedValue([
        { id: 'user:coach-1', name: 'Coach Jamie', detail: 'Staff' },
        { id: 'player:player-1', name: 'Pat', detail: '#9' }
    ]);
    chatMocks.subscribeToTeamChatMessages.mockImplementation((teamId, conversationId, onMessages) => {
        onMessages([
            chatMessage({ id: 'msg-1', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bring both jerseys.' }),
            chatMessage({ id: 'msg-2', senderId: 'user-1', senderName: 'Pat Parent', text: 'We can bring snacks.', createdAt: new Date('2026-05-21T14:02:00Z') })
        ], { id: 'cursor' });
        return { unsubscribe: vi.fn() };
    });
    chatMocks.sendTeamChatMessage.mockResolvedValue({ conversationId: 'team', createdConversation: null, wantsAi: false });
    chatMocks.sendAllPlaysChatAnswer.mockResolvedValue(undefined);
    chatMocks.toggleTeamChatReaction.mockResolvedValue(true);
    chatMocks.editTeamChatMessage.mockResolvedValue(undefined);
    chatMocks.deleteTeamChatMessage.mockResolvedValue(undefined);
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('React app messages integration', () => {
    it('renders the real inbox with unread team chat previews', async () => {
        const { container } = await renderMessages('/messages');

        expect(container.textContent).toContain('Team chats');
        expect(container.textContent).toContain('Bears');
        expect(container.textContent).toContain('2');
        expect(container.textContent).toContain('Coach Jamie: Practice packet posted.');
    });

    it('filters inbox rows by team, sport, or latest message preview', async () => {
        chatMocks.loadChatInbox.mockResolvedValueOnce({
            teams: [
                {
                    id: 'team-1',
                    name: 'Bears',
                    sport: 'Basketball',
                    role: 'Admin',
                    canModerate: true,
                    unreadCount: 2,
                    lastMessage: chatMessage({ id: 'last-1', text: 'Practice packet posted.' })
                },
                {
                    id: 'team-2',
                    name: 'Thunder',
                    sport: 'Soccer',
                    role: 'Parent',
                    canModerate: false,
                    unreadCount: 0,
                    lastMessage: chatMessage({ id: 'last-2', senderName: 'Morgan', text: 'Tournament schedule changed.' })
                }
            ]
        });
        const { container } = await renderMessages('/messages');
        const search = container.querySelector('input[placeholder="Search team chats"]');

        await setFieldValue(search, 'soccer');

        expect(container.textContent).toContain('Thunder');
        expect(container.textContent).toContain('Morgan: Tournament schedule changed.');
        expect(container.textContent).not.toContain('Bears');

        await setFieldValue(search, 'packet');
        expect(container.textContent).toContain('Bears');
        expect(container.textContent).not.toContain('Thunder');
    });

    it('auto-selects the first filtered team in the desktop messages workspace', async () => {
        layoutMocks.isDesktopWeb = true;
        const { container } = await renderMessages('/messages');

        expect(container.querySelector('.messages-list-pane')).toBeTruthy();
        expect(container.querySelector('.chat-window-embedded')).toBeTruthy();
        expect(chatMocks.loadChatTeamContext).toHaveBeenCalledWith('team-1', auth.user);
        expect(container.textContent).toContain('Bring both jerseys.');
    });

    it('shows inbox and thread error states clearly', async () => {
        chatMocks.loadChatInbox.mockRejectedValueOnce(new Error('Inbox down'));
        const inbox = await renderMessages('/messages');
        expect(inbox.container.textContent).toContain('Inbox down');
        expect(inbox.container.textContent).not.toContain('Loading team chats');

        chatMocks.loadChatTeamContext.mockRejectedValueOnce(new Error('No chat access'));
        const thread = await renderMessages('/messages/team-1');
        expect(thread.container.textContent).toContain('No chat access');
        expect(thread.container.textContent).toContain('Back to messages');
        expect(thread.container.textContent).not.toContain('Loading team chat');
    });

    it('loads a team thread with messages, reactions, edit, and delete controls', async () => {
        const { container } = await renderMessages('/messages/team-1');

        expect(container.textContent).toContain('Bring both jerseys.');
        expect(container.textContent).toContain('We can bring snacks.');

        const reactionButtons = Array.from(container.querySelectorAll('button[aria-label="Add reaction"]'));
        await act(async () => {
            reactionButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();
        await click(container, 'Like');
        expect(chatMocks.toggleTeamChatReaction).toHaveBeenCalledWith('team-1', 'msg-1', 'thumbs_up', 'user-1', 'team');

        await click(container, 'Open actions for You');
        await click(container, 'Edit');
        const dialog = container.querySelector('[role="dialog"][aria-label="Edit message"]');
        const editTextarea = dialog.querySelector('textarea');
        await setFieldValue(editTextarea, 'We can bring snacks and waters.');
        await click(container, 'Save');
        expect(chatMocks.editTeamChatMessage).toHaveBeenCalledWith('team-1', 'msg-2', 'We can bring snacks and waters.', 'team');

        await click(container, 'Open actions for You');
        await click(container, 'Delete');
        expect(chatMocks.deleteTeamChatMessage).toHaveBeenCalledWith('team-1', 'msg-2', 'team');
    });

    it('opens a team thread at the latest message and exposes a latest shortcut after scrolling up', async () => {
        const { container } = await renderMessages('/messages/team-1');
        const scrollIntoView = window.HTMLElement.prototype.scrollIntoView;

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });

        const scroller = container.querySelector('.chat-messages-scroll');
        Object.defineProperties(scroller, {
            scrollHeight: { configurable: true, value: 1000 },
            clientHeight: { configurable: true, value: 300 },
            scrollTop: { configurable: true, writable: true, value: 0 }
        });

        await act(async () => {
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        });
        await flush();

        expect(container.textContent).toContain('Latest');
        await click(container, 'Latest');
        expect(scroller.scrollTop).toBe(700);
    });

    it('keeps staff targeting contextual and sends the selected audience metadata', async () => {
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Audience: Full team');
        await click(container, 'Staff only');

        expect(chatMocks.ensureStaffChatConversation).toHaveBeenCalledWith(
            'team-1',
            auth.user,
            [{ id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] }]
        );
        expect(container.textContent).toContain('Staff only');

        const textarea = container.querySelector('textarea');
        await setFieldValue(textarea, 'Staff update only');
        await click(container, 'Send message');

        expect(chatMocks.sendTeamChatMessage).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            text: 'Staff update only',
            selectedConversationId: 'staff-conversation',
            selectedConversation: expect.objectContaining({ participantRoles: ['staff'] }),
            selectedRecipientIds: []
        }));
    });

    it('sends selected member messages with names shown in the audience pill', async () => {
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Audience: Full team');
        await click(container, 'Selected members');
        const coachCheckbox = Array.from(container.querySelectorAll('label')).find((label) => label.textContent.includes('Coach Jamie'))?.querySelector('input[type="checkbox"]');
        expect(coachCheckbox).toBeTruthy();
        await act(async () => {
            coachCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();
        await click(container, 'Done');
        expect(container.textContent).toContain('Audience: Coach Jamie (Staff)');

        const textarea = container.querySelector('textarea');
        await setFieldValue(textarea, 'Could you confirm arrival time?');
        await click(container, 'Send message');

        expect(chatMocks.sendTeamChatMessage).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            text: 'Could you confirm arrival time?',
            selectedConversationId: 'team',
            selectedRecipientTarget: 'individuals',
            selectedRecipientIds: ['user:coach-1']
        }));
    });

    it('opens photo, video, and link actions from the attachment button', async () => {
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Add attachment');
        expect(container.textContent).toContain('Photo');
        expect(container.textContent).toContain('Video');
        expect(container.textContent).toContain('Link');

        await click(container, 'Link');
        const linkInput = container.querySelector('input[placeholder="https://example.com"]');
        await setFieldValue(linkInput, 'www.allplays.ai/game.html');
        await click(container, 'Add link');

        const textarea = container.querySelector('textarea');
        expect(textarea.value).toBe('https://www.allplays.ai/game.html');
    });

    it('validates attachment file types, file sizes, and unsafe composer links', async () => {
        const { container } = await renderMessages('/messages/team-1');
        const photoInput = container.querySelector('input[type="file"][accept="image/*"]');

        const pdf = new File(['not-media'], 'waiver.pdf', { type: 'application/pdf' });
        Object.defineProperty(photoInput, 'files', { configurable: true, value: [pdf] });
        await act(async () => {
            photoInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await flush();
        expect(container.textContent).toContain('Choose image or video files only.');

        const largePhoto = new File([new Uint8Array((5 * 1024 * 1024) + 1)], 'huge.jpg', { type: 'image/jpeg' });
        Object.defineProperty(photoInput, 'files', { configurable: true, value: [largePhoto] });
        await act(async () => {
            photoInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await flush();
        expect(container.textContent).toContain('Photos and videos must be 5MB or smaller each.');

        await click(container, 'Add attachment');
        await click(container, 'Link');
        const linkInput = container.querySelector('input[placeholder="https://example.com"]');
        await setFieldValue(linkInput, 'javascript:alert(1)');
        await click(container, 'Add link');
        expect(container.textContent).toContain('Use a valid http or https link.');
    });

    it('loads older messages from the live cursor when the thread has more history', async () => {
        const liveMessages = Array.from({ length: 50 }, (_, index) => chatMessage({
            id: `msg-${index}`,
            text: `Message ${index}`,
            createdAt: new Date(Date.UTC(2026, 4, 21, 12, index))
        }));
        chatMocks.subscribeToTeamChatMessages.mockImplementation((teamId, conversationId, onMessages) => {
            onMessages(liveMessages, { id: 'oldest-live-doc' });
            return { unsubscribe: vi.fn() };
        });
        chatMocks.loadOlderTeamChatMessages.mockResolvedValue([
            chatMessage({
                id: 'older-1',
                text: 'Older update',
                createdAt: new Date('2026-05-20T12:00:00Z'),
                _doc: { id: 'older-doc' }
            })
        ]);
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Load older messages');

        expect(chatMocks.loadOlderTeamChatMessages).toHaveBeenCalledWith('team-1', 'team', { id: 'oldest-live-doc' });
        expect(container.textContent).toContain('Older update');
    });

    it('opens the shared media gallery with share, save, and copy actions', async () => {
        chatMocks.subscribeToTeamChatMessages.mockImplementation((teamId, conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: 'msg-media',
                    text: '',
                    attachments: [
                        {
                            type: 'image',
                            url: 'https://media.example.test/lineup.jpg',
                            name: 'Lineup.jpg'
                        }
                    ]
                })
            ], { id: 'cursor' });
            return { unsubscribe: vi.fn() };
        });
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Open photos and videos');
        expect(container.textContent).toContain('Photos & videos');
        expect(container.textContent).toContain('Lineup.jpg');

        await click(container, 'Share');
        expect(publicActionMocks.sharePublicUrl).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://media.example.test/lineup.jpg'
        }));
        expect(container.textContent).toContain('Share sheet opened.');

        await click(container, 'Save');
        expect(window.HTMLAnchorElement.prototype.click).toHaveBeenCalled();

        await click(container, 'Copy');
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://media.example.test/lineup.jpg');
        expect(container.textContent).toContain('Media link copied.');
    });

    it('routes ALL PLAYS mentions through the existing AI assistant send path', async () => {
        chatMocks.sendTeamChatMessage.mockResolvedValue({ conversationId: 'team', createdConversation: null, wantsAi: true });
        const { container } = await renderMessages('/messages/team-1');
        const textarea = container.querySelector('textarea');

        await setFieldValue(textarea, '@ALL PLAYS who has not RSVP’d?');
        await click(container, 'Send message');
        await flush();

        expect(chatMocks.sendAllPlaysChatAnswer).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            question: 'who has not RSVP’d?'
        }));
    });

    it('replaces a typed at-trigger with the ALL PLAYS mention instead of duplicating it', async () => {
        const { container } = await renderMessages('/messages/team-1');
        const textarea = container.querySelector('textarea');

        await setFieldValue(textarea, '@');
        await click(container, '@ALL PLAYS');

        expect(textarea.value).toBe('@ALL PLAYS ');
    });

    it('shows media upload progress and keeps the composer input roomy', async () => {
        let resolveSend;
        chatMocks.sendTeamChatMessage.mockImplementation(() => new Promise((resolve) => {
            resolveSend = resolve;
        }));
        const { container } = await renderMessages('/messages/team-1');

        const fileInput = container.querySelector('input[type="file"]');
        const photo = new File(['photo'], 'lineup.jpg', { type: 'image/jpeg' });
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [photo] });
        await act(async () => {
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await flush();

        expect(container.textContent).toContain('1 attachment ready');
        const textarea = container.querySelector('.chat-composer-textarea');
        expect(textarea).toBeTruthy();
        await setFieldValue(textarea, 'Photo from practice');
        await click(container, 'Send message');

        expect(container.textContent).toContain('Uploading 1 attachment...');
        expect(chatMocks.sendTeamChatMessage).toHaveBeenCalledWith(expect.objectContaining({
            files: [photo]
        }));

        await act(async () => {
            resolveSend({ conversationId: 'team', createdConversation: null, wantsAi: false });
        });
        await flush();
    });

    it('hides the voice button when dictation is unsupported', async () => {
        const { container } = await renderMessages('/messages/team-1');

        expect(container.querySelector('button[aria-label="Voice to text"]')).toBeNull();
    });

    it('keeps native dictation listening when iOS resolves start without a result payload', async () => {
        nativeMocks.isNativePlatform = true;
        voiceMocks.start.mockResolvedValue(undefined);
        const { container } = await renderMessages('/messages/team-1');

        expect(voiceMocks.available).toHaveBeenCalled();
        await click(container, 'Voice to text');

        expect(voiceMocks.start).toHaveBeenCalledWith(expect.objectContaining({
            partialResults: true
        }));
        expect(container.textContent).toContain('Listening...');
        expect(voiceMocks.listeners.partialResults).toBeTypeOf('function');

        await act(async () => {
            voiceMocks.listeners.partialResults({ matches: ['Leaving now'] });
        });
        await flush();

        const textarea = container.querySelector('textarea');
        expect(textarea.value).toBe('Leaving now');
        expect(container.querySelector('button[aria-label="Stop voice input"]')).toBeTruthy();
    });
});
