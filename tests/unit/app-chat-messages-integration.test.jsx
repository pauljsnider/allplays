// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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
    loadTeamEmailDrafts: vi.fn(),
    loadSentTeamEmails: vi.fn(),
    loadTeamEmailTemplates: vi.fn(),
    markTeamChatRead: vi.fn(),
    muteTeamChat: vi.fn(),
    unmuteTeamChat: vi.fn(),
    saveTeamEmailDraft: vi.fn(),
    saveTeamEmailTemplate: vi.fn(),
    sendAllPlaysChatAnswer: vi.fn(),
    sendTeamChatMessage: vi.fn(),
    sendTeamEmailMessage: vi.fn(),
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

const uxTimingMocks = vi.hoisted(() => ({
    UX_TIMING: {
        chatSend: 'chat send latency'
    },
    interactionEnds: [],
    startInteractionTimer: vi.fn((_label, _meta) => {
        const end = vi.fn();
        uxTimingMocks.interactionEnds.push(end);
        return { end };
    }),
    startScreenMountTimer: vi.fn(() => ({ end: vi.fn() })),
    startUxTimer: vi.fn(() => ({ end: vi.fn() }))
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

const resizeObserverState = vi.hoisted(() => ({
    instances: []
}));

const intersectionObserverState = vi.hoisted(() => ({
    instances: []
}));

const animationFrameState = vi.hoisted(() => ({
    nextId: 1,
    callbacks: new Map()
}));

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
vi.mock('../../apps/app/src/lib/chatAiService', () => ({
    sendAllPlaysChatAnswer: chatMocks.sendAllPlaysChatAnswer
}));
vi.mock('../../apps/app/src/lib/useShellLayout.ts', () => ({
    useShellLayout: () => layoutMocks
}));
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../apps/app/src/lib/uxTiming.ts', () => uxTimingMocks);

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

async function renderMessages(initialEntry, authState = auth) {
    const { Messages } = await import('../../apps/app/src/pages/Messages.tsx');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const renderWithAuth = async (nextAuthState) => {
        await act(async () => {
            root.render(React.createElement(
                MemoryRouter,
                { initialEntries: [initialEntry] },
                React.createElement(
                    Routes,
                    null,
                    React.createElement(Route, { path: '/messages', element: React.createElement(Messages, { auth: nextAuthState }) }),
                    React.createElement(Route, { path: '/messages/:teamId', element: React.createElement(Messages, { auth: nextAuthState }) })
                )
            ));
        });

        await flush();
        await flush();
    };

    await renderWithAuth(authState);
    return {
        container,
        root,
        rerender: renderWithAuth
    };
}

async function flush() {
    await act(async () => {
        while (animationFrameState.callbacks.size) {
            const pending = Array.from(animationFrameState.callbacks.entries());
            animationFrameState.callbacks.clear();
            pending.forEach(([, callback]) => {
                callback(0);
            });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function waitForMatch(getMatch, description, attempts = 50) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const match = getMatch();
        if (match) return match;
        await flush();
    }
    throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForMockCallCount(mockFn, expectedCount, description) {
    await waitForMatch(
        () => mockFn.mock.calls.length >= expectedCount,
        description
    );
    expect(mockFn).toHaveBeenCalledTimes(expectedCount);
}

async function waitForRecipientCheckbox(container, name) {
    return waitForMatch(
        () => Array.from(container.querySelectorAll('label'))
            .find((label) => label.textContent.includes(name))
            ?.querySelector('input[type="checkbox"]'),
        `${name} recipient checkbox`
    );
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}

function staffActionButtonByText(container, text) {
    if (text === 'Team Email') {
        return Array.from(container.querySelectorAll('button[role="menuitem"]')).find((candidate) => candidate.textContent.trim() === 'Team Email');
    }
    if (text.startsWith('Audience: ')) {
        const currentAudience = text.replace(/^Audience:\s*/, 'Current: ');
        return Array.from(container.querySelectorAll('button[role="menuitem"]')).find((candidate) => {
            const label = candidate.textContent.trim();
            return label.includes('Message audience') && label.includes(currentAudience);
        });
    }
    return null;
}

function buttonByText(container, text) {
    const staffActionButton = staffActionButtonByText(container, text);
    if (staffActionButton) return staffActionButton;
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
    let button = null;
    try {
        button = buttonByText(container, text);
    } catch (error) {
        const staffActionsButton = buttonByText(container, 'Open staff actions');
        if (!(text === 'Team Email' || text.startsWith('Audience: ')) || !staffActionsButton) {
            throw error;
        }
        await act(async () => {
            staffActionsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        button = await waitForMatch(
            () => staffActionButtonByText(container, text),
            `${text} staff action`
        );
    }
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    if (text === 'Team Email') {
        await waitForMatch(
            () => container.querySelector('[role="dialog"][aria-label="Team Email"]'),
            'Team Email dialog'
        );
    }
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

async function waitForTeamEmailDialog(container) {
    return waitForMatch(
        () => {
            const dialog = container.querySelector('[role="dialog"][aria-label="Team Email"]');
            return dialog?.querySelector('input[placeholder="Team update"]') ? dialog : null;
        },
        'loaded Team Email dialog'
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    uxTimingMocks.interactionEnds.length = 0;
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
    Object.defineProperty(window, 'SpeechRecognition', {
        configurable: true,
        value: undefined
    });
    Object.defineProperty(window, 'webkitSpeechRecognition', {
        configurable: true,
        value: undefined
    });
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: vi.fn(async () => {})
        }
    });
    Object.defineProperty(navigator, 'language', {
        configurable: true,
        value: 'en-US'
    });
    animationFrameState.nextId = 1;
    animationFrameState.callbacks.clear();
    window.requestAnimationFrame = vi.fn((callback) => {
        const id = animationFrameState.nextId;
        animationFrameState.nextId += 1;
        animationFrameState.callbacks.set(id, callback);
        return id;
    });
    window.cancelAnimationFrame = vi.fn((id) => {
        animationFrameState.callbacks.delete(id);
    });
    window.setTimeout = vi.fn((callback) => {
        callback();
        return 0;
    });
    window.confirm = vi.fn(() => true);
    URL.createObjectURL = vi.fn(() => 'blob:chat-upload');
    URL.revokeObjectURL = vi.fn();
    resizeObserverState.instances.length = 0;
    global.ResizeObserver = class MockResizeObserver {
        constructor(callback) {
            this.callback = callback;
            resizeObserverState.instances.push(this);
        }

        observe = vi.fn();
        disconnect = vi.fn();

        trigger() {
            this.callback([], this);
        }
    };
    intersectionObserverState.instances.length = 0;
    global.IntersectionObserver = class MockIntersectionObserver {
        constructor(callback) {
            this.callback = callback;
            this.elements = [];
            intersectionObserverState.instances.push(this);
        }

        observe = vi.fn((element) => {
            this.elements.push(element);
        });
        disconnect = vi.fn();
        unobserve = vi.fn((element) => {
            this.elements = this.elements.filter((candidate) => candidate !== element);
        });

        trigger(element, isIntersecting, intersectionRatio = isIntersecting ? 1 : 0) {
            this.callback([{ isIntersecting, intersectionRatio, target: element }], this);
        }
    };

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
    chatMocks.sendTeamEmailMessage.mockResolvedValue({ recipientCount: 12, status: 'queued' });
    chatMocks.loadTeamEmailDrafts.mockResolvedValue([]);
    chatMocks.loadSentTeamEmails.mockResolvedValue([
        {
            id: 'email-1',
            subject: 'Practice plan',
            senderName: 'Coach Jamie',
            sentAt: new Date('2026-05-21T15:00:00Z'),
            recipientCount: 12,
            status: 'queued'
        }
    ]);
    chatMocks.loadTeamEmailTemplates.mockResolvedValue([]);
    chatMocks.saveTeamEmailDraft.mockResolvedValue(undefined);
    chatMocks.saveTeamEmailTemplate.mockResolvedValue(undefined);
    chatMocks.sendAllPlaysChatAnswer.mockResolvedValue(undefined);
    chatMocks.toggleTeamChatReaction.mockResolvedValue(true);
    chatMocks.editTeamChatMessage.mockResolvedValue(undefined);
    chatMocks.deleteTeamChatMessage.mockResolvedValue(undefined);
    chatMocks.muteTeamChat.mockResolvedValue(undefined);
    chatMocks.unmuteTeamChat.mockResolvedValue(undefined);
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

    it('keeps the previewed conversation id on inbox links and opens that conversation on first load', async () => {
        chatMocks.loadChatInbox.mockResolvedValueOnce({
            teams: [
                {
                    id: 'team-1',
                    name: 'Bears',
                    sport: 'Basketball',
                    role: 'Admin',
                    canModerate: true,
                    unreadCount: 2,
                    preferredConversationId: 'staff-conversation',
                    lastMessage: chatMessage({ id: 'last-1', text: 'Staff follow-up', conversationId: 'staff-conversation' })
                }
            ]
        });
        chatMocks.loadChatConversations.mockResolvedValueOnce([
            { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] },
            { id: 'staff-conversation', type: 'group', name: 'Staff only', participantIds: ['user-1'], participantRoles: ['staff'] }
        ]);

        const { container } = await renderMessages('/messages');
        const inboxLink = container.querySelector('a[href="/messages/team-1?conversationId=staff-conversation"]');
        expect(inboxLink).toBeTruthy();

        await act(async () => {
            inboxLink.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        });
        await flush();

        expect(container.textContent).toContain('Staff only');
        expect(chatMocks.subscribeToTeamChatMessages).toHaveBeenLastCalledWith(
            'team-1',
            'staff-conversation',
            expect.any(Function),
            expect.any(Function)
        );
    });

    it('skips inbox loading for direct mobile thread deep links and keeps conversation targeting', async () => {
        chatMocks.loadChatConversations.mockResolvedValueOnce([
            { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] },
            { id: 'staff-conversation', type: 'group', name: 'Staff only', participantIds: ['user-1'], participantRoles: ['staff'] }
        ]);

        const { container } = await renderMessages('/messages/team-1?conversation=staff-conversation');

        expect(chatMocks.loadChatInbox).not.toHaveBeenCalled();
        expect(chatMocks.loadChatTeamContext).toHaveBeenCalledWith('team-1', auth.user);
        expect(chatMocks.subscribeToTeamChatMessages).toHaveBeenLastCalledWith(
            'team-1',
            'staff-conversation',
            expect.any(Function),
            expect.any(Function)
        );
        expect(container.textContent).toContain('Staff only');
        expect(container.textContent).toContain('Bring both jerseys.');
    });

    it('renders only the bounded conversation set while selecting an older deep-linked thread', async () => {
        const recentConversations = Array.from({ length: 24 }, (_, index) => ({
            id: `recent-${index + 1}`,
            type: 'group',
            name: `Recent ${index + 1}`,
            participantIds: ['user-1'],
            participantRoles: []
        }));
        chatMocks.loadChatConversations.mockResolvedValueOnce([
            { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] },
            ...recentConversations,
            { id: 'older-deep-link', type: 'direct', name: 'Older direct', participantIds: ['user-1', 'coach-1'], participantRoles: [] }
        ]);
        chatMocks.subscribeToTeamChatMessages.mockImplementationOnce((teamId, conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: 'older-msg',
                    text: 'Older thread loaded.',
                    conversationId,
                    senderId: 'coach-1',
                    senderName: 'Coach Jamie'
                })
            ], { id: `cursor-${teamId}-${conversationId}` });
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages/team-1?conversationId=older-deep-link');

        expect(chatMocks.loadChatConversations).toHaveBeenCalledWith(
            'team-1',
            auth.user,
            { id: 'team-1', name: 'Bears', sport: 'Basketball' },
            true,
            { activeConversationId: 'older-deep-link' }
        );
        expect(chatMocks.subscribeToTeamChatMessages).toHaveBeenLastCalledWith(
            'team-1',
            'older-deep-link',
            expect.any(Function),
            expect.any(Function)
        );
        expect(container.textContent).toContain('Older direct');
        expect(container.textContent).toContain('Older thread loaded.');
        await click(container, 'Older direct');
        expect(container.textContent).toContain('Recent 24');
        expect(container.textContent).not.toContain('Recent 25');
    });

    it('falls back to the default team conversation when the requested conversation is unavailable', async () => {
        chatMocks.loadChatConversations.mockResolvedValueOnce([
            { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] }
        ]);

        const { container } = await renderMessages('/messages/team-1?conversationId=missing-conversation');

        expect(chatMocks.loadChatInbox).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Bears Team Chat');
        expect(chatMocks.subscribeToTeamChatMessages).toHaveBeenLastCalledWith(
            'team-1',
            'team',
            expect.any(Function),
            expect.any(Function)
        );
    });

    it('loads the inbox for the inbox route and desktop two-pane thread route', async () => {
        await renderMessages('/messages');
        expect(chatMocks.loadChatInbox).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        layoutMocks.isDesktopWeb = true;
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

        await renderMessages('/messages/team-1');
        expect(chatMocks.loadChatInbox).toHaveBeenCalledTimes(1);
    });

    it('renders inbox rows before deferred preview hydration finishes, then updates the preview copy', async () => {
        const deferredPreview = createDeferred();
        chatMocks.loadChatInbox.mockImplementationOnce(async (_user, options = {}) => {
            deferredPreview.promise.then(() => {
                options.onPreview?.({
                    teamId: 'team-1',
                    lastMessage: chatMessage({ id: 'last-1', text: 'Practice packet posted.' }),
                    preferredConversationId: null,
                    isMuted: false
                });
            });
            return {
                teams: [
                    {
                        id: 'team-1',
                        name: 'Bears',
                        sport: 'Basketball',
                        role: 'Admin',
                        canModerate: true,
                        unreadCount: 2,
                        lastMessage: null,
                        preferredConversationId: null
                    }
                ]
            };
        });

        const { container } = await renderMessages('/messages');

        expect(chatMocks.loadChatInbox).toHaveBeenCalledWith(auth.user, expect.objectContaining({ includeLastMessages: false, onPreview: expect.any(Function) }));
        expect(container.textContent).toContain('Bears');
        expect(container.textContent).toContain('No messages yet');
        expect(container.textContent).not.toContain('Practice packet posted.');

        await act(async () => {
            deferredPreview.resolve();
            await deferredPreview.promise;
        });
        await flush();

        expect(container.textContent).toContain('Coach Jamie: Practice packet posted.');
    });

    it('applies deferred preview updates incrementally without losing inbox ordering', async () => {
        let onPreview;
        chatMocks.loadChatInbox.mockImplementationOnce(async (_user, options = {}) => {
            onPreview = options.onPreview;
            return {
                teams: [
                    {
                        id: 'team-1',
                        name: 'Bears',
                        sport: 'Basketball',
                        role: 'Admin',
                        canModerate: true,
                        unreadCount: 0,
                        lastMessage: null,
                        preferredConversationId: null
                    },
                    {
                        id: 'team-2',
                        name: 'Thunder',
                        sport: 'Soccer',
                        role: 'Parent',
                        canModerate: false,
                        unreadCount: 1,
                        lastMessage: null,
                        preferredConversationId: null
                    }
                ]
            };
        });

        const { container } = await renderMessages('/messages');

        expect(Array.from(container.querySelectorAll('.message-row')).map((row) => row.textContent || '')).toEqual([
            expect.stringContaining('Bears'),
            expect.stringContaining('Thunder')
        ]);
        expect(container.textContent).toContain('No messages yet');

        await act(async () => {
            onPreview?.({
                teamId: 'team-2',
                lastMessage: chatMessage({
                    id: 'last-2',
                    text: 'Tournament schedule changed.',
                    senderName: 'Morgan',
                    createdAt: new Date('2026-05-21T15:00:00Z')
                }),
                preferredConversationId: null,
                isMuted: false
            });
        });
        await flush();

        let rows = Array.from(container.querySelectorAll('.message-row')).map((row) => row.textContent || '');
        expect(rows[0]).toContain('Thunder');
        expect(rows[0]).toContain('Morgan: Tournament schedule changed.');
        expect(rows[1]).toContain('Bears');
        expect(rows[1]).toContain('No messages yet');

        await act(async () => {
            onPreview?.({
                teamId: 'team-1',
                lastMessage: chatMessage({
                    id: 'last-1',
                    text: 'Practice packet posted.',
                    createdAt: new Date('2026-05-21T14:00:00Z')
                }),
                preferredConversationId: null,
                isMuted: false
            });
        });
        await flush();

        rows = Array.from(container.querySelectorAll('.message-row')).map((row) => row.textContent || '');
        expect(rows[0]).toContain('Thunder');
        expect(rows[1]).toContain('Bears');
        expect(container.textContent).toContain('Morgan: Tournament schedule changed.');
        expect(container.textContent).toContain('Coach Jamie: Practice packet posted.');
    });

    it('refreshes the inbox and keeps the latest preview copy visible', async () => {
        chatMocks.loadChatInbox
            .mockResolvedValueOnce({
                teams: [
                    {
                        id: 'team-1',
                        name: 'Bears',
                        sport: 'Basketball',
                        role: 'Admin',
                        canModerate: true,
                        unreadCount: 0,
                        lastMessage: chatMessage({ id: 'last-1', text: 'Older team update.' })
                    },
                    {
                        id: 'team-2',
                        name: 'Thunder',
                        sport: 'Soccer',
                        role: 'Parent',
                        canModerate: false,
                        unreadCount: 1,
                        lastMessage: chatMessage({ id: 'last-2', senderName: 'Morgan', text: 'Direct ride plan.' })
                    }
                ]
            })
            .mockResolvedValueOnce({
                teams: [
                    {
                        id: 'team-1',
                        name: 'Bears',
                        sport: 'Basketball',
                        role: 'Admin',
                        canModerate: true,
                        unreadCount: 0,
                        lastMessage: chatMessage({ id: 'last-3', text: 'Newest schedule confirmation.', createdAt: new Date('2026-05-21T15:00:00Z') })
                    },
                    {
                        id: 'team-2',
                        name: 'Thunder',
                        sport: 'Soccer',
                        role: 'Parent',
                        canModerate: false,
                        unreadCount: 1,
                        lastMessage: chatMessage({ id: 'last-2', senderName: 'Morgan', text: 'Direct ride plan.' })
                    }
                ]
            });

        const { container } = await renderMessages('/messages');
        expect(container.textContent).toContain('Coach Jamie: Older team update.');

        await click(container, 'Refresh messages');

        expect(chatMocks.loadChatInbox).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Coach Jamie: Newest schedule confirmation.');
        expect(container.textContent).toContain('Morgan: Direct ride plan.');
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

    it('shows a search-specific empty state and restores the inbox when cleared', async () => {
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

        await setFieldValue(search, 'volleyball');

        expect(container.textContent).toContain('No team chats match “volleyball”');
        expect(container.textContent).toContain('Clear search');
        expect(container.textContent).not.toContain('No team chats yet');
        expect(container.textContent).not.toContain('Join or create a team to start messaging.');

        await click(container, 'Clear search');

        expect(search.value).toBe('');
        expect(container.textContent).toContain('Bears');
        expect(container.textContent).toContain('Thunder');
    });

    it('keeps the current desktop thread selected while filtering the inbox', async () => {
        layoutMocks.isDesktopWeb = true;
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

        expect(container.querySelector('.messages-list-pane')).toBeTruthy();
        expect(container.querySelector('.chat-window-embedded')).toBeTruthy();
        expect(chatMocks.loadChatTeamContext).toHaveBeenCalledWith('team-1', auth.user);
        const initialContextLoadCount = chatMocks.loadChatTeamContext.mock.calls.length;
        const initialSubscriptionCount = chatMocks.subscribeToTeamChatMessages.mock.calls.length;
        expect(container.textContent).toContain('Bring both jerseys.');

        await setFieldValue(search, 'soccer');

        const visibleInboxRows = Array.from(container.querySelectorAll('.message-row')).map((row) => row.textContent);
        expect(visibleInboxRows).toHaveLength(1);
        expect(visibleInboxRows[0]).toContain('Thunder');
        expect(container.textContent).toContain('Bring both jerseys.');
        expect(chatMocks.loadChatTeamContext).toHaveBeenCalledTimes(initialContextLoadCount);
        expect(chatMocks.subscribeToTeamChatMessages).toHaveBeenCalledTimes(initialSubscriptionCount);
        expect(chatMocks.loadChatTeamContext).not.toHaveBeenCalledWith('team-2', auth.user);
    });

    it('does not reload the desktop thread when typing in the search box', async () => {
        layoutMocks.isDesktopWeb = true;
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

        // Initial load should select team-1 (first team).
        expect(chatMocks.loadChatTeamContext).toHaveBeenCalledWith('team-1', auth.user);
        expect(container.textContent).toContain('Bring both jerseys.');
        const callCountAfterLoad = chatMocks.loadChatTeamContext.mock.calls.length;

        // Type in the search box so that only Thunder matches — team-1 is filtered out.
        const search = container.querySelector('input[placeholder="Search team chats"]');
        await setFieldValue(search, 'soccer');

        // The inbox list should now show only Thunder (Bears filtered out of the inbox pane).
        const listPane = container.querySelector('.messages-list-pane');
        expect(listPane.textContent).toContain('Thunder');
        expect(listPane.textContent).not.toContain('Bears');

        // The chat window must NOT have reloaded — loadChatTeamContext call count is unchanged.
        expect(chatMocks.loadChatTeamContext.mock.calls.length).toBe(callCountAfterLoad);

        // The original Bears thread must still be visible in the chat pane.
        expect(container.querySelector('.messages-chat-pane').textContent).toContain('Bring both jerseys.');
    });

    it('resets the desktop selection when refresh removes the active inbox team', async () => {
        layoutMocks.isDesktopWeb = true;
        chatMocks.loadChatInbox
            .mockResolvedValueOnce({
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
                        role: 'Admin',
                        canModerate: true,
                        unreadCount: 0,
                        lastMessage: chatMessage({ id: 'last-2', senderName: 'Coach Taylor', text: 'Travel roster posted.' })
                    }
                ]
            })
            .mockResolvedValueOnce({
                teams: [
                    {
                        id: 'team-2',
                        name: 'Thunder',
                        sport: 'Soccer',
                        role: 'Admin',
                        canModerate: true,
                        unreadCount: 0,
                        lastMessage: chatMessage({ id: 'last-3', senderName: 'Coach Taylor', text: 'Travel roster posted.' })
                    }
                ]
            });
        chatMocks.loadChatTeamContext.mockImplementation(async (requestedTeamId) => ({
            team: {
                id: requestedTeamId,
                name: requestedTeamId === 'team-1' ? 'Bears' : 'Thunder',
                sport: requestedTeamId === 'team-1' ? 'Basketball' : 'Soccer'
            },
            profile: { fullName: 'Pat Parent', photoUrl: '' },
            canModerate: true
        }));
        chatMocks.loadChatConversations.mockImplementation(async (requestedTeamId) => ([
            {
                id: 'team',
                type: 'team',
                name: requestedTeamId === 'team-1' ? 'Bears Team Chat' : 'Thunder Team Chat',
                participantIds: [],
                participantRoles: ['team']
            }
        ]));
        chatMocks.subscribeToTeamChatMessages.mockImplementation((requestedTeamId, _conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: `msg-${requestedTeamId}`,
                    senderId: requestedTeamId === 'team-1' ? 'coach-1' : 'coach-2',
                    senderName: requestedTeamId === 'team-1' ? 'Coach Jamie' : 'Coach Taylor',
                    text: requestedTeamId === 'team-1' ? 'Bring both jerseys.' : 'Travel roster posted.'
                })
            ], { id: `cursor-${requestedTeamId}` });
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages');

        expect(chatMocks.loadChatTeamContext).toHaveBeenCalledWith('team-1', auth.user);
        expect(container.querySelector('.messages-chat-pane').textContent).toContain('Bring both jerseys.');

        await click(container, 'Refresh messages');

        expect(chatMocks.loadChatInbox).toHaveBeenCalledTimes(2);
        expect(chatMocks.loadChatTeamContext).toHaveBeenLastCalledWith('team-2', auth.user);
        expect(container.querySelector('.messages-chat-pane').textContent).toContain('Travel roster posted.');
        expect(container.querySelector('.messages-chat-pane').textContent).toContain('Thunder Team Chat');
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

    it('suggests teammate mentions from recipient options and inserts the selected mention', async () => {
        const { container } = await renderMessages('/messages/team-1');
        const composer = container.querySelector('.chat-composer-textarea');

        await setFieldValue(composer, 'Can @co');

        expect(chatMocks.loadChatRecipientOptions).toHaveBeenCalledWith('team-1');
        expect(container.textContent).toContain('@Coach Jamie');

        await click(container, '@Coach Jamie');

        expect(composer.value).toBe('Can @Coach Jamie ');
    });

    it('keeps mention suggestions visible for multi-word full-name queries', async () => {
        const { container } = await renderMessages('/messages/team-1');
        const composer = container.querySelector('.chat-composer-textarea');

        await setFieldValue(composer, 'Can @Coach J');

        expect(chatMocks.loadChatRecipientOptions).toHaveBeenCalledWith('team-1');
        expect(container.textContent).toContain('@Coach Jamie');

        await click(container, '@Coach Jamie');

        expect(composer.value).toBe('Can @Coach Jamie ');
    });

    it('does not keep teammate suggestions open after a completed mention or a bare at-sign', async () => {
        const { container } = await renderMessages('/messages/team-1');
        const composer = container.querySelector('.chat-composer-textarea');

        await setFieldValue(composer, '@');
        expect(container.querySelector('[aria-label="Mention suggestions"]')).toBeNull();

        await setFieldValue(composer, 'Can @co');
        expect(container.querySelector('[aria-label="Mention suggestions"]')).toBeTruthy();

        await click(container, '@Coach Jamie');

        expect(composer.value).toBe('Can @Coach Jamie ');
        expect(container.querySelector('[aria-label="Mention suggestions"]')).toBeNull();
    });

    it('replaces the rest of an active mention token during keyboard selection', async () => {
        const { container } = await renderMessages('/messages/team-1');
        const composer = container.querySelector('.chat-composer-textarea');

        await setFieldValue(composer, 'Hi @coac team');

        await act(async () => {
            composer.focus();
            composer.setSelectionRange(7, 7);
            composer.dispatchEvent(new Event('select', { bubbles: true }));
        });
        await flush();

        expect(container.querySelector('[aria-label="Mention suggestions"]')).toBeTruthy();

        await act(async () => {
            composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await flush();

        expect(composer.value).toBe('Hi @Coach Jamie team');
        expect(container.querySelector('[aria-label="Mention suggestions"]')).toBeNull();
    });

    it('uses the clicked cursor position when keyboard-selecting a mention from the middle of a draft', async () => {
        const { container } = await renderMessages('/messages/team-1');
        const composer = container.querySelector('.chat-composer-textarea');

        await setFieldValue(composer, 'Need @coach and @pa');

        await act(async () => {
            composer.focus();
            composer.setSelectionRange(17, 17);
            composer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();

        expect(container.querySelector('[aria-label="Mention suggestions"]')).toBeTruthy();

        await act(async () => {
            composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await flush();

        expect(composer.value).toBe('Need @coach and @Pat ');
        expect(container.querySelector('[aria-label="Mention suggestions"]')).toBeNull();
    });

    it('does not recompute existing message html while the composer changes', async () => {
        const chatLogic = await import('../../apps/app/src/lib/chatLogic.ts');
        const formatSpy = vi.spyOn(chatLogic, 'formatChatMessageHtml');
        const { container } = await renderMessages('/messages/team-1');

        expect(formatSpy).toHaveBeenCalledTimes(2);
        formatSpy.mockClear();

        const textarea = container.querySelector('textarea');
        await setFieldValue(textarea, 'Drafting a quick update');
        expect(formatSpy).not.toHaveBeenCalled();

        await click(container, 'Add attachment');
        expect(formatSpy).not.toHaveBeenCalled();

        formatSpy.mockRestore();
    });

    it('rerenders sender labels when sender email or ai name changes', async () => {
        let emitMessages = () => {};
        chatMocks.subscribeToTeamChatMessages.mockImplementation((teamId, conversationId, onMessages) => {
            emitMessages = onMessages;
            onMessages([
                chatMessage({
                    id: 'msg-email',
                    text: 'Email fallback label',
                    senderId: 'coach-1',
                    senderName: '',
                    senderEmail: 'old-coach@example.com'
                }),
                chatMessage({
                    id: 'msg-ai',
                    text: 'AI summary',
                    ai: true,
                    aiName: 'Old Assistant',
                    senderId: '',
                    senderName: ''
                })
            ], { id: 'cursor' });
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages/team-1');

        expect(container.textContent).toContain('old-coach@example.com');
        expect(container.textContent).toContain('Old Assistant');

        await act(async () => {
            emitMessages([
                chatMessage({
                    id: 'msg-email',
                    text: 'Email fallback label',
                    senderId: 'coach-1',
                    senderName: '',
                    senderEmail: 'new-coach@example.com'
                }),
                chatMessage({
                    id: 'msg-ai',
                    text: 'AI summary',
                    ai: true,
                    aiName: 'New Assistant',
                    senderId: '',
                    senderName: ''
                })
            ], { id: 'cursor' });
        });
        await flush();

        expect(container.textContent).toContain('new-coach@example.com');
        expect(container.textContent).toContain('New Assistant');
        expect(container.textContent).not.toContain('old-coach@example.com');
        expect(container.textContent).not.toContain('Old Assistant');
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
        await flush();
        expect(scroller.scrollTop).toBe(700);
    });

    it('forces the initial latest scroll using the rendered content height when the thread grows after layout', async () => {
        let emitMessages = () => {};
        chatMocks.subscribeToTeamChatMessages.mockImplementation((_teamId, _conversationId, onMessages) => {
            emitMessages = onMessages;
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages/team-1');
        const scrollIntoView = window.HTMLElement.prototype.scrollIntoView;
        const scroller = container.querySelector('.chat-messages-scroll');
        const content = container.querySelector('.chat-messages-content');

        Object.defineProperties(scroller, {
            scrollHeight: { configurable: true, writable: true, value: 240 },
            clientHeight: { configurable: true, value: 300 },
            scrollTop: { configurable: true, writable: true, value: 0 }
        });
        Object.defineProperty(content, 'scrollHeight', { configurable: true, writable: true, value: 420 });

        scrollIntoView.mockClear();

        await act(async () => {
            emitMessages([
                chatMessage({ id: 'msg-1', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bring both jerseys.' }),
                chatMessage({ id: 'msg-2', senderId: 'user-1', senderName: 'Pat Parent', text: 'We can bring snacks.', createdAt: new Date('2026-05-21T14:02:00Z') })
            ], { id: 'cursor' });
        });
        await flush();

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });
        expect(scroller.scrollTop).toBe(120);
    });

    it('pins the thread to the latest message after opening a chat from the inbox view', async () => {
        let emitMessages = () => {};
        chatMocks.subscribeToTeamChatMessages.mockImplementation((_teamId, _conversationId, onMessages) => {
            emitMessages = onMessages;
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages');
        const scrollIntoView = window.HTMLElement.prototype.scrollIntoView;
        const inboxLink = container.querySelector('a[href="/messages/team-1"]');

        await act(async () => {
            inboxLink.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        });
        await flush();

        const scroller = container.querySelector('.chat-messages-scroll');
        const content = container.querySelector('.chat-messages-content');
        Object.defineProperties(scroller, {
            scrollHeight: { configurable: true, writable: true, value: 260 },
            clientHeight: { configurable: true, value: 300 },
            scrollTop: { configurable: true, writable: true, value: 0 }
        });
        Object.defineProperty(content, 'scrollHeight', { configurable: true, writable: true, value: 460 });

        scrollIntoView.mockClear();

        await act(async () => {
            emitMessages([
                chatMessage({ id: 'msg-1', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bring both jerseys.' }),
                chatMessage({ id: 'msg-2', senderId: 'user-1', senderName: 'Pat Parent', text: 'We can bring snacks.', createdAt: new Date('2026-05-21T14:40:00Z') }),
                chatMessage({ id: 'msg-3', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Latest ride update.', createdAt: new Date('2026-05-21T14:45:00Z') })
            ], { id: 'cursor' });
        });
        await flush();

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });
        expect(scroller.scrollTop).toBe(160);
    });

    it('coalesces auto-scroll scheduling, no-ops bounded follow-up retries, and only re-arms after height growth while pinned', async () => {
        let emitMessages = () => {};
        chatMocks.subscribeToTeamChatMessages.mockImplementation((teamId, conversationId, onMessages) => {
            emitMessages = onMessages;
            onMessages([
                chatMessage({ id: 'msg-1', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bring both jerseys.' }),
                chatMessage({ id: 'msg-2', senderId: 'user-1', senderName: 'Pat Parent', text: 'We can bring snacks.', createdAt: new Date('2026-05-21T14:02:00Z') })
            ], { id: 'cursor' });
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages/team-1');
        const scrollIntoView = window.HTMLElement.prototype.scrollIntoView;
        const scroller = container.querySelector('.chat-messages-scroll');
        const content = container.querySelector('.chat-messages-content');

        Object.defineProperties(scroller, {
            scrollHeight: { configurable: true, writable: true, value: 1000 },
            clientHeight: { configurable: true, value: 300 },
            scrollTop: { configurable: true, writable: true, value: 700 }
        });
        Object.defineProperty(content, 'scrollHeight', { configurable: true, writable: true, value: 1000 });

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        scrollIntoView.mockClear();

        await act(async () => {
            emitMessages([
                chatMessage({ id: 'msg-1', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bring both jerseys.' }),
                chatMessage({ id: 'msg-2', senderId: 'user-1', senderName: 'Pat Parent', text: 'We can bring snacks.', createdAt: new Date('2026-05-21T14:02:00Z') }),
                chatMessage({ id: 'msg-3', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bus leaves in 10.', createdAt: new Date('2026-05-21T14:03:00Z') })
            ], { id: 'cursor' });
        });
        await flush();
        await flush();

        expect(scrollIntoView).toHaveBeenCalledTimes(1);

        await act(async () => {
            resizeObserverState.instances.forEach((instance) => instance.trigger());
        });
        await flush();
        expect(scrollIntoView).toHaveBeenCalledTimes(1);

        content.scrollHeight = 1120;
        scroller.scrollHeight = 1120;
        await act(async () => {
            resizeObserverState.instances.forEach((instance) => instance.trigger());
        });
        await flush();

        expect(scrollIntoView.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('preserves scroll position and shows Latest when new messages arrive while scrolled up', async () => {
        let emitMessages = () => {};
        chatMocks.subscribeToTeamChatMessages.mockImplementation((teamId, conversationId, onMessages) => {
            emitMessages = onMessages;
            onMessages([
                chatMessage({ id: 'msg-1', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bring both jerseys.' }),
                chatMessage({ id: 'msg-2', senderId: 'user-1', senderName: 'Pat Parent', text: 'We can bring snacks.', createdAt: new Date('2026-05-21T14:02:00Z') })
            ], { id: 'cursor' });
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages/team-1');
        const scrollIntoView = window.HTMLElement.prototype.scrollIntoView;
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

        scrollIntoView.mockClear();

        await act(async () => {
            emitMessages([
                chatMessage({ id: 'msg-1', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bring both jerseys.' }),
                chatMessage({ id: 'msg-2', senderId: 'user-1', senderName: 'Pat Parent', text: 'We can bring snacks.', createdAt: new Date('2026-05-21T14:02:00Z') }),
                chatMessage({ id: 'msg-3', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bus leaves in 10.', createdAt: new Date('2026-05-21T14:03:00Z') })
            ], { id: 'cursor' });
        });
        await flush();

        expect(scrollIntoView).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Latest');
        expect(scroller.scrollTop).toBe(0);
    });

    it('keeps the moderator thread visible while Team Email recipients load', async () => {
        const deferredRecipients = createDeferred();
        chatMocks.loadChatRecipientOptions.mockImplementationOnce(() => deferredRecipients.promise);

        const { container } = await renderMessages('/messages/team-1');

        expect(container.textContent).toContain('Bring both jerseys.');
        expect(chatMocks.loadChatRecipientOptions).not.toHaveBeenCalled();

        await click(container, 'Team Email');

        expect(chatMocks.loadChatRecipientOptions).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[role="dialog"][aria-label="Team Email"]')).toBeTruthy();
        expect(container.textContent).toContain('Bring both jerseys.');

        await act(async () => {
            deferredRecipients.resolve([
                { id: 'user:coach-1', name: 'Coach Jamie', detail: 'Staff' },
                { id: 'player:player-1', name: 'Pat', detail: '#9' }
            ]);
        });
        await flush();

        expect(container.textContent).not.toContain('Loading recipient options...');
        await click(container, 'Close Team Email');
        await click(container, 'Audience: Full team');
        await click(container, 'Selected members');
        expect(container.textContent).toContain('Coach Jamie');
    });

    it('loads recipient options once on first moderator tool open and reuses the cache', async () => {
        const { container } = await renderMessages('/messages/team-1');

        expect(chatMocks.loadChatRecipientOptions).not.toHaveBeenCalled();

        await click(container, 'Team Email');
        expect(chatMocks.loadChatRecipientOptions).toHaveBeenCalledTimes(1);

        await click(container, 'Close Team Email');
        await click(container, 'Audience: Full team');
        await click(container, 'Selected members');

        expect(chatMocks.loadChatRecipientOptions).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Coach Jamie');

        await click(container, 'Full team');
        await click(container, 'Team Email');
        expect(chatMocks.loadChatRecipientOptions).toHaveBeenCalledTimes(1);
    });

    it('reuses the mention recipient cache when opening selected members after suggestions load', async () => {
        const { container } = await renderMessages('/messages/team-1');
        const composer = container.querySelector('.chat-composer-textarea');

        await setFieldValue(composer, 'Can @co');

        expect(chatMocks.loadChatRecipientOptions).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('@Coach Jamie');

        await click(container, 'Audience: Full team');
        await click(container, 'Selected members');

        expect(chatMocks.loadChatRecipientOptions).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Coach Jamie');
    });

    it('ignores stale recipient option loads after switching teams', async () => {
        layoutMocks.isDesktopWeb = true;
        const deferredRecipients = createDeferred();
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
                    role: 'Admin',
                    canModerate: true,
                    unreadCount: 0,
                    lastMessage: chatMessage({ id: 'last-2', senderName: 'Coach Taylor', text: 'Travel roster posted.' })
                }
            ]
        });
        chatMocks.loadChatTeamContext.mockImplementation(async (requestedTeamId) => ({
            team: {
                id: requestedTeamId,
                name: requestedTeamId === 'team-1' ? 'Bears' : 'Thunder',
                sport: requestedTeamId === 'team-1' ? 'Basketball' : 'Soccer'
            },
            profile: { fullName: 'Pat Parent', photoUrl: '' },
            canModerate: true
        }));
        chatMocks.loadChatConversations.mockImplementation(async (requestedTeamId) => ([
            {
                id: 'team',
                type: 'team',
                name: requestedTeamId === 'team-1' ? 'Bears Team Chat' : 'Thunder Team Chat',
                participantIds: [],
                participantRoles: ['team']
            }
        ]));
        chatMocks.loadChatRecipientOptions
            .mockImplementationOnce(() => deferredRecipients.promise)
            .mockResolvedValueOnce([
                { id: 'user:coach-2', name: 'Coach Taylor', detail: 'Staff' }
            ]);

        const { container } = await renderMessages('/messages');

        await click(container, 'Team Email');
        expect(chatMocks.loadChatRecipientOptions).toHaveBeenCalledTimes(1);
        expect(chatMocks.loadChatRecipientOptions).toHaveBeenLastCalledWith('team-1');

        const thunderLink = container.querySelector('a[href="/messages/team-2"]');
        await act(async () => {
            thunderLink.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        });
        await flush();

        await act(async () => {
            deferredRecipients.resolve([
                { id: 'user:coach-1', name: 'Coach Jamie', detail: 'Staff' }
            ]);
        });
        await flush();

        await click(container, 'Close Team Email');
        await click(container, 'Team Email');

        await waitForMockCallCount(chatMocks.loadChatRecipientOptions, 2, 'second team recipient option load');
        expect(chatMocks.loadChatRecipientOptions).toHaveBeenLastCalledWith('team-2');
        expect(container.textContent).toContain('Thunder Team Chat');

        await click(container, 'Close Team Email');
        await click(container, 'Audience: Full team');
        await click(container, 'Selected members');

        const recipientLabels = Array.from(container.querySelectorAll('label')).map((label) => label.textContent || '');
        expect(recipientLabels.some((label) => label.includes('Coach Taylor'))).toBe(true);
        expect(recipientLabels.some((label) => label.includes('Coach Jamie'))).toBe(false);
    });

    it('keeps staff conversation targeting contextual and sends the selected audience metadata', async () => {
        chatMocks.loadChatConversations.mockResolvedValueOnce([
            { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] },
            { id: 'staff-conversation', type: 'group', name: 'Staff only', participantIds: ['user-1'], participantRoles: ['staff'] }
        ]);

        const { container } = await renderMessages('/messages/team-1?conversationId=staff-conversation');

        expect(chatMocks.ensureStaffChatConversation).not.toHaveBeenCalled();
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
        const coachCheckbox = await waitForRecipientCheckbox(container, 'Coach Jamie');
        await act(async () => {
            coachCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();
        await click(container, 'Done');
        await click(container, 'Open staff actions');
        expect(container.textContent).toContain('Current: Coach Jamie (Staff)');
        await click(container, 'Open staff actions');

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

    it('shows Team Email only to moderators and queues email with the selected audience', async () => {
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Audience: Full team');
        await click(container, 'Selected members');
        const coachCheckbox = await waitForRecipientCheckbox(container, 'Coach Jamie');
        await act(async () => {
            coachCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();
        await click(container, 'Done');
        await click(container, 'Team Email');
        const emailDialog = await waitForTeamEmailDialog(container);

        expect(chatMocks.loadSentTeamEmails).toHaveBeenCalledWith('team-1', { limit: 25 });
        expect(container.textContent).toContain('Sends one backend roster email job');
        expect(container.textContent).toContain('Audience: Coach Jamie (Staff)');
        expect(container.textContent).toContain('Practice plan');
        expect(container.textContent).not.toContain('coach@example.com');

        const subjectInput = emailDialog.querySelector('input[placeholder="Team update"]');
        const bodyInput = emailDialog.querySelector('textarea[placeholder="Write the email body..."]');
        await setFieldValue(subjectInput, 'Tournament update');
        await setFieldValue(bodyInput, 'Arrive at 8:30.');
        await click(container, 'Send email');

        expect(chatMocks.sendTeamEmailMessage).toHaveBeenCalledWith({
            teamId: 'team-1',
            subject: 'Tournament update',
            body: 'Arrive at 8:30.',
            targetType: 'individuals',
            recipientIds: ['user:coach-1']
        });
        expect(subjectInput.value).toBe('');
        expect(bodyInput.value).toBe('');
        expect(container.textContent).toContain('Queued 12 recipients for backend email delivery.');

        chatMocks.loadChatTeamContext.mockResolvedValueOnce({
            team: { id: 'team-1', name: 'Bears', sport: 'Basketball' },
            profile: { fullName: 'Pat Parent', photoUrl: '' },
            canModerate: false
        });
        const parentView = await renderMessages('/messages/team-1');
        expect(parentView.container.textContent).not.toContain('Team Email');
    });

    it('preserves Team Email send success when sent history refresh fails', async () => {
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Team Email');
        chatMocks.loadSentTeamEmails.mockRejectedValueOnce(new Error('History refresh down'));
        const emailDialog = await waitForTeamEmailDialog(container);
        const subjectInput = emailDialog.querySelector('input[placeholder="Team update"]');
        const bodyInput = emailDialog.querySelector('textarea[placeholder="Write the email body..."]');
        await setFieldValue(subjectInput, 'Schedule');
        await setFieldValue(bodyInput, 'Game moved.');
        await click(container, 'Send email');

        expect(chatMocks.sendTeamEmailMessage).toHaveBeenCalled();
        expect(container.textContent).toContain('Queued 12 recipients for backend email delivery.');
        expect(container.textContent).not.toContain('History refresh down');
        expect(subjectInput.value).toBe('');
        expect(bodyInput.value).toBe('');
    });

    it('keeps Team Email send success separate from stale history load errors', async () => {
        let rejectInitialHistory;
        const initialHistoryLoad = new Promise((resolve, reject) => {
            rejectInitialHistory = reject;
        });
        chatMocks.loadSentTeamEmails
            .mockImplementationOnce(() => initialHistoryLoad)
            .mockResolvedValueOnce([
                {
                    id: 'email-2',
                    subject: 'Schedule',
                    senderName: 'Coach Jamie',
                    sentAt: new Date('2026-05-22T15:00:00Z'),
                    recipientCount: 12,
                    status: 'queued'
                }
            ]);
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Team Email');
        const emailDialog = await waitForTeamEmailDialog(container);
        const subjectInput = emailDialog.querySelector('input[placeholder="Team update"]');
        const bodyInput = emailDialog.querySelector('textarea[placeholder="Write the email body..."]');
        await setFieldValue(subjectInput, 'Schedule');
        await setFieldValue(bodyInput, 'Game moved.');
        await click(container, 'Send email');

        expect(container.textContent).toContain('Queued 12 recipients for backend email delivery.');

        await act(async () => {
            rejectInitialHistory(new Error('Initial history down'));
            await initialHistoryLoad.catch(() => undefined);
        });
        await flush();

        expect(container.textContent).toContain('Queued 12 recipients for backend email delivery.');
        expect(container.textContent).toContain('Initial history down');
        expect(subjectInput.value).toBe('');
        expect(bodyInput.value).toBe('');
    });

    it('keeps Team Email drafts when backend sending fails', async () => {
        chatMocks.sendTeamEmailMessage.mockRejectedValueOnce(new Error('Callable down'));
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Team Email');
        const emailDialog = await waitForTeamEmailDialog(container);
        const subjectInput = emailDialog.querySelector('input[placeholder="Team update"]');
        const bodyInput = emailDialog.querySelector('textarea[placeholder="Write the email body..."]');
        await setFieldValue(subjectInput, 'Schedule');
        await setFieldValue(bodyInput, 'Game moved.');
        await click(container, 'Send email');

        expect(container.textContent).toContain('Callable down');
        expect(subjectInput.value).toBe('Schedule');
        expect(bodyInput.value).toBe('Game moved.');
    });

    it('blocks selected member sends until at least one recipient is checked', async () => {
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Audience: Full team');
        await click(container, 'Selected members');

        expect(container.textContent).toContain('Choose at least one selected member, or switch back to Full team.');
        expect(buttonByText(container, 'Done').disabled).toBe(true);

        const textarea = container.querySelector('textarea');
        expect(textarea.disabled).toBe(true);
        expect(buttonByText(container, 'Send message').disabled).toBe(true);
        await setFieldValue(textarea, 'This should stay targeted.');

        expect(container.textContent).toContain('Choose at least one selected member, or switch back to Full team.');
        expect(container.textContent).toContain('Message audience');
        expect(chatMocks.sendTeamChatMessage).not.toHaveBeenCalled();
    });

    it('allows player-only email drafts and disables draft saving for full-team or staff audiences', async () => {
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Audience: Full team');
        await click(container, 'Selected members');
        const playerCheckbox = Array.from(container.querySelectorAll('label')).find((label) => label.textContent.includes('Pat'))?.querySelector('input[type="checkbox"]');
        await act(async () => {
            playerCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();
        await click(container, 'Done');
        await click(container, 'Team Email');

        let emailDialog = await waitForTeamEmailDialog(container);
        let subjectInput = emailDialog.querySelector('input[placeholder="Team update"]');
        let bodyInput = emailDialog.querySelector('textarea[placeholder="Write the email body..."]');
        await setFieldValue(subjectInput, 'Roster update');
        await setFieldValue(bodyInput, 'Please confirm availability.');
        await click(container, 'Save draft');

        expect(chatMocks.saveTeamEmailDraft).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            recipientIds: ['player:player-1']
        }));
        expect(container.textContent).toContain('Saved draft');

        await click(container, 'Close');
        await click(container, 'Audience: Pat (#9)');
        await click(container, 'Full team');
        await click(container, 'Team Email');

        emailDialog = await waitForTeamEmailDialog(container);
        subjectInput = emailDialog.querySelector('input[placeholder="Team update"]');
        bodyInput = emailDialog.querySelector('textarea[placeholder="Write the email body..."]');
        await setFieldValue(subjectInput, 'Schedule');
        await setFieldValue(bodyInput, 'Game moved.');
        expect(buttonByText(container, 'Save draft').disabled).toBe(true);
        expect(container.textContent).toContain('Draft saving is available only for Selected members.');

        chatMocks.loadChatConversations.mockResolvedValueOnce([
            { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] },
            { id: 'staff-conversation', type: 'group', name: 'Staff only', participantIds: ['user-1'], participantRoles: ['staff'] }
        ]);
        const staffView = await renderMessages('/messages/team-1?conversationId=staff-conversation');

        await click(staffView.container, 'Team Email');

        emailDialog = await waitForTeamEmailDialog(staffView.container);
        subjectInput = emailDialog.querySelector('input[placeholder="Team update"]');
        bodyInput = emailDialog.querySelector('textarea[placeholder="Write the email body..."]');
        await setFieldValue(subjectInput, 'Staff schedule');
        await setFieldValue(bodyInput, 'Film at 6.');
        expect(buttonByText(staffView.container, 'Save draft').disabled).toBe(true);
        expect(staffView.container.textContent).toContain('Draft saving is available only for Selected members.');
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

    it('renders inline chat image attachments with deferred loading attrs and gallery actions', async () => {
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

        const inlineImage = container.querySelector('img[alt="Lineup.jpg"]');
        const inlineImageLink = container.querySelector('a[href="https://media.example.test/lineup.jpg"]');
        expect(inlineImage).toBeTruthy();
        expect(inlineImage.getAttribute('src')).toBe('https://media.example.test/lineup.jpg');
        expect(inlineImage.getAttribute('loading')).toBe('lazy');
        expect(inlineImage.getAttribute('decoding')).toBe('async');
        expect(inlineImageLink).toBeTruthy();

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

    it('renders team media photo posts inline with native lazy-loading and includes them in the gallery', async () => {
        chatMocks.subscribeToTeamChatMessages.mockImplementation((teamId, conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: 'msg-team-media',
                    text: '',
                    attachments: [
                        {
                            type: 'photo',
                            url: 'https://media.example.test/tipoff.jpg',
                            title: 'Tipoff'
                        }
                    ]
                })
            ], { id: 'cursor' });
            return { unsubscribe: vi.fn() };
        });
        const { container } = await renderMessages('/messages/team-1');

        const inlinePhoto = container.querySelector('img[alt="Tipoff"]');
        const inlinePhotoLink = container.querySelector('a[href="https://media.example.test/tipoff.jpg"]');
        expect(inlinePhoto).toBeTruthy();
        expect(inlinePhoto.getAttribute('src')).toBe('https://media.example.test/tipoff.jpg');
        expect(inlinePhoto.getAttribute('loading')).toBe('lazy');
        expect(inlinePhoto.getAttribute('decoding')).toBe('async');
        expect(inlinePhotoLink).toBeTruthy();

        await click(container, 'Open photos and videos');
        expect(container.textContent).toContain('Photos & videos');
        expect(container.textContent).toContain('Tipoff');
    });

    it('keeps inline videos fully deferred when a thread first opens', async () => {
        chatMocks.subscribeToTeamChatMessages.mockImplementation((teamId, conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: 'msg-video-initial',
                    text: '',
                    attachments: [
                        {
                            type: 'video',
                            url: 'https://media.example.test/warmups.mp4',
                            name: 'Warmups.mp4'
                        },
                        {
                            type: 'video',
                            url: 'https://media.example.test/huddle.mp4',
                            name: 'Huddle.mp4'
                        }
                    ]
                })
            ], { id: 'cursor' });
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages/team-1');
        const videos = Array.from(container.querySelectorAll('video'));
        expect(videos).toHaveLength(2);
        videos.forEach((video) => {
            expect(video.getAttribute('preload')).toBe('none');
            expect(video.getAttribute('src')).toBeNull();
        });
        expect(intersectionObserverState.instances).toHaveLength(0);

        await flush();
        videos.forEach((video) => {
            expect(video.getAttribute('preload')).toBe('none');
            expect(video.getAttribute('src')).toBeNull();
        });
    });

    it('defers inline video loading until the attachment is explicitly interacted with', async () => {
        chatMocks.subscribeToTeamChatMessages.mockImplementation((teamId, conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: 'msg-video',
                    text: '',
                    attachments: [
                        {
                            type: 'video',
                            url: 'https://media.example.test/warmups.mp4',
                            name: 'Warmups.mp4'
                        }
                    ]
                })
            ], { id: 'cursor' });
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages/team-1');
        const video = container.querySelector('video[data-chat-attachment-url="https://media.example.test/warmups.mp4"]');
        expect(video).toBeTruthy();
        expect(video.getAttribute('preload')).toBe('none');
        expect(video.getAttribute('src')).toBeNull();
        expect(intersectionObserverState.instances).toHaveLength(0);

        await act(async () => {
            video.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        });
        await flush();
        expect(video.getAttribute('preload')).toBe('metadata');
        expect(video.getAttribute('src')).toBe('https://media.example.test/warmups.mp4');
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

    it('queues optimistic chat sends without blocking the composer', async () => {
        const firstSend = createDeferred();
        const secondSend = createDeferred();
        chatMocks.sendTeamChatMessage
            .mockImplementationOnce(() => firstSend.promise)
            .mockImplementationOnce(() => secondSend.promise);
        const { container } = await renderMessages('/messages/team-1');
        const textarea = container.querySelector('textarea');

        await setFieldValue(textarea, 'First update');
        await click(container, 'Send message');

        expect(textarea.value).toBe('');
        expect(container.textContent).toContain('First update');
        expect(container.textContent).toContain('Sending');
        expect(chatMocks.sendTeamChatMessage).toHaveBeenCalledTimes(1);

        await setFieldValue(textarea, 'Second update');
        await click(container, 'Send message');

        expect(textarea.value).toBe('');
        expect(container.textContent).toContain('Second update');
        expect(chatMocks.sendTeamChatMessage).toHaveBeenCalledTimes(1);

        await act(async () => {
            firstSend.resolve({ conversationId: 'team', createdConversation: null, wantsAi: false });
        });
        await flush();

        expect(chatMocks.sendTeamChatMessage).toHaveBeenCalledTimes(2);
        expect(chatMocks.sendTeamChatMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
            text: 'First update',
            clientMessageId: expect.stringMatching(/^client_user-1_/)
        }));
        expect(chatMocks.sendTeamChatMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
            text: 'Second update',
            clientMessageId: expect.stringMatching(/^client_user-1_/)
        }));

        await act(async () => {
            secondSend.resolve({ conversationId: 'team', createdConversation: null, wantsAi: false });
        });
        await flush();
    });

    it('ends chat send timing only after the live sent message becomes visible', async () => {
        const sendDeferred = createDeferred();
        let emitMessages = null;
        chatMocks.subscribeToTeamChatMessages.mockImplementation((_teamId, _conversationId, onMessages) => {
            emitMessages = onMessages;
            onMessages([
                chatMessage({ id: 'msg-1', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bring both jerseys.' })
            ], { id: 'cursor' });
            return { unsubscribe: vi.fn() };
        });
        chatMocks.sendTeamChatMessage.mockImplementationOnce(() => sendDeferred.promise);
        const { container } = await renderMessages('/messages/team-1');
        const textarea = container.querySelector('textarea');

        await setFieldValue(textarea, 'Timing check');
        await click(container, 'Send message');

        expect(uxTimingMocks.startInteractionTimer).toHaveBeenCalledWith('chat send latency', {
            attachments: 0,
            target: 'full_team'
        });
        const end = uxTimingMocks.interactionEnds[0];
        expect(end).not.toHaveBeenCalled();

        const clientMessageId = chatMocks.sendTeamChatMessage.mock.calls[0][0].clientMessageId;
        await act(async () => {
            sendDeferred.resolve({ conversationId: 'team', createdConversation: null, wantsAi: false });
        });
        await flush();

        expect(end).not.toHaveBeenCalled();

        await act(async () => {
            emitMessages?.([
                chatMessage({ id: 'msg-1', senderId: 'coach-1', senderName: 'Coach Jamie', text: 'Bring both jerseys.' }),
                chatMessage({
                    id: 'msg-live-sent',
                    clientMessageId,
                    senderId: 'user-1',
                    senderName: 'Pat Parent',
                    text: 'Timing check',
                    createdAt: new Date('2026-05-21T14:03:00Z')
                })
            ], { id: 'cursor-2' });
        });
        await flush();

        expect(end).toHaveBeenCalledWith({ status: 'visible_sent' });
    });

    it('moves an optimistic selected-member send into the created conversation', async () => {
        const directSend = createDeferred();
        const teamConversation = { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] };
        const directConversation = { id: 'direct-conversation', type: 'direct', name: 'Coach Jamie', participantIds: ['user-1', 'coach-1'], participantRoles: [] };
        let conversationLoadCount = 0;
        chatMocks.loadChatConversations.mockImplementation(async () => {
            conversationLoadCount += 1;
            return conversationLoadCount === 1
                ? [teamConversation]
                : [teamConversation, directConversation];
        });
        chatMocks.subscribeToTeamChatMessages.mockImplementation((teamId, conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: `live-${conversationId}`,
                    conversationId,
                    text: conversationId === 'direct-conversation' ? 'Direct thread ready.' : 'Team thread ready.'
                })
            ], { id: `cursor-${teamId}-${conversationId}` });
            return { unsubscribe: vi.fn() };
        });
        chatMocks.sendTeamChatMessage.mockImplementationOnce(() => directSend.promise);

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

        const textarea = container.querySelector('textarea');
        await setFieldValue(textarea, 'Private follow-up');
        await click(container, 'Send message');

        expect(container.textContent).toContain('Private follow-up');
        expect(chatMocks.sendTeamChatMessage).toHaveBeenCalledWith(expect.objectContaining({
            selectedRecipientTarget: 'individuals',
            selectedRecipientIds: ['user:coach-1']
        }));

        await act(async () => {
            directSend.resolve({ conversationId: 'direct-conversation', createdConversation: directConversation, wantsAi: false });
        });
        await flush();
        await flush();

        expect(chatMocks.subscribeToTeamChatMessages).toHaveBeenLastCalledWith(
            'team-1',
            'direct-conversation',
            expect.any(Function),
            expect.any(Function)
        );
        expect(container.textContent).toContain('Private follow-up');
        expect(container.textContent).toContain('Direct thread ready.');
        expect(container.textContent).not.toContain('Team thread ready.');
    });

    it('marks failed optimistic sends retryable with the same client message id', async () => {
        chatMocks.sendTeamChatMessage
            .mockRejectedValueOnce(new Error('Callable down'))
            .mockResolvedValueOnce({ conversationId: 'team', createdConversation: null, wantsAi: false });
        const { container } = await renderMessages('/messages/team-1');
        const textarea = container.querySelector('textarea');

        await setFieldValue(textarea, 'Retry this update');
        await click(container, 'Send message');
        await flush();

        expect(container.textContent).toContain('Retry this update');
        expect(container.textContent).toContain('Callable down');
        const firstClientMessageId = chatMocks.sendTeamChatMessage.mock.calls[0][0].clientMessageId;

        await click(container, 'Retry');

        expect(chatMocks.sendTeamChatMessage).toHaveBeenCalledTimes(2);
        expect(chatMocks.sendTeamChatMessage.mock.calls[1][0].clientMessageId).toBe(firstClientMessageId);
        expect(chatMocks.sendTeamChatMessage.mock.calls[1][0].text).toBe('Retry this update');
    });

    it('sends attachment-only updates and clears local previews after posting', async () => {
        const { container } = await renderMessages('/messages/team-1');
        const fileInput = container.querySelector('input[type="file"]');
        const video = new File(['clip'], 'warmups.mp4', { type: 'video/mp4' });
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [video] });

        await act(async () => {
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await flush();

        expect(container.textContent).toContain('1 attachment ready');
        await click(container, 'Send message');

        expect(chatMocks.sendTeamChatMessage).toHaveBeenCalledWith(expect.objectContaining({
            text: '',
            files: [video],
            selectedConversationId: 'team'
        }));
        expect(container.textContent).not.toContain('1 attachment ready');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:chat-upload');
    });

    it('hides the voice button when dictation is unsupported', async () => {
        const { container } = await renderMessages('/messages/team-1');

        expect(container.querySelector('button[aria-label="Voice to text"]')).toBeNull();
    });

    it('does not reload team context when the auth object identity changes but the user id stays the same', async () => {
        const firstAuth = {
            ...auth,
            user: {
                ...auth.user
            }
        };
        const secondAuth = {
            ...auth,
            user: {
                ...auth.user
            }
        };

        const { rerender } = await renderMessages('/messages/team-1', firstAuth);

        expect(chatMocks.loadChatTeamContext).toHaveBeenCalledTimes(1);

        await rerender(secondAuth);

        expect(chatMocks.loadChatTeamContext).toHaveBeenCalledTimes(1);
    });

    it('uses the browser locale for web voice dictation and returns to the compact toolbar state', async () => {
        let recognitionInstance;
        class MockSpeechRecognition {
            constructor() {
                recognitionInstance = this;
                this.start = vi.fn();
                this.stop = vi.fn(() => {
                    this.onend?.();
                });
            }
        }

        Object.defineProperty(navigator, 'language', {
            configurable: true,
            value: 'es-MX'
        });
        voiceMocks.hasBrowserSupport.mockReturnValue(true);
        Object.defineProperty(window, 'webkitSpeechRecognition', {
            configurable: true,
            value: MockSpeechRecognition
        });

        const { container } = await renderMessages('/messages/team-1');

        expect(container.querySelector('button[aria-label="Voice to text"]')).toBeTruthy();
        expect(buttonByText(container, 'Open staff actions')).toBeTruthy();

        await click(container, 'Voice to text');
        expect(recognitionInstance.lang).toBe('es-MX');
        expect(recognitionInstance.start).toHaveBeenCalled();
        expect(container.textContent).toContain('Listening...');

        await act(async () => {
            recognitionInstance.onresult({
                results: [
                    [{ transcript: 'Leaving after warmups' }]
                ]
            });
        });
        await flush();

        const textarea = container.querySelector('textarea');
        expect(textarea.value).toBe('Leaving after warmups');

        await act(async () => {
            recognitionInstance.onend();
        });
        await flush();

        expect(container.querySelector('button[aria-label="Voice to text"]')).toBeTruthy();
        expect(container.textContent).not.toContain('Listening...');
    });

    it('falls back to en-US for browser voice dictation when navigator.language is empty', async () => {
        let recognitionInstance;
        class MockSpeechRecognition {
            constructor() {
                recognitionInstance = this;
                this.start = vi.fn();
                this.stop = vi.fn(() => {
                    this.onend?.();
                });
            }
        }

        Object.defineProperty(navigator, 'language', {
            configurable: true,
            value: ''
        });
        voiceMocks.hasBrowserSupport.mockReturnValue(true);
        Object.defineProperty(window, 'webkitSpeechRecognition', {
            configurable: true,
            value: MockSpeechRecognition
        });

        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Voice to text');

        expect(recognitionInstance.lang).toBe('en-US');
        expect(recognitionInstance.start).toHaveBeenCalled();
    });

    it('passes the device locale to native dictation and keeps listening when iOS resolves start without a result payload', async () => {
        Object.defineProperty(navigator, 'language', {
            configurable: true,
            value: 'fr-CA'
        });
        nativeMocks.isNativePlatform = true;
        voiceMocks.start.mockResolvedValue(undefined);
        const { container } = await renderMessages('/messages/team-1');

        expect(voiceMocks.available).toHaveBeenCalled();
        await click(container, 'Voice to text');

        expect(voiceMocks.start).toHaveBeenCalledWith(expect.objectContaining({
            language: 'fr-CA',
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

    it('falls back to en-US for native dictation when navigator.language is empty', async () => {
        Object.defineProperty(navigator, 'language', {
            configurable: true,
            value: ''
        });
        nativeMocks.isNativePlatform = true;
        voiceMocks.start.mockResolvedValue(undefined);
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Voice to text');

        expect(voiceMocks.start).toHaveBeenCalledWith(expect.objectContaining({
            language: 'en-US'
        }));
    });

    it('loads deep-linked mute state from the conversation-keyed team chat profile when inbox data is unavailable', async () => {
        chatMocks.loadChatTeamContext.mockResolvedValueOnce({
            team: { id: 'team-1', name: 'Bears', sport: 'Basketball' },
            profile: {
                fullName: 'Pat Parent',
                photoUrl: '',
                teamChatState: {
                    'team-1': {
                        mutedConversations: {
                            'staff-conversation': new Date('2026-06-01T12:00:00Z')
                        }
                    }
                }
            },
            canModerate: true
        });
        chatMocks.loadChatConversations.mockResolvedValueOnce([
            { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] },
            { id: 'staff-conversation', type: 'group', name: 'Staff only', participantIds: ['user-1'], participantRoles: ['staff'] }
        ]);

        const { container } = await renderMessages('/messages/team-1?conversationId=staff-conversation');

        expect(chatMocks.loadChatInbox).not.toHaveBeenCalled();
        expect(buttonByText(container, 'Unmute notifications')).toBeTruthy();
    });

    it('syncs the mute button when the desktop active team changes', async () => {
        layoutMocks.isDesktopWeb = true;
        chatMocks.loadChatInbox.mockResolvedValueOnce({
            teams: [
                {
                    id: 'team-1',
                    name: 'Bears',
                    sport: 'Basketball',
                    role: 'Admin',
                    canModerate: true,
                    unreadCount: 0,
                    isMuted: false,
                    lastMessage: chatMessage({ id: 'last-1', text: 'Practice packet posted.' })
                },
                {
                    id: 'team-2',
                    name: 'Thunder',
                    sport: 'Soccer',
                    role: 'Admin',
                    canModerate: true,
                    unreadCount: 0,
                    isMuted: true,
                    lastMessage: chatMessage({ id: 'last-2', senderName: 'Coach Taylor', text: 'Travel roster posted.' })
                }
            ]
        });
        chatMocks.loadChatTeamContext.mockImplementation(async (requestedTeamId) => ({
            team: {
                id: requestedTeamId,
                name: requestedTeamId === 'team-1' ? 'Bears' : 'Thunder',
                sport: requestedTeamId === 'team-1' ? 'Basketball' : 'Soccer'
            },
            profile: { fullName: 'Pat Parent', photoUrl: '' },
            canModerate: true
        }));
        chatMocks.loadChatConversations.mockImplementation(async (requestedTeamId) => ([
            {
                id: 'team',
                type: 'team',
                name: requestedTeamId === 'team-1' ? 'Bears Team Chat' : 'Thunder Team Chat',
                participantIds: [],
                participantRoles: ['team']
            }
        ]));
        chatMocks.subscribeToTeamChatMessages.mockImplementation((requestedTeamId, _conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: `msg-${requestedTeamId}`,
                    senderId: requestedTeamId === 'team-1' ? 'coach-1' : 'coach-2',
                    senderName: requestedTeamId === 'team-1' ? 'Coach Jamie' : 'Coach Taylor',
                    text: requestedTeamId === 'team-1' ? 'Bring both jerseys.' : 'Travel roster posted.'
                })
            ], { id: `cursor-${requestedTeamId}` });
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages');

        expect(buttonByText(container, 'Mute notifications')).toBeTruthy();

        const thunderLink = container.querySelector('a[href="/messages/team-2"]');
        await act(async () => {
            thunderLink.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        });
        await flush();

        expect(buttonByText(container, 'Unmute notifications')).toBeTruthy();
    });

    it('mute toggle button calls muteTeamChat then unmuteTeamChat for the active conversation', async () => {
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Mute notifications');
        expect(chatMocks.muteTeamChat).toHaveBeenCalledWith('user-1', 'team-1', 'team');
        expect(chatMocks.unmuteTeamChat).not.toHaveBeenCalled();

        await click(container, 'Unmute notifications');
        expect(chatMocks.unmuteTeamChat).toHaveBeenCalledWith('user-1', 'team-1', 'team');
    });

    it('marks only the opened deep-linked conversation as read, including the view-return retry path', async () => {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible'
        });
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            value: false
        });
        document.hasFocus = vi.fn(() => true);
        chatMocks.loadChatConversations.mockResolvedValueOnce([
            { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] },
            { id: 'staff-conversation', type: 'group', name: 'Staff only', participantIds: ['user-1'], participantRoles: ['staff'] }
        ]);
        chatMocks.subscribeToTeamChatMessages.mockImplementationOnce((requestedTeamId, conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: `msg-${requestedTeamId}-${conversationId}`,
                    text: 'Staff follow-up',
                    senderId: 'coach-1',
                    senderName: 'Coach Jamie'
                })
            ], { id: `cursor-${requestedTeamId}-${conversationId}` });
            return { unsubscribe: vi.fn() };
        });

        await renderMessages('/messages/team-1?conversationId=staff-conversation');

        expect(chatMocks.markTeamChatRead).toHaveBeenCalledWith('user-1', 'team-1', 'staff-conversation');
        expect(chatMocks.markTeamChatRead).not.toHaveBeenCalledWith('user-1', 'team-1');

        chatMocks.markTeamChatRead.mockClear();
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });
        await flush();

        expect(chatMocks.markTeamChatRead).toHaveBeenCalledWith('user-1', 'team-1', 'staff-conversation');
        expect(chatMocks.markTeamChatRead).not.toHaveBeenCalledWith('user-1', 'team-1');
    });


    it('keeps the updated mute state after switching away and back to a muted staff conversation', async () => {
        layoutMocks.isDesktopWeb = true;
        chatMocks.loadChatInbox.mockResolvedValueOnce({
            teams: [
                {
                    id: 'team-1',
                    name: 'Bears',
                    sport: 'Basketball',
                    role: 'Admin',
                    canModerate: true,
                    unreadCount: 0,
                    isMuted: false,
                    preferredConversationId: 'staff-conversation',
                    lastMessage: chatMessage({ id: 'last-1', text: 'Staff note' })
                },
                {
                    id: 'team-2',
                    name: 'Thunder',
                    sport: 'Soccer',
                    role: 'Admin',
                    canModerate: true,
                    unreadCount: 0,
                    isMuted: false,
                    lastMessage: chatMessage({ id: 'last-2', text: 'Travel roster posted.' })
                }
            ]
        });
        chatMocks.loadChatTeamContext.mockImplementation(async (requestedTeamId) => ({
            team: {
                id: requestedTeamId,
                name: requestedTeamId === 'team-1' ? 'Bears' : 'Thunder',
                sport: requestedTeamId === 'team-1' ? 'Basketball' : 'Soccer'
            },
            profile: { fullName: 'Pat Parent', photoUrl: '' },
            canModerate: true
        }));
        chatMocks.loadChatConversations.mockImplementation(async (requestedTeamId) => (
            requestedTeamId === 'team-1'
                ? [
                    { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] },
                    { id: 'staff-conversation', type: 'group', name: 'Staff only', participantIds: ['user-1'], participantRoles: ['staff'] }
                ]
                : [
                    { id: 'team', type: 'team', name: 'Thunder Team Chat', participantIds: [], participantRoles: ['team'] }
                ]
        ));
        chatMocks.subscribeToTeamChatMessages.mockImplementation((requestedTeamId, conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: `msg-${requestedTeamId}-${conversationId}`,
                    senderId: 'coach-1',
                    senderName: 'Coach Jamie',
                    text: conversationId === 'staff-conversation' ? 'Staff note' : 'Travel roster posted.'
                })
            ], { id: `cursor-${requestedTeamId}-${conversationId}` });
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages/team-1?conversationId=staff-conversation');

        expect(buttonByText(container, 'Mute notifications')).toBeTruthy();
        await click(container, 'Mute notifications');
        expect(chatMocks.muteTeamChat).toHaveBeenCalledWith('user-1', 'team-1', 'staff-conversation');
        expect(buttonByText(container, 'Unmute notifications')).toBeTruthy();

        const thunderLink = container.querySelector('a[href="/messages/team-2"]');
        await act(async () => {
            thunderLink.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        });
        await flush();
        expect(buttonByText(container, 'Mute notifications')).toBeTruthy();

        const bearsLink = container.querySelector('a[href="/messages/team-1?conversationId=staff-conversation"]');
        await act(async () => {
            bearsLink.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        });
        await flush();

        expect(buttonByText(container, 'Unmute notifications')).toBeTruthy();
    });

    it('rolls back the mute toggle when the server write fails', async () => {
        chatMocks.muteTeamChat.mockRejectedValueOnce(new Error('offline'));
        const { container } = await renderMessages('/messages/team-1');

        await click(container, 'Mute notifications');

        expect(chatMocks.muteTeamChat).toHaveBeenCalledWith('user-1', 'team-1', 'team');
        expect(buttonByText(container, 'Mute notifications')).toBeTruthy();
    });

    it('muted inbox row shows a bell-off indicator instead of the chevron', async () => {
        chatMocks.loadChatInbox.mockResolvedValueOnce({
            teams: [
                {
                    id: 'team-1',
                    name: 'Bears',
                    sport: 'Basketball',
                    role: 'Admin',
                    canModerate: true,
                    unreadCount: 0,
                    isMuted: true,
                    lastMessage: chatMessage({ id: 'last-1', text: 'Practice packet posted.' })
                }
            ]
        });

        const { container } = await renderMessages('/messages');

        const bellOffIcon = container.querySelector('svg[aria-label="Notifications muted"]');
        expect(bellOffIcon).toBeTruthy();
    });

    it('does not reload Team Email drafts/templates/history when the sheet is reopened for the same team (issue #2377)', async () => {
        const { container } = await renderMessages('/messages/team-1');

        // Open the email sheet for the first time — all three loads should fire.
        await click(container, 'Team Email');
        expect(chatMocks.loadTeamEmailDrafts).toHaveBeenCalledTimes(1);
        expect(chatMocks.loadTeamEmailTemplates).toHaveBeenCalledTimes(1);
        expect(chatMocks.loadSentTeamEmails).toHaveBeenCalledTimes(1);

        // Close and immediately reopen — no additional Firestore reads.
        await click(container, 'Close Team Email');
        await click(container, 'Team Email');
        expect(chatMocks.loadTeamEmailDrafts).toHaveBeenCalledTimes(1);
        expect(chatMocks.loadTeamEmailTemplates).toHaveBeenCalledTimes(1);
        expect(chatMocks.loadSentTeamEmails).toHaveBeenCalledTimes(1);

        // Close and reopen a third time — still no extra reads.
        await click(container, 'Close Team Email');
        await click(container, 'Team Email');
        expect(chatMocks.loadTeamEmailDrafts).toHaveBeenCalledTimes(1);
        expect(chatMocks.loadTeamEmailTemplates).toHaveBeenCalledTimes(1);
        expect(chatMocks.loadSentTeamEmails).toHaveBeenCalledTimes(1);
    });

    it('reloads Team Email resources for a new team after switching teams (issue #2377)', async () => {
        layoutMocks.isDesktopWeb = true;
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
                    role: 'Admin',
                    canModerate: true,
                    unreadCount: 0,
                    lastMessage: chatMessage({ id: 'last-2', senderName: 'Coach Taylor', text: 'Travel roster posted.' })
                }
            ]
        });
        chatMocks.loadChatTeamContext.mockImplementation(async (requestedTeamId) => ({
            team: {
                id: requestedTeamId,
                name: requestedTeamId === 'team-1' ? 'Bears' : 'Thunder',
                sport: requestedTeamId === 'team-1' ? 'Basketball' : 'Soccer'
            },
            profile: { fullName: 'Pat Parent', photoUrl: '' },
            canModerate: true
        }));
        chatMocks.loadChatConversations.mockImplementation(async (requestedTeamId) => ([
            {
                id: 'team',
                type: 'team',
                name: requestedTeamId === 'team-1' ? 'Bears Team Chat' : 'Thunder Team Chat',
                participantIds: [],
                participantRoles: ['team']
            }
        ]));
        chatMocks.subscribeToTeamChatMessages.mockImplementation((requestedTeamId, _conversationId, onMessages) => {
            onMessages([
                chatMessage({
                    id: `msg-${requestedTeamId}`,
                    senderId: requestedTeamId === 'team-1' ? 'coach-1' : 'coach-2',
                    senderName: requestedTeamId === 'team-1' ? 'Coach Jamie' : 'Coach Taylor',
                    text: requestedTeamId === 'team-1' ? 'Bring both jerseys.' : 'Travel roster posted.'
                })
            ], { id: `cursor-${requestedTeamId}` });
            return { unsubscribe: vi.fn() };
        });

        const { container } = await renderMessages('/messages');

        // Open email sheet for team-1 — first load.
        await click(container, 'Team Email');
        expect(chatMocks.loadTeamEmailDrafts).toHaveBeenCalledTimes(1);
        expect(chatMocks.loadTeamEmailDrafts).toHaveBeenCalledWith('team-1');
        await click(container, 'Close Team Email');

        // Switch to team-2 via the inbox pane.
        const thunderLink = container.querySelector('a[href="/messages/team-2"]');
        await act(async () => {
            thunderLink.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        });
        await flush();

        // Open email sheet for team-2 — cache was invalidated on team switch, so a fresh load fires.
        await click(container, 'Team Email');
        expect(chatMocks.loadTeamEmailDrafts).toHaveBeenCalledTimes(2);
        expect(chatMocks.loadTeamEmailDrafts).toHaveBeenLastCalledWith('team-2');
    });
});
