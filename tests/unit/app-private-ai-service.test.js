// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getUserProfile: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
    db: {},
    addDoc: vi.fn(),
    collection: vi.fn((db, ...path) => ({ db, path })),
    doc: vi.fn((db, ...path) => ({ db, path })),
    getDocs: vi.fn(),
    limit: vi.fn((count) => ({ type: 'limit', count })),
    orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
    query: vi.fn((...parts) => ({ parts })),
    serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
    setDoc: vi.fn()
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

const playerMocks = vi.hoisted(() => {
    const loadParentPlayerDetailWithAthleteProfile = vi.fn();
    const loadParentPlayerVideoClips = vi.fn();
    return {
        loadParentPlayerDetail: loadParentPlayerDetailWithAthleteProfile,
        loadParentPlayerDetailWithAthleteProfile,
        loadParentPlayerVideoClips
    };
});

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
vi.mock('../../apps/app/src/lib/playerService.ts', () => playerMocks);
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
    firebaseMocks.setDoc.mockResolvedValue();
    let docIndex = 0;
    firebaseMocks.addDoc.mockImplementation(async () => ({ id: `ai-message-${++docIndex}` }));
    dbMocks.getUserProfile.mockResolvedValue({ fullName: 'Pat Parent', notificationPreferences: { chat: true } });
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
    playerMocks.loadParentPlayerDetailWithAthleteProfile.mockResolvedValue({
        child: { playerId: 'player-1', playerName: 'Avery', teamId: 'team-1', teamName: 'Bears' },
        player: { id: 'player-1', name: 'Avery', number: '9', position: 'Guard' },
        team: { id: 'team-1', name: 'Bears', sport: 'Basketball' },
        nextEvent: futureEvent(),
        actionCounts: { rsvpNeeded: 1, packetsReady: 0, openAssignments: 1 },
        statRows: [{ event: futureEvent({ id: 'game-0', date: new Date('2026-05-01T18:00:00Z') }), stats: { points: 8, rebounds: 4 } }],
        trackingSummary: [{ label: 'Defense', value: 'Improving' }],
        incentives: {
            currentRules: [{ statKey: 'points', amountCents: 100 }],
            totalEarnedCents: 800,
            unpaidCents: 200,
            seasonGameEarnings: []
        },
        athleteProfile: { profile: { headline: 'Two-way guard' }, shareUrl: 'https://allplays.ai/athlete-profile.html?id=profile-1', builderUrl: 'https://allplays.ai/athlete-profile-builder.html' },
        certificates: [],
        clips: []
    });
    playerMocks.loadParentPlayerVideoClips.mockResolvedValue([]);
    toolsMocks.loadParentFeesForApp.mockResolvedValue([]);
    toolsMocks.loadParentRegistrations.mockResolvedValue([]);
    toolsMocks.loadParentCertificates.mockResolvedValue([]);
    const service = await import('../../apps/app/src/lib/privateAiService.ts');
    service.resetPrivateAiModel();
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

    it('loads and creates user-scoped private AI conversations', async () => {
        firebaseMocks.getDocs.mockResolvedValueOnce({
            docs: [
                {
                    id: 'conversation-1',
                    data: () => ({
                        title: 'Player plan',
                        lastMessagePreview: 'Use recent stats for Avery.',
                        clientCreatedAt: '2026-05-21T12:00:00Z',
                        clientUpdatedAt: '2026-05-21T12:05:00Z'
                    })
                }
            ]
        });

        const { createPrivateAiConversation, loadPrivateAiConversations } = await import('../../apps/app/src/lib/privateAiService.ts');
        const conversations = await loadPrivateAiConversations(authUser);

        expect(firebaseMocks.collection).toHaveBeenCalledWith(firebaseMocks.db, 'users', 'user-1', 'privateAiConversations');
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('updatedAt', 'desc');
        expect(conversations).toEqual([
            expect.objectContaining({
                id: 'conversation-1',
                title: 'Player plan',
                lastMessagePreview: 'Use recent stats for Avery.'
            })
        ]);

        const created = await createPrivateAiConversation(authUser, 'New player development chat');
        expect(created).toMatchObject({
            id: 'ai-message-1',
            title: 'New player development chat',
            lastMessagePreview: ''
        });
        expect(firebaseMocks.addDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['users', 'user-1', 'privateAiConversations'] }),
            expect.objectContaining({ title: 'New player development chat' })
        );
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

        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledWith(authUser, { includePastGames: false });
        expect(firebaseMocks.addDoc).toHaveBeenCalledTimes(2);
        expect(firebaseMocks.addDoc.mock.calls[0][1]).toMatchObject({
            role: 'user',
            text: 'What do I need to do?',
            conversationId: 'default'
        });
        expect(firebaseMocks.addDoc.mock.calls[1][1]).toMatchObject({
            role: 'assistant',
            text: 'Avery needs an RSVP for Bears vs. Rockets on Jun 1.',
            conversationId: 'default',
            toolNames: ['get_schedule']
        });
        expect(firebaseMocks.setDoc).toHaveBeenCalledTimes(2);
        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'users', 'user-1', 'privateAiConversations', 'default');
        expect(result.assistantMessage).toMatchObject({
            id: 'ai-message-2',
            role: 'assistant',
            text: 'Avery needs an RSVP for Bears vs. Rockets on Jun 1.',
            toolNames: ['get_schedule']
        });
        expect(result.toolResults[0]).toMatchObject({ name: 'get_schedule', ok: true });
    });

    it('creates a saved conversation only when the first draft message is sent', async () => {
        aiMocks.model.generateContent.mockResolvedValueOnce(modelText(JSON.stringify({
            answer: 'Draft answer.'
        })));

        const { DRAFT_PRIVATE_AI_CONVERSATION_ID, loadPrivateAiConversations, sendPrivateAiMessage } = await import('../../apps/app/src/lib/privateAiService.ts');

        const beforeSend = await loadPrivateAiConversations(authUser);
        expect(beforeSend).toEqual([]);

        const result = await sendPrivateAiMessage(authUser, 'First draft question', DRAFT_PRIVATE_AI_CONVERSATION_ID);

        expect(firebaseMocks.addDoc).toHaveBeenCalledTimes(3);
        expect(firebaseMocks.addDoc.mock.calls[0][0]).toMatchObject({ path: ['users', 'user-1', 'privateAiConversations'] });
        expect(firebaseMocks.addDoc.mock.calls[0][1]).toMatchObject({
            title: 'First draft question',
            lastMessagePreview: ''
        });
        expect(firebaseMocks.addDoc.mock.calls[1][1]).toMatchObject({
            role: 'user',
            text: 'First draft question',
            conversationId: 'ai-message-1'
        });
        expect(firebaseMocks.addDoc.mock.calls[2][1]).toMatchObject({
            role: 'assistant',
            text: 'Draft answer.',
            conversationId: 'ai-message-1'
        });
        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'users', 'user-1', 'privateAiConversations', 'ai-message-1');
        expect(result.userMessage).toMatchObject({
            conversationId: 'ai-message-1'
        });
        expect(result.assistantMessage).toMatchObject({
            conversationId: 'ai-message-1'
        });
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
        expect(teamMocks.loadParentTeamDetail).not.toHaveBeenCalled();

        await expect(runPrivateAiTool(authUser, { name: 'get_team_detail', args: { teamName: 'bear' } })).resolves.toMatchObject({
            ok: true,
            data: expect.objectContaining({
                team: expect.objectContaining({ id: 'team-1', name: 'Bears' })
            })
        });
        expect(teamMocks.loadParentTeamDetail).toHaveBeenCalledWith('team-1', authUser);
    });

    it('uses linked player detail data for player development coaching answers', async () => {
        playerMocks.loadParentPlayerVideoClips.mockResolvedValueOnce([
            { id: 'clip-1', title: 'Fast break', url: 'https://video.example.test/fast-break.mp4' }
        ]);
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(authUser, { name: 'get_player_development', args: { playerName: 'ave' } })).resolves.toMatchObject({
            ok: true,
            data: expect.objectContaining({
                player: expect.objectContaining({
                    id: 'player-1',
                    name: 'Avery',
                    teamName: 'Bears',
                    sport: 'Basketball'
                }),
                actionCounts: { rsvpNeeded: 1, packetsReady: 0, openAssignments: 1 },
                incentives: expect.objectContaining({
                    totalEarnedCents: 800,
                    unpaidCents: 200
                }),
                clips: [
                    expect.objectContaining({
                        id: 'clip-1',
                        title: 'Fast break',
                        url: 'https://video.example.test/fast-break.mp4'
                    })
                ]
            })
        });
        expect(playerMocks.loadParentPlayerDetailWithAthleteProfile).toHaveBeenCalledWith(authUser, 'team-1', 'player-1');
        expect(playerMocks.loadParentPlayerVideoClips).toHaveBeenCalledWith(authUser, 'team-1', 'player-1');
    });

    it('opts all-range AI schedule lookups into full history loads', async () => {
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(authUser, { name: 'get_schedule', args: { range: 'all', limit: 5 } })).resolves.toMatchObject({
            ok: true,
            data: expect.objectContaining({
                events: expect.any(Array)
            })
        });

        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledWith(authUser, { includePastGames: true });
    });

    it('uses the parent registrations loader for private AI parent tools summaries', async () => {
        toolsMocks.loadParentRegistrations.mockResolvedValueOnce([{ id: 'form-1', teamName: 'Bears', programName: 'Summer Camp' }]);
        toolsMocks.loadParentCertificates.mockResolvedValueOnce([{ id: 'cert-1', title: 'Hustle Award' }]);
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(authUser, { name: 'get_parent_tools' })).resolves.toMatchObject({
            ok: true,
            data: {
                registrations: [{ id: 'form-1', teamName: 'Bears', programName: 'Summer Camp' }],
                certificates: [{ id: 'cert-1', title: 'Hustle Award' }]
            }
        });

        expect(toolsMocks.loadParentRegistrations).toHaveBeenCalledWith(authUser);
        expect(toolsMocks.loadParentCertificates).toHaveBeenCalledWith(authUser);
    });

    it('retrieves help workflow pages for functional questions', async () => {
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(authUser, {
            name: 'get_help',
            args: {
                query: 'How do I offer a ride or update RSVP?',
                limit: 3
            }
        })).resolves.toMatchObject({
            ok: true,
            data: {
                results: expect.arrayContaining([
                    expect.objectContaining({
                        title: expect.stringMatching(/Messages|Availability|Communication|Schedule/i),
                        file: expect.stringMatching(/workflow-communication|workflow-schedule|help-/),
                        url: expect.stringContaining('https://allplays.ai/')
                    })
                ])
            }
        });
    });

    it('preloads help docs before answering likely how-to questions', async () => {
        aiMocks.model.generateContent.mockResolvedValueOnce(modelText(JSON.stringify({
            answer: 'Open login.html, choose Forgot password, then use the newest reset email.'
        })));

        const { generatePrivateAiAnswer } = await import('../../apps/app/src/lib/privateAiService.ts');
        const result = await generatePrivateAiAnswer(authUser, 'How do I reset my password?');

        expect(result.toolResults[0]).toMatchObject({
            name: 'get_help',
            ok: true,
            data: {
                results: expect.any(Array)
            }
        });
        expect(result.answer).toContain('Forgot password');
    });
});
