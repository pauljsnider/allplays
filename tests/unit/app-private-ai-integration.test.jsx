// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

const privateAiMocks = vi.hoisted(() => ({
    DEFAULT_PRIVATE_AI_CONVERSATION_ID: 'default',
    DRAFT_PRIVATE_AI_CONVERSATION_ID: '__draft__',
    createPrivateAiConversation: vi.fn(),
    loadPrivateAiConversations: vi.fn(),
    loadPrivateAiMessages: vi.fn(),
    sendPrivateAiMessage: vi.fn()
}));

const layoutMocks = vi.hoisted(() => ({
    isDesktopWeb: false
}));

vi.mock('../../apps/app/src/lib/privateAiService.ts', () => privateAiMocks);
vi.mock('../../apps/app/src/lib/useShellLayout.ts', () => ({
    useShellLayout: () => layoutMocks
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots = [];

const auth = {
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
    refresh: async () => {},
    signOut: async () => {}
};

async function renderPrivateAi() {
    const { PrivateAiChat } = await import('../../apps/app/src/pages/PrivateAiChat.tsx');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(PrivateAiChat, { auth }));
    });

    await flush();
    mountedRoots.push(root);
    return { container, root };
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
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

async function click(button) {
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
}

beforeEach(() => {
    vi.clearAllMocks();
    layoutMocks.isDesktopWeb = false;
    privateAiMocks.loadPrivateAiConversations.mockResolvedValue([
        {
            id: 'default',
            title: 'Recent chat',
            createdAt: new Date('2026-05-21T12:00:00Z'),
            updatedAt: new Date('2026-05-21T12:00:00Z'),
            lastMessagePreview: 'I can look up your ALL PLAYS data.'
        }
    ]);
    privateAiMocks.loadPrivateAiMessages.mockResolvedValue([
        {
            id: 'msg-1',
            role: 'assistant',
            text: 'I can look up your ALL PLAYS data.',
            createdAt: new Date('2026-05-21T12:00:00Z'),
            toolNames: []
        }
    ]);
    privateAiMocks.sendPrivateAiMessage.mockResolvedValue({
        userMessage: {
            id: 'msg-2',
            role: 'user',
            text: 'What is next?',
            conversationId: 'conversation-1',
            createdAt: new Date('2026-05-21T12:01:00Z')
        },
        assistantMessage: {
            id: 'msg-3',
            role: 'assistant',
            text: '**Bears** play Monday at 6:00 PM.',
            conversationId: 'conversation-1',
            createdAt: new Date('2026-05-21T12:01:02Z'),
            toolNames: ['get_schedule']
        },
        toolResults: [{ name: 'get_schedule', ok: true }]
    });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: vi.fn()
    });
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    delete window.__privateAiRecognition;
});

afterEach(async () => {
    await act(async () => {
        while (mountedRoots.length) {
            mountedRoots.pop().unmount();
        }
    });
    document.body.innerHTML = '';
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    delete window.__privateAiRecognition;
});

describe('private AI chat page', () => {
    it('loads the private thread and sends a message through the AI service', async () => {
        const { container } = await renderPrivateAi();

        expect(privateAiMocks.loadPrivateAiConversations).toHaveBeenCalledWith(auth.user);
        expect(privateAiMocks.loadPrivateAiMessages).toHaveBeenCalledWith(auth.user, undefined, 'default');
        expect(container.textContent).toContain('Ask ALL PLAYS');
        expect(container.textContent).toContain('I can look up your ALL PLAYS data.');

        const textarea = container.querySelector('textarea');
        await setFieldValue(textarea, 'What is next?');
        await click(container.querySelector('button[aria-label="Send AI message"]'));

        expect(privateAiMocks.sendPrivateAiMessage).toHaveBeenCalledWith(auth.user, 'What is next?', 'default');
        expect(container.textContent).toContain('Bears play Monday at 6:00 PM.');
        expect(container.textContent).toContain('Looked up get_schedule');
    });

    it('renders desktop prompt rail and sends a selected suggestion', async () => {
        layoutMocks.isDesktopWeb = true;
        privateAiMocks.loadPrivateAiMessages.mockResolvedValueOnce([]);

        const { container } = await renderPrivateAi();

        expect(container.querySelector('.messages-two-pane')).toBeTruthy();
        expect(container.textContent).toContain('What do I need to handle today?');
        expect(container.textContent).toContain('More ways to ask');
        expect(container.textContent).not.toContain('Who still needs an RSVP?');

        const expandButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('More ways to ask'));
        await click(expandButton);

        const suggestion = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Who still needs an RSVP?'));
        await click(suggestion);

        expect(privateAiMocks.sendPrivateAiMessage).toHaveBeenCalledWith(auth.user, 'Who still needs an RSVP?', 'default');
        expect(container.querySelector('textarea').value).toBe('');
    });

    it('shows a selected draft conversation row on desktop before first send', async () => {
        layoutMocks.isDesktopWeb = true;
        privateAiMocks.loadPrivateAiMessages.mockResolvedValueOnce([]);

        const { container } = await renderPrivateAi();

        await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('New')));

        const draftRow = Array.from(container.querySelectorAll('.private-ai-conversation-button')).find((button) => button.textContent.includes('New chat'));
        expect(draftRow).toBeTruthy();
        expect(draftRow.getAttribute('aria-pressed')).toBe('true');
        expect(draftRow.textContent).toContain('Start typing. This draft will save after your first message.');
        expect(container.textContent).toContain('Recent chat');
    });

    it('renders starter prompts in the empty mobile welcome state', async () => {
        layoutMocks.isDesktopWeb = false;
        privateAiMocks.loadPrivateAiMessages.mockResolvedValueOnce([]);

        const { container } = await renderPrivateAi();

        expect(container.querySelector('.messages-two-pane')).toBeFalsy();
        expect(container.textContent).toContain('What do you need from ALL PLAYS?');
        expect(container.textContent).toContain('What do I need to handle today?');
        expect(container.textContent).toContain('More ways to ask');
        expect(container.textContent).not.toContain('What is my next game?');
        expect(container.textContent).not.toContain('Show unread team messages');
        expect(container.textContent).not.toContain('Who still needs an RSVP?');

        const expandButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('More ways to ask'));
        await click(expandButton);

        expect(container.textContent).toContain('What is my next game?');
        expect(container.textContent).toContain('Show unread team messages');
        expect(container.textContent).toContain('Who still needs an RSVP?');
    });

    it('sends a mobile starter prompt through the private AI service', async () => {
        layoutMocks.isDesktopWeb = false;
        privateAiMocks.loadPrivateAiMessages.mockResolvedValueOnce([]);

        const { container } = await renderPrivateAi();
        const starter = Array.from(container.querySelectorAll('.private-ai-starter-prompt')).find((button) => button.textContent.includes('What do I need to handle today?'));
        await click(starter);

        expect(privateAiMocks.sendPrivateAiMessage).toHaveBeenCalledWith(auth.user, 'What do I need to handle today?', 'default');
    });

    it('starts a blank draft, shows the active mobile chip, and only saves after the first send', async () => {
        privateAiMocks.loadPrivateAiMessages
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: 'msg-2',
                    role: 'user',
                    text: 'First draft question',
                    conversationId: 'conversation-2',
                    createdAt: new Date('2026-05-21T12:01:00Z')
                },
                {
                    id: 'msg-3',
                    role: 'assistant',
                    text: 'Draft answer',
                    conversationId: 'conversation-2',
                    createdAt: new Date('2026-05-21T12:01:02Z'),
                    toolNames: []
                }
            ]);
        privateAiMocks.loadPrivateAiConversations
            .mockResolvedValueOnce([
                {
                    id: 'conversation-1',
                    title: 'Saved chat',
                    createdAt: new Date('2026-05-21T12:00:00Z'),
                    updatedAt: new Date('2026-05-21T12:00:00Z'),
                    lastMessagePreview: 'Saved preview'
                }
            ])
            .mockResolvedValueOnce([
                {
                    id: 'conversation-1',
                    title: 'Saved chat',
                    createdAt: new Date('2026-05-21T12:00:00Z'),
                    updatedAt: new Date('2026-05-21T12:00:00Z'),
                    lastMessagePreview: 'Saved preview'
                }
            ])
            .mockResolvedValueOnce([
                {
                    id: 'conversation-2',
                    title: 'First draft question',
                    createdAt: new Date('2026-05-21T12:02:00Z'),
                    updatedAt: new Date('2026-05-21T12:02:00Z'),
                    lastMessagePreview: 'Draft answer'
                },
                {
                    id: 'conversation-1',
                    title: 'Saved chat',
                    createdAt: new Date('2026-05-21T12:00:00Z'),
                    updatedAt: new Date('2026-05-21T12:00:00Z'),
                    lastMessagePreview: 'Saved preview'
                }
            ]);
        privateAiMocks.sendPrivateAiMessage.mockResolvedValueOnce({
            userMessage: {
                id: 'msg-2',
                role: 'user',
                text: 'First draft question',
                conversationId: 'conversation-2',
                createdAt: new Date('2026-05-21T12:01:00Z')
            },
            assistantMessage: {
                id: 'msg-3',
                role: 'assistant',
                text: 'Draft answer',
                conversationId: 'conversation-2',
                createdAt: new Date('2026-05-21T12:01:02Z'),
                toolNames: []
            },
            toolResults: []
        });

        const { container } = await renderPrivateAi();
        const messageLoadCountBeforeDraft = privateAiMocks.loadPrivateAiMessages.mock.calls.length;

        await click(container.querySelector('button[aria-label="New AI chat"]'));

        const textarea = container.querySelector('textarea');
        await setFieldValue(textarea, 'First draft question');
        await click(container.querySelector('button[aria-label="Refresh AI chat"]'));

        expect(privateAiMocks.createPrivateAiConversation).not.toHaveBeenCalled();
        expect(privateAiMocks.loadPrivateAiMessages.mock.calls.length).toBe(messageLoadCountBeforeDraft);
        expect(container.textContent).toContain('What do you need from ALL PLAYS?');
        expect(textarea.value).toBe('First draft question');

        const draftChip = Array.from(container.querySelectorAll('.private-ai-conversation-chip')).find((button) => button.textContent.includes('New chat'));
        expect(draftChip).toBeTruthy();
        expect(draftChip.getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('Saved chat');

        await click(container.querySelector('button[aria-label="Send AI message"]'));

        expect(privateAiMocks.sendPrivateAiMessage).toHaveBeenCalledWith(auth.user, 'First draft question', '__draft__');
        expect(container.textContent).toContain('First draft question');
        expect(privateAiMocks.loadPrivateAiConversations).toHaveBeenCalledTimes(3);
        expect(Array.from(container.querySelectorAll('.private-ai-conversation-chip')).some((button) => button.textContent.includes('New chat'))).toBe(false);
        const savedChip = Array.from(container.querySelectorAll('.private-ai-conversation-chip')).find((button) => button.textContent.includes('First draft question'));
        expect(savedChip).toBeTruthy();
        expect(savedChip.getAttribute('aria-pressed')).toBe('true');
    });

    it('shows service errors without losing the typed message', async () => {
        privateAiMocks.sendPrivateAiMessage.mockRejectedValueOnce(new Error('AI down'));
        const { container } = await renderPrivateAi();

        const textarea = container.querySelector('textarea');
        await setFieldValue(textarea, 'Can you help?');
        await click(container.querySelector('button[aria-label="Send AI message"]'));
        await flush();
        await flush();

        expect(privateAiMocks.sendPrivateAiMessage).toHaveBeenCalledWith(auth.user, 'Can you help?', 'default');
        expect(container.textContent).toContain('AI down');
        expect(container.querySelector('textarea').value).toBe('Can you help?');
    });

    it('shows a useful fallback when browser dictation is unavailable', async () => {
        const { container } = await renderPrivateAi();

        await click(container.querySelector('button[aria-label="Voice to text"]'));

        expect(container.textContent).toContain('Dictation is not available in this view');
    });

    it('adds speech recognition transcript to the composer', async () => {
        const start = vi.fn();
        const stop = vi.fn();
        const abort = vi.fn();
        window.SpeechRecognition = function MockRecognition() {
            window.__privateAiRecognition = this;
            this.continuous = true;
            this.interimResults = true;
            this.lang = '';
            this.start = start;
            this.stop = stop;
            this.abort = abort;
            this.onresult = null;
            this.onerror = null;
            this.onend = null;
        };

        const { container } = await renderPrivateAi();
        const textarea = container.querySelector('textarea');
        await setFieldValue(textarea, 'Show');
        await click(container.querySelector('button[aria-label="Voice to text"]'));

        expect(start).toHaveBeenCalledOnce();
        expect(container.querySelector('button[aria-label="Stop voice input"]')).toBeTruthy();

        await act(async () => {
            window.__privateAiRecognition.onresult({
                resultIndex: 0,
                results: [
                    { isFinal: true, 0: { transcript: 'my next game' } }
                ]
            });
            window.__privateAiRecognition.onend();
        });
        await flush();

        expect(textarea.value).toBe('Show my next game');
        expect(container.textContent).toContain('Dictation added to your message.');
    });
});
