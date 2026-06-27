// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateAiChat } from './PrivateAiChat';
import type { AuthState } from '../lib/types';

const privateAiServiceMocks = vi.hoisted(() => ({
    loadPrivateAiConversations: vi.fn(),
    loadPrivateAiMessages: vi.fn(),
    sendPrivateAiMessage: vi.fn()
}));

vi.mock('../lib/privateAiService', () => ({
    DEFAULT_PRIVATE_AI_CONVERSATION_ID: 'default',
    DRAFT_PRIVATE_AI_CONVERSATION_ID: '__draft__',
    loadPrivateAiConversations: privateAiServiceMocks.loadPrivateAiConversations,
    loadPrivateAiMessages: privateAiServiceMocks.loadPrivateAiMessages,
    sendPrivateAiMessage: privateAiServiceMocks.sendPrivateAiMessage
}));
vi.mock('../lib/chatLogic', () => ({
    formatChatDay: () => 'Today',
    formatChatMessageHtml: (text: string) => text,
    formatChatTime: () => '1:00 PM'
}));
vi.mock('../lib/dictation', () => ({
    appendDictationTranscript: vi.fn(),
    collectFinalDictationTranscript: vi.fn(),
    getDictationErrorMessage: vi.fn(),
    getSpeechRecognitionConstructor: vi.fn(() => null),
    isCapacitorNativeRuntime: vi.fn(() => false),
    startNativeSpeechDictation: vi.fn()
}));
vi.mock('../lib/useShellLayout', () => ({
    useShellLayout: () => ({
        isDesktop: true,
        isNative: false,
        isDesktopWeb: true
    })
}));
vi.mock('lucide-react', () => {
    const Icon = () => null;
    return {
        ChevronRight: Icon,
        ChevronsDown: Icon,
        Loader2: Icon,
        MessageCircle: Icon,
        Mic: Icon,
        Plus: Icon,
        RefreshCw: Icon,
        Send: Icon,
        ShieldCheck: Icon,
        Sparkles: Icon
    };
});

const auth: AuthState = {
    user: {
        uid: 'user-1',
        email: 'coach@example.com',
        displayName: 'Coach Example',
        roles: ['coach'],
        parentOf: []
    },
    profile: null,
    loading: false,
    error: null,
    roles: ['coach'],
    isParent: false,
    isCoach: true,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn(),
    signOut: vi.fn()
};

function renderChat() {
    return render(<PrivateAiChat auth={auth} />);
}

describe('PrivateAiChat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(window, 'scrollTo', {
            value: vi.fn(),
            writable: true
        });
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            value: vi.fn(),
            writable: true
        });
        privateAiServiceMocks.loadPrivateAiConversations.mockResolvedValue([]);
        privateAiServiceMocks.loadPrivateAiMessages.mockResolvedValue([]);
    });

    afterEach(() => {
        cleanup();
    });

    it('shows one default first-run action and defers advanced prompts behind expansion', async () => {
        renderChat();

        expect(await screen.findByText('What do you need from ALL PLAYS?')).toBeTruthy();

        const railCard = screen.getByText('Ask about').closest('section');
        expect(railCard).toBeTruthy();
        if (!railCard) {
            throw new Error('Ask about card not found');
        }

        expect(within(railCard).getByRole('button', { name: 'What do I need to handle today?' })).toBeTruthy();
        expect(within(railCard).queryByRole('button', { name: 'Who still needs an RSVP?' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'What is my next game?' })).toBeNull();

        const expandButtons = screen.getAllByRole('button', { name: 'More ways to ask' });
        fireEvent.click(expandButtons[0]!);

        expect(await within(railCard).findByRole('button', { name: 'Who still needs an RSVP?' })).toBeTruthy();
        expect(within(railCard).getByRole('button', { name: 'What is my next game?' })).toBeTruthy();
        expect(within(railCard).getByRole('button', { name: 'Show unread team messages' })).toBeTruthy();
    });

    it('sends the primary first-run action through the existing send flow and preserves optimistic chat behavior', async () => {
        let resolveSend!: (value: {
            userMessage: { id: string; role: 'user'; text: string; createdAt: Date; conversationId: string };
            assistantMessage: { id: string; role: 'assistant'; text: string; createdAt: Date; conversationId: string; toolNames: string[] };
            toolResults: [];
        }) => void;
        privateAiServiceMocks.sendPrivateAiMessage.mockImplementationOnce(() => new Promise((resolve) => {
            resolveSend = resolve;
        }));
        privateAiServiceMocks.loadPrivateAiConversations
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: 'conversation-1',
                    title: 'What do I need to handle today?',
                    createdAt: new Date('2026-06-27T13:18:00Z'),
                    updatedAt: new Date('2026-06-27T13:18:01Z'),
                    lastMessagePreview: 'What do I need to handle today?'
                }
            ]);
        privateAiServiceMocks.loadPrivateAiMessages.mockImplementation(async (_user, _limit, conversationId) => {
            if (conversationId === 'conversation-1') {
                return [
                    {
                        id: 'server-user-1',
                        role: 'user',
                        text: 'What do I need to handle today?',
                        createdAt: new Date('2026-06-27T13:18:00Z'),
                        conversationId: 'conversation-1'
                    },
                    {
                        id: 'server-assistant-1',
                        role: 'assistant',
                        text: 'Here is your summary.',
                        createdAt: new Date('2026-06-27T13:18:01Z'),
                        conversationId: 'conversation-1',
                        toolNames: ['get_home']
                    }
                ];
            }
            return [];
        });

        renderChat();

        expect(await screen.findByText('What do you need from ALL PLAYS?')).toBeTruthy();
        fireEvent.click(screen.getAllByRole('button', { name: 'What do I need to handle today?' })[0]!);

        await waitFor(() => {
            expect(privateAiServiceMocks.sendPrivateAiMessage).toHaveBeenCalledWith(auth.user, 'What do I need to handle today?', 'default');
        });
        expect(screen.getAllByText('What do I need to handle today?').length).toBeGreaterThan(0);

        resolveSend({
            userMessage: {
                id: 'server-user-1',
                role: 'user',
                text: 'What do I need to handle today?',
                createdAt: new Date('2026-06-27T13:18:00Z'),
                conversationId: 'conversation-1'
            },
            assistantMessage: {
                id: 'server-assistant-1',
                role: 'assistant',
                text: 'Here is your summary.',
                createdAt: new Date('2026-06-27T13:18:01Z'),
                conversationId: 'conversation-1',
                toolNames: ['get_home']
            },
            toolResults: []
        });

        expect(await screen.findByText('Here is your summary.')).toBeTruthy();
        await waitFor(() => {
            expect(privateAiServiceMocks.loadPrivateAiMessages).toHaveBeenCalledWith(auth.user, undefined, 'conversation-1');
        });
    });
});
