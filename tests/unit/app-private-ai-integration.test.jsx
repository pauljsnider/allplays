// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';

const privateAiMocks = vi.hoisted(() => ({
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
            createdAt: new Date('2026-05-21T12:01:00Z')
        },
        assistantMessage: {
            id: 'msg-3',
            role: 'assistant',
            text: '**Bears** play Monday at 6:00 PM.',
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

afterEach(() => {
    document.body.innerHTML = '';
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    delete window.__privateAiRecognition;
});

describe('private AI chat page', () => {
    it('loads the private thread and sends a message through the AI service', async () => {
        const { container } = await renderPrivateAi();

        expect(privateAiMocks.loadPrivateAiMessages).toHaveBeenCalledWith(auth.user);
        expect(container.textContent).toContain('Ask ALL PLAYS');
        expect(container.textContent).toContain('I can look up your ALL PLAYS data.');

        const textarea = container.querySelector('textarea');
        await setFieldValue(textarea, 'What is next?');
        await click(container.querySelector('button[aria-label="Send AI message"]'));

        expect(privateAiMocks.sendPrivateAiMessage).toHaveBeenCalledWith(auth.user, 'What is next?');
        expect(container.textContent).toContain('Bears play Monday at 6:00 PM.');
        expect(container.textContent).toContain('Looked up get_schedule');
    });

    it('renders desktop prompt rail and copies a suggestion into the composer', async () => {
        layoutMocks.isDesktopWeb = true;
        privateAiMocks.loadPrivateAiMessages.mockResolvedValueOnce([]);

        const { container } = await renderPrivateAi();

        expect(container.querySelector('.messages-two-pane')).toBeTruthy();
        expect(container.textContent).toContain('What do I need to handle today?');

        const suggestion = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Who still needs an RSVP?'));
        await click(suggestion);

        expect(container.querySelector('textarea').value).toBe('Who still needs an RSVP?');
    });

    it('shows service errors without losing the typed message', async () => {
        privateAiMocks.sendPrivateAiMessage.mockRejectedValueOnce(new Error('AI down'));
        const { container } = await renderPrivateAi();

        const textarea = container.querySelector('textarea');
        await setFieldValue(textarea, 'Can you help?');
        await click(container.querySelector('button[aria-label="Send AI message"]'));

        expect(container.textContent).toContain('AI down');
        expect(container.querySelector('textarea').value).toBe('Can you help?');
    });

    it('shows a useful fallback when browser dictation is unavailable', async () => {
        const { container } = await renderPrivateAi();

        await click(container.querySelector('button[aria-label="Start dictation"]'));

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
        await click(container.querySelector('button[aria-label="Start dictation"]'));

        expect(start).toHaveBeenCalledOnce();
        expect(container.querySelector('button[aria-label="Stop dictation"]')).toBeTruthy();

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
