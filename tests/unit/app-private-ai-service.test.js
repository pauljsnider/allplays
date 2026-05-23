// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getChatMessages: vi.fn(),
    getGames: vi.fn(),
    getParentTeams: vi.fn(),
    getPlayers: vi.fn(),
    getTeam: vi.fn(),
    getUnreadChatCounts: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeamsWithAccess: vi.fn(),
    listParentTeamFeeRecipients: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
    db: {},
    addDoc: vi.fn(),
    collection: vi.fn((db, ...path) => ({ db, path })),
    getDocs: vi.fn(),
    limit: vi.fn((count) => ({ type: 'limit', count })),
    orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
    query: vi.fn((...parts) => ({ parts })),
    serverTimestamp: vi.fn(() => ({ __serverTimestamp: true }))
}));

const aiMocks = vi.hoisted(() => {
    const model = {
        generateContent: vi.fn()
    };
    return {
        model,
        getApp: vi.fn(() => ({ name: 'app' })),
        getAI: vi.fn(() => ({ name: 'ai' })),
        getGenerativeModel: vi.fn(() => model),
        GoogleAIBackend: vi.fn(function GoogleAIBackend() {})
    };
});

const chatMocks = vi.hoisted(() => ({
    getChatInboxPreview: vi.fn((message) => message ? `${message.senderName || 'Unknown'}: ${message.text || 'Attachment'}` : 'No messages yet'),
    loadChatInbox: vi.fn()
}));

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn()
}));

const scheduleMocks = vi.hoisted(() => ({
    loadParentSchedule: vi.fn()
}));

const teamMocks = vi.hoisted(() => ({
    loadParentTeamDetail: vi.fn()
}));

const toolsMocks = vi.hoisted(() => ({
    loadParentCertificates: vi.fn(),
    loadParentFeesForApp: vi.fn(),
    loadParentRegistrations: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/firebase.js', () => firebaseMocks);
vi.mock('../../js/vendor/firebase-app.js', () => ({
    getApp: aiMocks.getApp
}));
vi.mock('../../js/vendor/firebase-ai.js', () => ({
    getAI: aiMocks.getAI,
    getGenerativeModel: aiMocks.getGenerativeModel,
    GoogleAIBackend: aiMocks.GoogleAIBackend
}));
vi.mock('../../apps/app/src/lib/chatService.ts', () => chatMocks);
vi.mock('../../apps/app/src/lib/homeService.ts', () => homeMocks);
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);
vi.mock('../../apps/app/src/lib/teamDetailService.ts', () => teamMocks);
vi.mock('../../apps/app/src/lib/parentToolsService.ts', () => toolsMocks);

const authUser = {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    roles: ['parent'],
    emailVerified: true
};

function modelText(text) {
    return {
        response: {
            text: () => text
        }
    };
}

function futureEvent(overrides = {}) {
    return {
        eventKey: 'team-1:game-1:player-1',
        id: 'game-1',
        teamId: 'team-1',
        teamName: 'Bears',
        type: 'game',
        date: new Date('2026-06-01T18:00:00Z'),
        location: 'Field 1',
        opponent: 'Rockets',
        childId: 'player-1',
        childName: 'Avery',
        isDbGame: true,
        isCancelled: false,
        myRsvp: 'not_responded',
        rsvpSummary: { going: 4, notResponded: 3 },
        rideshareSummary: { offerCount: 1, seatsLeft: 2, requests: 1, pending: 1, confirmed: 0, isFull: false },
        assignments: [{ role: 'Snacks', claimable: true }],
        ...overrides
    };
}

beforeEach(async () => {
    vi.clearAllMocks();
    aiMocks.model.generateContent.mockReset();
    firebaseMocks.getDocs.mockResolvedValue({ docs: [] });
    let docIndex = 0;
    firebaseMocks.addDoc.mockImplementation(async () => ({ id: `ai-message-${++docIndex}` }));
    dbMocks.getUserProfile.mockResolvedValue({ fullName: 'Pat Parent', notificationPreferences: { chat: true } });
    dbMocks.getParentTeams.mockResolvedValue([{ id: 'team-1', name: 'Bears', sport: 'Basketball' }]);
    dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
    dbMocks.getUnreadChatCounts.mockResolvedValue({ 'team-1': 2 });
    dbMocks.getChatMessages.mockResolvedValue([{ senderName: 'Coach Jamie', text: 'Practice packet posted.', createdAt: new Date('2026-05-21T12:00:00Z') }]);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', sport: 'Basketball' });
    dbMocks.getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Avery', number: '9' }]);
    dbMocks.getGames.mockResolvedValue([]);
    dbMocks.listParentTeamFeeRecipients.mockResolvedValue([]);
    chatMocks.loadChatInbox.mockResolvedValue({
        teams: [{
            id: 'team-1',
            name: 'Bears',
            sport: 'Basketball',
            role: 'Parent',
            unreadCount: 2,
            lastMessage: { senderName: 'Coach Jamie', text: 'Practice packet posted.', createdAt: new Date('2026-05-21T12:00:00Z') }
        }]
    });
    homeMocks.loadParentHome.mockResolvedValue({
        metrics: { players: 1, teams: 1, rsvpNeeded: 1, unreadMessages: 2, packetsReady: 0 },
        actionItems: [{ kind: 'rsvp', title: 'Avery needs availability', detail: 'Bears vs. Rockets', to: '/schedule/team-1/game-1' }],
        players: [{ playerId: 'player-1', name: 'Avery', teamId: 'team-1', teamName: 'Bears' }],
        teams: [{ teamId: 'team-1', teamName: 'Bears', sport: 'Basketball', role: 'Parent', players: [{ name: 'Avery' }] }],
        upcomingEvents: [futureEvent()],
        fees: []
    });
    scheduleMocks.loadParentSchedule.mockResolvedValue({
        children: [{ playerId: 'player-1', name: 'Avery', teamId: 'team-1', teamName: 'Bears' }],
        events: [futureEvent()]
    });
    teamMocks.loadParentTeamDetail.mockResolvedValue({
        team: { id: 'team-1', name: 'Bears', sport: 'Basketball' },
        players: [{ id: 'player-1', name: 'Avery', number: '9' }],
        linkedPlayers: [{ id: 'player-1', name: 'Avery', number: '9' }],
        upcomingEvents: [],
        recentResults: [],
        nextEvent: null,
        record: { label: '2026', wins: 3, losses: 1, ties: 0 },
        standings: { enabled: false },
        leaderboards: [],
        trackingSummaries: [],
        counts: { games: 4, practices: 2, completedGames: 4 }
    });
    toolsMocks.loadParentFeesForApp.mockResolvedValue([]);
    toolsMocks.loadParentRegistrations.mockResolvedValue([]);
    toolsMocks.loadParentCertificates.mockResolvedValue([]);
    const service = await import('../../apps/app/src/lib/privateAiService.ts');
    service.resetPrivateAiModelForTests();
});

describe('private AI service', () => {
    it('loads user-scoped private AI messages from Firestore', async () => {
        firebaseMocks.getDocs.mockResolvedValueOnce({
            docs: [
                {
                    id: 'msg-2',
                    data: () => ({
                        role: 'assistant',
                        text: 'Bears play Monday.',
                        clientCreatedAt: '2026-05-21T12:01:00Z',
                        toolNames: ['get_schedule']
                    })
                },
                {
                    id: 'msg-1',
                    data: () => ({
                        role: 'user',
                        text: 'What is next?',
                        createdAt: { toDate: () => new Date('2026-05-21T12:00:00Z') }
                    })
                }
            ]
        });

        const { loadPrivateAiMessages } = await import('../../apps/app/src/lib/privateAiService.ts');
        const messages = await loadPrivateAiMessages(authUser);

        expect(firebaseMocks.collection).toHaveBeenCalledWith(firebaseMocks.db, 'users', 'user-1', 'privateAiMessages');
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(messages).toEqual([
            expect.objectContaining({ id: 'msg-1', role: 'user', text: 'What is next?' }),
            expect.objectContaining({ id: 'msg-2', role: 'assistant', text: 'Bears play Monday.', toolNames: ['get_schedule'] })
        ]);
    });

    it('saves the prompt, lets AI request schedule data, and saves the answer privately', async () => {
        aiMocks.model.generateContent
            .mockResolvedValueOnce(modelText(JSON.stringify({
                toolCalls: [{ name: 'get_schedule', args: { range: 'upcoming', limit: 2 } }]
            })))
            .mockResolvedValueOnce(modelText(JSON.stringify({
                answer: 'Avery needs an RSVP for Bears vs. Rockets on Jun 1.'
            })));

        const { sendPrivateAiMessage } = await import('../../apps/app/src/lib/privateAiService.ts');
        const result = await sendPrivateAiMessage(authUser, 'What do I need to do?');

        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledWith(authUser);
        expect(firebaseMocks.addDoc).toHaveBeenCalledTimes(2);
        expect(firebaseMocks.addDoc.mock.calls[0][1]).toMatchObject({
            role: 'user',
            text: 'What do I need to do?'
        });
        expect(firebaseMocks.addDoc.mock.calls[1][1]).toMatchObject({
            role: 'assistant',
            text: 'Avery needs an RSVP for Bears vs. Rockets on Jun 1.',
            toolNames: ['get_schedule']
        });
        expect(result.assistantMessage).toMatchObject({
            id: 'ai-message-2',
            role: 'assistant',
            text: 'Avery needs an RSVP for Bears vs. Rockets on Jun 1.',
            toolNames: ['get_schedule']
        });
        expect(result.toolResults[0]).toMatchObject({ name: 'get_schedule', ok: true });
    });

    it('parses fenced JSON planner responses and rejects unsupported tools', async () => {
        const { parsePrivateAiPlannerResponse, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        expect(parsePrivateAiPlannerResponse('```json\n{"toolCalls":[{"name":"get_home"}]}\n```')).toEqual({
            answer: '',
            toolCalls: [{ name: 'get_home', args: {} }]
        });

        await expect(runPrivateAiTool(authUser, { name: 'delete_everything' })).resolves.toMatchObject({
            name: 'delete_everything',
            ok: false
        });
    });

    it('only loads team detail for teams accessible from the user home model', async () => {
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(authUser, { name: 'get_team_detail', args: { teamId: 'team-2' } })).resolves.toMatchObject({
            ok: false,
            error: 'No matching team was found for this account.'
        });
        expect(dbMocks.getTeam).not.toHaveBeenCalled();

        await expect(runPrivateAiTool(authUser, { name: 'get_team_detail', args: { teamName: 'bear' } })).resolves.toMatchObject({
            ok: true,
            data: expect.objectContaining({
                team: expect.objectContaining({ id: 'team-1', name: 'Bears' })
            })
        });
        expect(dbMocks.getTeam).toHaveBeenCalledWith('team-1', { includeInactive: true });
    });
});
