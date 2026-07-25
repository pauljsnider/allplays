// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PrivateAiChat } from './PrivateAiChat';
import { buildPrivateAiLaunchPath, buildPrivateAiLaunchPrompt } from '../lib/privateAiLaunch';
import type { AuthState } from '../lib/types';

const privateAiServiceMocks = vi.hoisted(() => ({
    loadPrivateAiConversations: vi.fn(),
    loadPrivateAiMessages: vi.fn(),
    revisePrivateAiRosterImportProposal: vi.fn(),
    sendPrivateAiAttachmentMessage: vi.fn(),
    sendPrivateAiMessage: vi.fn(),
    getPrivateAiAttachmentValidationError: vi.fn(() => '')
}));
const teamDetailServiceMocks = vi.hoisted(() => ({
    loadRosterImportContextForApp: vi.fn()
}));

vi.mock('../lib/privateAiService', () => ({
    DEFAULT_PRIVATE_AI_CONVERSATION_ID: 'default',
    DRAFT_PRIVATE_AI_CONVERSATION_ID: '__draft__',
    loadPrivateAiConversations: privateAiServiceMocks.loadPrivateAiConversations,
    loadPrivateAiMessages: privateAiServiceMocks.loadPrivateAiMessages,
    getPrivateAiAttachmentValidationError: privateAiServiceMocks.getPrivateAiAttachmentValidationError,
    revisePrivateAiRosterImportProposal: privateAiServiceMocks.revisePrivateAiRosterImportProposal,
    sendPrivateAiAttachmentMessage: privateAiServiceMocks.sendPrivateAiAttachmentMessage,
    sendPrivateAiMessage: privateAiServiceMocks.sendPrivateAiMessage,
}));
vi.mock('../lib/teamDetailService', () => ({
    loadRosterImportContextForApp: teamDetailServiceMocks.loadRosterImportContextForApp
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
        FileText: Icon,
        FileSpreadsheet: Icon,
        ImageIcon: Icon,
        Loader2: Icon,
        MessageCircle: Icon,
        Mic: Icon,
        Plus: Icon,
        RefreshCw: Icon,
        Send: Icon,
        ShieldCheck: Icon,
        Sparkles: Icon,
        X: Icon
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

function renderChat(initialEntry = '/ai') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <PrivateAiChat auth={auth} />
        </MemoryRouter>
    );
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
        privateAiServiceMocks.revisePrivateAiRosterImportProposal.mockResolvedValue({
            total: 1,
            add: 1,
            update: 0,
            deactivate: 0,
            reactivate: 0,
            invitations: 0,
            errors: 0
        });
        teamDetailServiceMocks.loadRosterImportContextForApp.mockResolvedValue({
            fields: [],
            players: []
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('centers the first-run prompt and defers desktop conversation management until a chat exists', async () => {
        const { container } = renderChat();

        const welcomeHeading = await screen.findByText('What do you need from ALL PLAYS?');
        const welcome = welcomeHeading.closest<HTMLElement>('.private-ai-welcome');
        expect(welcome).toBeTruthy();
        if (!welcome) {
            throw new Error('Private AI welcome not found');
        }

        await waitFor(() => {
            expect(privateAiServiceMocks.loadPrivateAiConversations).toHaveBeenCalledWith(auth.user);
            expect(privateAiServiceMocks.loadPrivateAiMessages).toHaveBeenCalledWith(auth.user, undefined, 'default');
        });
        expect(container.querySelector('.private-ai-first-run')).toBeTruthy();
        expect(container.querySelector('.private-ai-rail')).toBeNull();
        expect(screen.queryByLabelText('AI conversations')).toBeNull();
        expect(screen.queryByText('Chats')).toBeNull();
        expect(screen.queryByText('Messages')).toBeNull();
        expect(screen.queryByText('Lookups')).toBeNull();
        expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
        expect(screen.queryByText('No saved chats')).toBeNull();
        expect(screen.queryByText('Start a private chat and it will stay here for later.')).toBeNull();

        expect(within(welcome).getByRole('button', { name: 'What do I need to handle today?' })).toBeTruthy();
        expect(within(welcome).queryByRole('button', { name: 'Who still needs an RSVP?' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'What is my next game?' })).toBeNull();

        fireEvent.click(within(welcome).getByRole('button', { name: 'More ways to ask' }));

        expect(await within(welcome).findByRole('button', { name: 'Who still needs an RSVP?' })).toBeTruthy();
        expect(within(welcome).getByRole('button', { name: 'What is my next game?' })).toBeTruthy();
        expect(within(welcome).getByRole('button', { name: 'Show unread team messages' })).toBeTruthy();
    });

    it('opens a team-scoped import launcher as a new unsent chat draft', async () => {
        const launchPath = buildPrivateAiLaunchPath({
            intent: 'schedule-import',
            teamId: 'team-1',
            teamName: 'K - Cougars'
        });
        const launchPrompt = buildPrivateAiLaunchPrompt('schedule-import', 'K - Cougars');
        privateAiServiceMocks.sendPrivateAiMessage.mockResolvedValueOnce({
            userMessage: {
                id: 'user-1',
                role: 'user',
                text: launchPrompt,
                conversationId: 'conversation-1',
                createdAt: new Date('2026-07-25T12:00:00Z')
            },
            assistantMessage: {
                id: 'assistant-1',
                role: 'assistant',
                text: 'I am ready for the schedule file.',
                conversationId: 'conversation-1',
                createdAt: new Date('2026-07-25T12:00:01Z'),
                toolNames: []
            },
            toolResults: []
        });

        renderChat(launchPath);

        const context = await screen.findByLabelText('AI team context');
        expect(within(context).getByText('K - Cougars')).toBeTruthy();
        expect(within(context).getByText('Schedule management')).toBeTruthy();
        expect(within(context).getByText('Draft only · nothing sent yet')).toBeTruthy();
        expect((screen.getByPlaceholderText('Ask ALL PLAYS...') as HTMLTextAreaElement).value).toBe(launchPrompt);
        await waitFor(() => {
            expect(privateAiServiceMocks.loadPrivateAiMessages).not.toHaveBeenCalled();
        });
        expect(privateAiServiceMocks.sendPrivateAiMessage).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Attach image, CSV, or PDF')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Send AI message' }));

        await waitFor(() => {
            expect(privateAiServiceMocks.sendPrivateAiMessage).toHaveBeenCalledWith(
                auth.user,
                launchPrompt,
                '__draft__',
                { teamId: 'team-1' }
            );
        });
        expect(within(context).getByText('Team scoped · writes still require yes')).toBeTruthy();
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
            expect(privateAiServiceMocks.loadPrivateAiConversations).toHaveBeenCalledTimes(2);
        });
        const conversationList = screen.getByLabelText('AI conversations');
        const savedConversation = within(conversationList).getByRole('button', { name: /What do I need to handle today\?/ });
        expect(savedConversation.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(savedConversation);

        expect(screen.getByText('Here is your summary.')).toBeTruthy();
        expect(privateAiServiceMocks.loadPrivateAiMessages).not.toHaveBeenCalledWith(auth.user, undefined, 'conversation-1');
    });

    it('shows persisted conversation history as saved chats after reload', async () => {
        privateAiServiceMocks.loadPrivateAiConversations.mockResolvedValue([
            {
                id: 'conversation-2',
                title: 'Practice plan',
                createdAt: new Date('2026-06-28T13:18:00Z'),
                updatedAt: new Date('2026-06-28T13:19:00Z'),
                lastMessagePreview: 'Here is the practice plan.'
            },
            {
                id: 'conversation-1',
                title: 'RSVP help',
                createdAt: new Date('2026-06-27T13:18:00Z'),
                updatedAt: new Date('2026-06-27T13:19:00Z'),
                lastMessagePreview: 'Your RSVP was updated.'
            }
        ]);

        renderChat();

        const conversationList = await screen.findByLabelText('AI conversations');
        expect(within(conversationList).getByRole('button', { name: /Practice plan/ })).toBeTruthy();
        expect(within(conversationList).getByRole('button', { name: /RSVP help/ })).toBeTruthy();
        expect(within(conversationList).getByRole('button', { name: /Practice plan/ }).getAttribute('aria-pressed')).toBe('true');
        await waitFor(() => {
            expect(privateAiServiceMocks.loadPrivateAiMessages).toHaveBeenCalledWith(auth.user, undefined, 'conversation-2');
        });
        expect(screen.getByText('Saved chats')).toBeTruthy();
        expect(screen.queryByText('Chats')).toBeNull();
    });

    it('reveals older conversation history in explicit pages', async () => {
        privateAiServiceMocks.loadPrivateAiConversations.mockResolvedValue(
            Array.from({ length: 8 }, (_, index) => ({
                id: `conversation-${index + 1}`,
                title: `Saved chat ${index + 1}`,
                createdAt: new Date(`2026-06-${String(20 - index).padStart(2, '0')}T13:18:00Z`),
                updatedAt: new Date(`2026-06-${String(20 - index).padStart(2, '0')}T13:19:00Z`),
                lastMessagePreview: `Preview ${index + 1}`
            }))
        );

        renderChat();

        const conversationList = await screen.findByLabelText('AI conversations');
        expect(within(conversationList).getByRole('button', { name: /Saved chat 6/ })).toBeTruthy();
        expect(within(conversationList).queryByRole('button', { name: /Saved chat 7/ })).toBeNull();

        fireEvent.click(within(conversationList).getByRole('button', { name: 'Load more chats' }));

        expect(within(conversationList).getByRole('button', { name: /Saved chat 7/ })).toBeTruthy();
        expect(within(conversationList).getByRole('button', { name: /Saved chat 8/ })).toBeTruthy();
        expect(within(conversationList).queryByRole('button', { name: 'Load more chats' })).toBeNull();
    });

    it('accepts a PDF and sends it through the generic private AI attachment flow', async () => {
        const pdf = new File(['sample pdf'], 'team-handbook.pdf', { type: 'application/pdf' });
        privateAiServiceMocks.sendPrivateAiAttachmentMessage.mockResolvedValue({
            userMessage: {
                id: 'user-pdf',
                role: 'user',
                text: 'Summarize the action items. (team-handbook.pdf)',
                createdAt: new Date('2026-06-28T13:18:00Z'),
                conversationId: 'default'
            },
            assistantMessage: {
                id: 'assistant-pdf',
                role: 'assistant',
                text: 'The handbook has three action items.',
                createdAt: new Date('2026-06-28T13:18:01Z'),
                conversationId: 'default',
                artifacts: [{
                    type: 'document-analysis',
                    confirmationId: '',
                    teamId: '',
                    teamName: '',
                    source: 'pdf',
                    fileName: 'team-handbook.pdf',
                    mimeType: 'application/pdf',
                    summary: { total: 1, errors: 0 }
                }]
            },
            toolResults: []
        });

        renderChat();
        await screen.findByText('What do you need from ALL PLAYS?');

        const attachmentInput = screen.getByLabelText('Attach image, CSV, or PDF');
        fireEvent.change(attachmentInput, { target: { files: [pdf] } });

        expect(await screen.findByText('team-handbook.pdf')).toBeTruthy();
        expect(screen.getByText('PDF · AI decides roster, schedule, or analysis')).toBeTruthy();
        const composer = screen.getByPlaceholderText('What should AI do with this file?');
        fireEvent.change(composer, { target: { value: 'Summarize the action items.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send AI message' }));

        await waitFor(() => {
            expect(privateAiServiceMocks.sendPrivateAiAttachmentMessage).toHaveBeenCalledWith(
                auth.user,
                expect.objectContaining({
                    text: 'Summarize the action items.',
                    file: pdf
                }),
                'default'
            );
        });
        expect(await screen.findByText('Attachment analyzed')).toBeTruthy();
        expect(screen.getByText('No app data was changed.')).toBeTruthy();
    });

    it('accepts an image pasted directly into the AI composer', async () => {
        const image = new File(['image'], 'clipboard-roster.png', { type: 'image/png' });

        renderChat();
        const composer = await screen.findByPlaceholderText('Ask ALL PLAYS...');
        fireEvent.paste(composer, {
            clipboardData: {
                items: [{
                    kind: 'file',
                    type: 'image/png',
                    getAsFile: () => image
                }],
                files: [image]
            }
        });

        expect(await screen.findByText('clipboard-roster.png')).toBeTruthy();
        expect(screen.getByPlaceholderText('What should AI do with this file?')).toBeTruthy();
        expect(screen.getByText('Paste an image here, or attach an image, CSV, or PDF')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }));
        expect(screen.queryByText('Attachment ready. Add what you want AI to do, or send it for automatic analysis.')).toBeNull();
    });

    it('clears a sent image immediately and shows an explicit AI receipt', async () => {
        const image = new File(['image'], 'player-card.png', { type: 'image/png' });
        let resolveAttachment!: (value: any) => void;
        privateAiServiceMocks.sendPrivateAiAttachmentMessage.mockImplementationOnce(() => new Promise((resolve) => {
            resolveAttachment = resolve;
        }));

        renderChat();
        const composer = await screen.findByPlaceholderText('Ask ALL PLAYS...');
        fireEvent.paste(composer, {
            clipboardData: {
                items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
                files: [image]
            }
        });
        fireEvent.change(screen.getByPlaceholderText('What should AI do with this file?'), {
            target: { value: 'Assign parent@example.com to this player.' }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Send AI message' }));

        expect(await screen.findByText('Sending image to AI')).toBeTruthy();
        expect(screen.getByText('player-card.png')).toBeTruthy();
        expect(screen.getByPlaceholderText('Ask ALL PLAYS...')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Remove attachment' })).toBeNull();

        resolveAttachment({
            userMessage: {
                id: 'user-image',
                role: 'user',
                text: 'Assign parent@example.com to this player.',
                createdAt: new Date('2026-06-28T13:18:00Z'),
                conversationId: 'default',
                attachment: {
                    name: 'player-card.png',
                    kind: 'image',
                    mimeType: 'image/png'
                }
            },
            assistantMessage: {
                id: 'assistant-image',
                role: 'assistant',
                text: 'I read the image, but I need a player name.',
                createdAt: new Date('2026-06-28T13:18:01Z'),
                conversationId: 'default'
            },
            toolResults: []
        });

        expect(await screen.findByText('AI received this image')).toBeTruthy();
        expect(await screen.findByText('AI processed player-card.png. The attachment was cleared from the composer.')).toBeTruthy();
    });

    it('copies an errored saved request back into the composer for editing', async () => {
        privateAiServiceMocks.loadPrivateAiConversations.mockResolvedValue([{
            id: 'conversation-error',
            title: 'Roster image',
            createdAt: new Date('2026-06-28T13:18:00Z'),
            updatedAt: new Date('2026-06-28T13:19:00Z'),
            lastMessagePreview: 'Roster needs review'
        }]);
        privateAiServiceMocks.loadPrivateAiMessages.mockResolvedValue([
            {
                id: 'user-error',
                role: 'user',
                text: 'Assign parent@example.com to this player.',
                createdAt: new Date('2026-06-28T13:18:00Z'),
                conversationId: 'conversation-error',
                attachment: {
                    name: 'player-card.png',
                    kind: 'image',
                    mimeType: 'image/png'
                }
            },
            {
                id: 'assistant-error',
                role: 'assistant',
                text: 'I could not match the player.',
                createdAt: new Date('2026-06-28T13:19:00Z'),
                conversationId: 'conversation-error',
                artifacts: [{
                    type: 'roster-import',
                    confirmationId: '',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    source: 'ai-image',
                    summary: {
                        total: 0,
                        add: 0,
                        update: 0,
                        deactivate: 0,
                        reactivate: 0,
                        invitations: 0,
                        errors: 1
                    }
                }]
            }
        ]);

        renderChat();

        fireEvent.click(await screen.findByRole('button', { name: 'Edit request' }));

        expect(screen.getByDisplayValue('Assign parent@example.com to this player.')).toBeTruthy();
        expect(screen.getByText('Request copied into the composer. Edit it, then paste or attach the source file again.')).toBeTruthy();
    });

    it('edits a roster artifact in place and transactionally replaces the pending proposal', async () => {
        privateAiServiceMocks.loadPrivateAiConversations.mockResolvedValue([
            {
                id: 'conversation-roster',
                title: 'Roster import',
                createdAt: new Date('2026-06-28T13:18:00Z'),
                updatedAt: new Date('2026-06-28T13:19:00Z'),
                lastMessagePreview: 'Roster ready'
            }
        ]);
        privateAiServiceMocks.loadPrivateAiMessages.mockResolvedValue([
            {
                id: 'assistant-roster',
                role: 'assistant',
                text: 'I prepared one roster operation.',
                createdAt: new Date('2026-06-28T13:19:00Z'),
                conversationId: 'conversation-roster',
                artifacts: [{
                    type: 'roster-import',
                    confirmationId: 'ai_roster1',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    source: 'ai-text',
                    summary: {
                        total: 1,
                        add: 1,
                        update: 0,
                        deactivate: 0,
                        reactivate: 0,
                        invitations: 0,
                        errors: 0
                    },
                    previewRows: [{
                        rowNumber: 1,
                        action: 'add',
                        playerId: '',
                        name: 'Avery',
                        number: '9',
                        reason: '',
                        fields: [{ key: 'name', label: 'Name', type: 'text', value: 'Avery' }],
                        contacts: [],
                        inviteCount: 0,
                        duplicatePlayerId: '',
                        duplicatePlayerName: '',
                        errors: [],
                        operation: { type: 'add', payload: { name: 'Avery' } },
                        rawOperation: { action: 'add', player: { name: 'Avery' } }
                    }]
                }]
            }
        ]);

        renderChat();

        const nameInput = await screen.findByLabelText('Row 1 Name');
        fireEvent.change(nameInput, { target: { value: 'Avery Smith' } });
        fireEvent.blur(nameInput);

        await waitFor(() => {
            expect(teamDetailServiceMocks.loadRosterImportContextForApp).toHaveBeenCalledWith('team-1', auth.user);
            expect(privateAiServiceMocks.revisePrivateAiRosterImportProposal).toHaveBeenCalledWith(
                auth.user,
                expect.objectContaining({
                    confirmationId: 'ai_roster1',
                    teamId: 'team-1',
                    rows: expect.arrayContaining([
                        expect.objectContaining({ name: 'Avery Smith', errors: [] })
                    ])
                })
            );
        });
        expect(await screen.findByText('Roster review updated. Reply yes when the complete proposal looks right.')).toBeTruthy();
    });

    it('offers an actionable recovery when an update does not match a roster player', async () => {
        privateAiServiceMocks.loadPrivateAiConversations.mockResolvedValue([{
            id: 'conversation-roster',
            title: 'Roster import',
            createdAt: new Date('2026-06-28T13:18:00Z'),
            updatedAt: new Date('2026-06-28T13:19:00Z'),
            lastMessagePreview: 'Roster needs review'
        }]);
        privateAiServiceMocks.loadPrivateAiMessages.mockResolvedValue([{
            id: 'assistant-roster',
            role: 'assistant',
            text: 'I found one roster row that needs a decision.',
            createdAt: new Date('2026-06-28T13:19:00Z'),
            conversationId: 'conversation-roster',
            artifacts: [{
                type: 'roster-import',
                confirmationId: 'ai_roster_unmatched',
                teamId: 'team-1',
                teamName: 'Bears',
                source: 'csv',
                summary: {
                    total: 1,
                    add: 0,
                    update: 1,
                    deactivate: 0,
                    reactivate: 0,
                    invitations: 0,
                    errors: 1
                },
                previewRows: [{
                    rowNumber: 1,
                    action: 'update',
                    playerId: '',
                    name: 'Jordan New',
                    number: '23',
                    reason: '',
                    fields: [
                        { key: 'name', label: 'Name', type: 'text', value: 'Jordan New' },
                        { key: 'number', label: 'Number', type: 'text', value: '23' }
                    ],
                    contacts: [],
                    inviteCount: 0,
                    duplicatePlayerId: '',
                    duplicatePlayerName: '',
                    errors: ['Row 1: no matching existing player was found.'],
                    operation: {
                        type: 'update',
                        action: 'update',
                        playerId: '',
                        payload: { name: 'Jordan New', number: '23' },
                        errors: ['Row 1: no matching existing player was found.']
                    },
                    rawOperation: {
                        action: 'update',
                        changes: { name: 'Jordan New', number: '23' }
                    }
                }]
            }]
        }]);

        renderChat();

        expect(await screen.findByText('Choose how to handle this row')).toBeTruthy();
        expect(screen.getByText(/change the Name above to exactly match that player/i)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Import as a new player' }));

        await waitFor(() => {
            expect(privateAiServiceMocks.revisePrivateAiRosterImportProposal).toHaveBeenCalledWith(
                auth.user,
                expect.objectContaining({
                    confirmationId: 'ai_roster_unmatched',
                    teamId: 'team-1',
                    rows: [
                        expect.objectContaining({
                            action: 'add',
                            name: 'Jordan New',
                            number: '23',
                            errors: []
                        })
                    ]
                })
            );
        });
    });
});
