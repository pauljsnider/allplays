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
    getDoc: vi.fn(),
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
    loadChatConversations: vi.fn(),
    loadChatInbox: vi.fn(),
    sendTeamChatMessage: vi.fn()
}));

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn()
}));

const scheduleMocks = vi.hoisted(() => ({
    cancelParentScheduleRideRequest: vi.fn(),
    claimParentScheduleAssignmentSlot: vi.fn(),
    createParentScheduleRideOffer: vi.fn(),
    loadParentPracticePacket: vi.fn(),
    loadParentSchedule: vi.fn(),
    loadParentScheduleAssignments: vi.fn(),
    loadParentScheduleEventDetail: vi.fn(),
    loadParentScheduleRideOffers: vi.fn(),
    markParentPracticePacketComplete: vi.fn(),
    requestParentScheduleRideSpot: vi.fn(),
    releaseParentScheduleAssignmentClaim: vi.fn(),
    setParentScheduleRideOfferStatus: vi.fn(),
    submitParentScheduleRsvp: vi.fn(),
    submitParentScheduleRsvpForChildren: vi.fn(),
    summarizeParentScheduleRideOffers: vi.fn()
}));

const teamMocks = vi.hoisted(() => ({
    loadParentTeamDetail: vi.fn()
}));

const playerMocks = vi.hoisted(() => {
    const loadParentPlayerDetailWithAthleteProfile = vi.fn();
    const loadParentPlayerStatTotals = vi.fn();
    const loadParentPlayerVideoClips = vi.fn();
    return {
        loadParentPlayerDetail: loadParentPlayerDetailWithAthleteProfile,
        loadParentPlayerDetailWithAthleteProfile,
        loadParentPlayerStatTotals,
        loadParentPlayerVideoClips,
        markParentPlayerIncentivePaid: vi.fn(),
        retireParentPlayerIncentiveRule: vi.fn(),
        saveParentPlayerIncentiveCap: vi.fn(),
        saveParentPlayerIncentiveRule: vi.fn(),
        toggleParentPlayerIncentiveRule: vi.fn(),
        updateParentPlayerEditableProfile: vi.fn()
    };
});

const toolsMocks = vi.hoisted(() => ({
    createParentFamilyShare: vi.fn(),
    createParentHouseholdMemberInvite: vi.fn(),
    discoverParentAccessTeams: vi.fn(),
    loadFamilyShareModel: vi.fn(),
    loadParentAccessModel: vi.fn(),
    loadParentAccessPlayers: vi.fn(),
    loadParentCertificates: vi.fn(),
    loadParentFeesForApp: vi.fn(),
    loadParentHouseholdInviteModel: vi.fn(),
    loadParentRegistrations: vi.fn(),
    revokeParentFamilyShare: vi.fn(),
    submitParentAccessRequest: vi.fn(),
    updateParentFamilyShareCalendars: vi.fn()
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
    firebaseMocks.getDoc.mockResolvedValue({ exists: () => false, data: () => null });
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
    chatMocks.loadChatConversations.mockResolvedValue([{ id: 'default', type: 'team', name: 'Team chat', lastMessagePreview: 'See you soon' }]);
    chatMocks.sendTeamChatMessage.mockResolvedValue({ conversationId: 'default', wantsAi: false });
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
    scheduleMocks.loadParentScheduleAssignments.mockResolvedValue([{ role: 'Snacks', claimable: true, value: '' }]);
    scheduleMocks.claimParentScheduleAssignmentSlot.mockResolvedValue();
    scheduleMocks.releaseParentScheduleAssignmentClaim.mockResolvedValue();
    scheduleMocks.loadParentPracticePacket.mockResolvedValue({
        sessionId: 'practice-1',
        teamId: 'team-1',
        eventId: 'practice-1',
        title: 'Practice',
        date: new Date('2026-06-02T18:00:00Z'),
        location: 'Gym',
        homePacket: { note: 'Bring cleats' },
        completions: [],
        children: [{ id: 'player-1', name: 'Avery' }]
    });
    scheduleMocks.loadParentScheduleEventDetail.mockResolvedValue({ events: [] });
    scheduleMocks.markParentPracticePacketComplete.mockResolvedValue({ id: 'user-1__player-1', childId: 'player-1', status: 'completed' });
    scheduleMocks.loadParentScheduleRideOffers.mockResolvedValue([]);
    scheduleMocks.summarizeParentScheduleRideOffers.mockReturnValue({ offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false });
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
        canManageTeam: true,
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
        privateProfile: {
            emergencyContact: {
                name: 'Morgan Parent',
                phone: '555-0100'
            },
            medicalInfo: 'Carries inhaler'
        },
        athleteProfile: { profile: { headline: 'Two-way guard' }, shareUrl: 'https://allplays.ai/athlete-profile.html?id=profile-1', builderUrl: 'https://allplays.ai/athlete-profile-builder.html' },
        certificates: [],
        clips: []
    });
    playerMocks.loadParentPlayerVideoClips.mockResolvedValue([]);
    playerMocks.loadParentPlayerStatTotals.mockResolvedValue({
        teamId: 'team-1',
        playerId: 'player-1',
        gameCount: 8,
        gameIds: ['game-0'],
        totals: { goals: 7, assists: 3 }
    });
    playerMocks.saveParentPlayerIncentiveRule.mockResolvedValue({ id: 'rule-1' });
    playerMocks.toggleParentPlayerIncentiveRule.mockResolvedValue({ id: 'rule-1', active: false });
    playerMocks.retireParentPlayerIncentiveRule.mockResolvedValue({ id: 'rule-1', retired: true });
    playerMocks.saveParentPlayerIncentiveCap.mockResolvedValue({ maxPerGameCents: 500 });
    playerMocks.markParentPlayerIncentivePaid.mockResolvedValue({ paid: true });
    toolsMocks.loadParentFeesForApp.mockResolvedValue([]);
    toolsMocks.loadParentRegistrations.mockResolvedValue([]);
    toolsMocks.loadParentCertificates.mockResolvedValue([]);
    toolsMocks.loadParentAccessModel.mockResolvedValue({ teams: [], requests: [{ id: 'request-1', teamName: 'Bears', status: 'pending' }] });
    toolsMocks.discoverParentAccessTeams.mockResolvedValue({ teams: [{ id: 'team-1', name: 'Bears' }], nextCursor: null });
    toolsMocks.loadParentAccessPlayers.mockResolvedValue([{ id: 'player-1', name: 'Avery' }]);
    toolsMocks.submitParentAccessRequest.mockResolvedValue({ id: 'request-2', status: 'pending' });
    toolsMocks.loadParentHouseholdInviteModel.mockResolvedValue({ linkedPlayers: [], members: [] });
    toolsMocks.loadFamilyShareModel.mockResolvedValue({ children: [], tokens: [{ id: 'share-1', label: 'Grandparents', url: 'https://allplays.ai/family/share-1' }] });
    toolsMocks.createParentHouseholdMemberInvite.mockResolvedValue({ inviteId: 'invite-1', email: 'helper@example.com' });
    toolsMocks.createParentFamilyShare.mockResolvedValue({ tokenId: 'share-1', url: 'https://allplays.ai/family/share-1' });
    toolsMocks.revokeParentFamilyShare.mockResolvedValue();
    toolsMocks.updateParentFamilyShareCalendars.mockResolvedValue();
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

    it('recovers message-backed conversations without letting legacy default replace a stored initial chat', async () => {
        firebaseMocks.getDocs
            .mockResolvedValueOnce({
                docs: [
                    {
                        id: 'conversation-1',
                        data: () => ({
                            title: 'Saved player plan',
                            lastMessagePreview: 'Metadata wins for this thread.',
                            clientCreatedAt: '2026-05-20T12:00:00Z',
                            clientUpdatedAt: '2026-05-21T12:05:00Z'
                        })
                    }
                ]
            })
            .mockResolvedValueOnce({
                docs: [
                    {
                        id: 'legacy-answer',
                        data: () => ({
                            role: 'assistant',
                            text: 'Legacy answer',
                            clientCreatedAt: '2026-05-23T12:01:00Z'
                        })
                    },
                    {
                        id: 'legacy-question',
                        data: () => ({
                            role: 'user',
                            text: 'What did I miss?',
                            clientCreatedAt: '2026-05-23T12:00:00Z'
                        })
                    },
                    {
                        id: 'orphan-answer',
                        data: () => ({
                            role: 'assistant',
                            text: 'Here is the practice plan.',
                            conversationId: 'conversation-2',
                            clientCreatedAt: '2026-05-22T12:01:00Z'
                        })
                    },
                    {
                        id: 'orphan-question',
                        data: () => ({
                            role: 'user',
                            text: 'Build a practice plan',
                            conversationId: 'conversation-2',
                            clientCreatedAt: '2026-05-22T12:00:00Z'
                        })
                    },
                    {
                        id: 'stored-message',
                        data: () => ({
                            role: 'user',
                            text: 'This must not duplicate conversation-1',
                            conversationId: 'conversation-1',
                            clientCreatedAt: '2026-05-21T12:00:00Z'
                        })
                    }
                ]
            });

        const { loadPrivateAiConversations } = await import('../../apps/app/src/lib/privateAiService.ts');
        const conversations = await loadPrivateAiConversations(authUser);

        expect(conversations).toEqual([
            expect.objectContaining({
                id: 'conversation-2',
                title: 'Build a practice plan',
                lastMessagePreview: 'Here is the practice plan.'
            }),
            expect.objectContaining({
                id: 'conversation-1',
                title: 'Saved player plan',
                lastMessagePreview: 'Metadata wins for this thread.'
            })
        ]);
        expect(conversations.some((conversation) => conversation.id === 'default')).toBe(false);
        expect(conversations.filter((conversation) => conversation.id === 'conversation-1')).toHaveLength(1);
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
                seasonStatTotals: {
                    gameCount: 8,
                    totals: {
                        goals: 7,
                        assists: 3
                    }
                },
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
        expect(playerMocks.loadParentPlayerStatTotals).toHaveBeenCalledWith(authUser, 'team-1', 'player-1');
    });

    it('keeps player development answers available when optional video clips fail to load', async () => {
        playerMocks.loadParentPlayerVideoClips.mockRejectedValueOnce(new Error('Games unavailable'));
        playerMocks.loadParentPlayerStatTotals.mockRejectedValueOnce(new Error('Totals unavailable'));
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(authUser, { name: 'get_player_development', args: { playerName: 'ave' } })).resolves.toMatchObject({
            ok: true,
            data: expect.objectContaining({
                player: expect.objectContaining({
                    id: 'player-1',
                    name: 'Avery'
                }),
                clips: [],
                seasonStatTotals: {
                    gameCount: 1,
                    totals: {
                        points: 8,
                        rebounds: 4
                    }
                }
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

    it('returns the last past game with RSVP instead of substituting practices', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValueOnce({
            children: [{ playerId: 'player-1', name: 'Avery', teamId: 'team-1', teamName: 'Bears' }],
            events: [
                futureEvent({
                    id: 'practice-later',
                    eventKey: 'team-1:practice-later:player-1',
                    type: 'practice',
                    date: new Date('2020-07-10T18:00:00Z'),
                    myRsvp: 'not_responded'
                }),
                futureEvent({
                    id: 'game-last',
                    eventKey: 'team-1:game-last:player-1',
                    type: 'game',
                    date: new Date('2020-07-01T18:00:00Z'),
                    opponent: 'Comets',
                    myRsvp: 'going'
                }),
                futureEvent({
                    id: 'game-upcoming',
                    eventKey: 'team-1:game-upcoming:player-1',
                    type: 'game',
                    date: new Date('2099-08-01T18:00:00Z'),
                    opponent: 'Rockets',
                    myRsvp: 'not_responded'
                })
            ]
        });
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(authUser, { name: 'get_last_game', args: { playerName: 'Avery' } })).resolves.toMatchObject({
            ok: true,
            data: {
                lastGame: expect.objectContaining({
                    eventId: 'game-last',
                    type: 'game',
                    title: 'vs. Comets',
                    childName: 'Avery',
                    myRsvp: 'going'
                }),
                recentGames: [
                    expect.objectContaining({
                        eventId: 'game-last',
                        type: 'game'
                    })
                ]
            }
        });
        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledWith(authUser, { includePastGames: true });
    });

    it('preloads the last game lookup before answering last-game RSVP questions', async () => {
        scheduleMocks.loadParentSchedule.mockResolvedValueOnce({
            children: [{ playerId: 'player-1', name: 'Avery', teamId: 'team-1', teamName: 'Bears' }],
            events: [futureEvent({
                id: 'game-last',
                eventKey: 'team-1:game-last:player-1',
                date: new Date('2020-07-01T18:00:00Z'),
                opponent: 'Comets',
                myRsvp: 'going'
            })]
        });
        aiMocks.model.generateContent.mockResolvedValueOnce(modelText(JSON.stringify({
            answer: 'Avery last played Bears vs. Comets on Jul 1, and your RSVP was going.'
        })));
        const { generatePrivateAiAnswer } = await import('../../apps/app/src/lib/privateAiService.ts');

        const result = await generatePrivateAiAnswer(authUser, 'What was the last game and did I rsvp?');

        expect(result.toolResults).toEqual([
            expect.objectContaining({
                name: 'get_help',
                ok: true
            }),
            expect.objectContaining({
                name: 'get_last_game',
                ok: true,
                data: expect.objectContaining({
                    lastGame: expect.objectContaining({
                        eventId: 'game-last',
                        myRsvp: 'going'
                    })
                })
            })
        ]);
        expect(result.answer).toContain('RSVP was going');
    });

    it('exposes assignment, message thread, and access request read tools', async () => {
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(authUser, { name: 'list_assignments', args: { eventId: 'game-1', teamId: 'team-1' } })).resolves.toMatchObject({
            ok: true,
            data: {
                assignments: [expect.objectContaining({ role: 'Snacks' })]
            }
        });
        await expect(runPrivateAiTool(authUser, { name: 'list_message_threads', args: { teamId: 'team-1' } })).resolves.toMatchObject({
            ok: true,
            data: {
                threads: [expect.objectContaining({ id: 'default' })]
            }
        });
        expect(chatMocks.loadChatConversations).toHaveBeenCalledWith('team-1', authUser, expect.objectContaining({ id: 'team-1' }), true, {
            activeConversationId: null
        });
        await expect(runPrivateAiTool(authUser, { name: 'get_access_requests', args: { query: 'Bears', teamId: 'team-1' } })).resolves.toMatchObject({
            ok: true,
            data: {
                requests: [expect.objectContaining({ id: 'request-1' })],
                teams: [expect.objectContaining({ id: 'team-1' })],
                players: [expect.objectContaining({ id: 'player-1' })]
            }
        });
    });

    it('executes confirmed AI writes for messages, assignments, packets, access, and family share', async () => {
        const practiceEvent = futureEvent({
            id: 'practice-1',
            eventKey: 'team-1:practice-1:player-1',
            type: 'practice',
            practiceHomePacketSummary: { count: 1 },
            practiceHomePacket: { note: 'Bring cleats' }
        });
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [{ playerId: 'player-1', name: 'Avery', teamId: 'team-1', teamName: 'Bears' }],
            events: [futureEvent(), practiceEvent]
        });
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await runPrivateAiTool(authUser, { name: 'send_team_message', args: { teamId: 'team-1', text: 'See you at practice', __confirmed: true } });
        await runPrivateAiTool(authUser, { name: 'claim_assignment', args: { eventId: 'game-1', teamId: 'team-1', role: 'Snacks', __confirmed: true } });
        await runPrivateAiTool(authUser, { name: 'release_assignment', args: { eventId: 'game-1', teamId: 'team-1', role: 'Snacks', __confirmed: true } });
        const packetResult = await runPrivateAiTool(authUser, { name: 'mark_practice_packet_complete', args: { eventId: 'practice-1', teamId: 'team-1', __confirmed: true } });
        await runPrivateAiTool(authUser, { name: 'submit_access_request', args: { teamId: 'team-1', playerId: 'player-1', relation: 'Parent', __confirmed: true } });
        await runPrivateAiTool(authUser, { name: 'revoke_family_share_link', args: { tokenId: 'share-1', __confirmed: true } });
        await runPrivateAiTool(authUser, { name: 'update_family_share_calendars', args: { tokenId: 'share-1', extraCalendarUrls: ['https://calendar.example/feed.ics'], __confirmed: true } });

        expect(chatMocks.sendTeamChatMessage).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            text: 'See you at practice',
            selectedRecipientTarget: 'full_team'
        }));
        expect(scheduleMocks.claimParentScheduleAssignmentSlot).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), authUser, 'Snacks');
        expect(scheduleMocks.releaseParentScheduleAssignmentClaim).toHaveBeenCalledWith(expect.objectContaining({ id: 'game-1' }), 'Snacks');
        expect(packetResult).toMatchObject({ ok: true });
        expect(scheduleMocks.markParentPracticePacketComplete).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'practice-1' }), authUser, { id: 'player-1', name: 'Avery' });
        expect(toolsMocks.submitParentAccessRequest).toHaveBeenCalledWith('team-1', 'player-1', 'Parent');
        expect(toolsMocks.revokeParentFamilyShare).toHaveBeenCalledWith('share-1');
        expect(toolsMocks.updateParentFamilyShareCalendars).toHaveBeenCalledWith('share-1', ['https://calendar.example/feed.ics']);
    });

    it('fails closed when AI write selectors are ambiguous or unmatched', async () => {
        const practiceEvent = futureEvent({
            id: 'practice-1',
            eventKey: 'team-1:practice-1:player-1',
            type: 'practice',
            practiceHomePacketSummary: { count: 1 },
            practiceHomePacket: { note: 'Bring cleats' }
        });
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [{ playerId: 'player-1', name: 'Avery', teamId: 'team-1', teamName: 'Bears' }],
            events: [practiceEvent]
        });
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(authUser, { name: 'revoke_family_share_link', args: { __confirmed: true } })).resolves.toMatchObject({
            ok: false,
            error: 'tokenId is required for family share changes.'
        });
        await expect(runPrivateAiTool(authUser, {
            name: 'mark_practice_packet_complete',
            args: { eventId: 'practice-1', teamId: 'team-1', playerName: 'Missing Child', __confirmed: true }
        })).resolves.toMatchObject({
            ok: false,
            error: 'No matching child was found for this practice packet.'
        });
        expect(toolsMocks.revokeParentFamilyShare).not.toHaveBeenCalled();
        expect(scheduleMocks.markParentPracticePacketComplete).not.toHaveBeenCalled();
    });

    it('executes confirmed AI player incentive writes', async () => {
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await runPrivateAiTool(authUser, { name: 'save_player_incentive_rule', args: { teamId: 'team-1', playerId: 'player-1', statKey: 'goals', amount: 2, __confirmed: true } });
        await runPrivateAiTool(authUser, { name: 'set_player_incentive_cap', args: { teamId: 'team-1', playerId: 'player-1', maxPerGameAmount: 5, __confirmed: true } });
        await runPrivateAiTool(authUser, { name: 'mark_player_incentive_paid', args: { teamId: 'team-1', playerId: 'player-1', gameId: 'game-1', amount: 4, __confirmed: true } });

        expect(playerMocks.saveParentPlayerIncentiveRule).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            playerId: 'player-1',
            rule: expect.objectContaining({ statKey: 'goals', amountCents: 200 })
        }));
        expect(playerMocks.saveParentPlayerIncentiveCap).toHaveBeenCalledWith(authUser, 'team-1', 'player-1', 500);
        expect(playerMocks.markParentPlayerIncentivePaid).toHaveBeenCalledWith(authUser, 'team-1', 'player-1', 'game-1', 400);
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

    it('stages parent workflow writes for confirmation instead of executing immediately', async () => {
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        const result = await runPrivateAiTool(authUser, {
            name: 'update_rsvp',
            args: {
                teamId: 'team-1',
                eventId: 'game-1',
                playerId: 'player-1',
                response: 'going',
                note: 'Arriving late'
            }
        });

        expect(result).toMatchObject({
            name: 'update_rsvp',
            ok: true,
            requiresConfirmation: true,
            confirmationId: expect.stringMatching(/^ai_/),
            data: {
                confirmationText: 'Reply "yes" to apply this change.'
            }
        });
        expect(scheduleMocks.submitParentScheduleRsvp).not.toHaveBeenCalled();
        expect(firebaseMocks.setDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['users', 'user-1', 'privateAiPendingActions', result.confirmationId] }),
            expect.objectContaining({
                toolName: 'update_rsvp',
                status: 'pending',
                args: expect.objectContaining({
                    eventId: 'game-1',
                    response: 'going'
                })
            })
        );
    });

    it('executes confirmed pending RSVP writes through the app schedule service', async () => {
        scheduleMocks.submitParentScheduleRsvp.mockResolvedValueOnce({ going: 5, notResponded: 2 });
        const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');
        const staged = await runPrivateAiTool(authUser, {
            name: 'update_rsvp',
            args: {
                teamId: 'team-1',
                eventId: 'game-1',
                playerId: 'player-1',
                response: 'going',
                note: 'Arriving late'
            }
        });

        const result = await generatePrivateAiAnswer(authUser, `confirm ${staged.confirmationId}`);

        expect(scheduleMocks.submitParentScheduleRsvp).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'game-1', teamId: 'team-1', childId: 'player-1' }),
            authUser,
            'going',
            'Arriving late'
        );
        expect(result.answer).toContain('RSVP updated');
        expect(result.toolResults[0]).toMatchObject({
            name: 'update_rsvp',
            ok: true,
            confirmationId: staged.confirmationId
        });
    });

    it('lets a natural yes confirm the latest pending parent workflow write', async () => {
        scheduleMocks.submitParentScheduleRsvp.mockResolvedValueOnce({ going: 5, notResponded: 2 });
        const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');
        await runPrivateAiTool(authUser, {
            name: 'update_rsvp',
            args: {
                teamId: 'team-1',
                eventId: 'game-1',
                playerId: 'player-1',
                response: 'going',
                note: ''
            }
        });

        const result = await generatePrivateAiAnswer(authUser, 'yes');

        expect(scheduleMocks.submitParentScheduleRsvp).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'game-1', teamId: 'team-1', childId: 'player-1' }),
            authUser,
            'going',
            ''
        );
        expect(result.answer).toContain('RSVP updated');
        expect(result.toolResults[0]).toMatchObject({
            name: 'update_rsvp',
            ok: true
        });
    });

    it('confirms all pending writes from the latest group in the active conversation', async () => {
        scheduleMocks.submitParentScheduleRsvp.mockResolvedValue({ going: 5, notResponded: 2 });
        const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');
        await runPrivateAiTool(authUser, {
            name: 'update_rsvp',
            args: { teamId: 'team-1', eventId: 'game-1', playerId: 'player-1', response: 'maybe', note: 'Old tab' }
        }, { conversationId: 'other-conversation', confirmationGroupId: 'group-other' });
        await runPrivateAiTool(authUser, {
            name: 'update_rsvp',
            args: { teamId: 'team-1', eventId: 'game-1', playerId: 'player-1', response: 'going', note: 'First current action' }
        }, { conversationId: 'current-conversation', confirmationGroupId: 'group-current' });
        await runPrivateAiTool(authUser, {
            name: 'update_rsvp',
            args: { teamId: 'team-1', eventId: 'game-1', playerId: 'player-1', response: 'not_going', note: 'Second current action' }
        }, { conversationId: 'current-conversation', confirmationGroupId: 'group-current' });

        const result = await generatePrivateAiAnswer(authUser, 'yes', [], { conversationId: 'current-conversation' });

        expect(scheduleMocks.submitParentScheduleRsvp).toHaveBeenCalledTimes(2);
        expect(scheduleMocks.submitParentScheduleRsvp).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ id: 'game-1', teamId: 'team-1', childId: 'player-1' }),
            authUser,
            'going',
            'First current action'
        );
        expect(scheduleMocks.submitParentScheduleRsvp).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ id: 'game-1', teamId: 'team-1', childId: 'player-1' }),
            authUser,
            'not_going',
            'Second current action'
        );
        expect(result.toolResults).toHaveLength(2);
        expect(result.answer).toContain('RSVP updated');
    });

    it('preserves omitted private player profile fields during AI profile writes', async () => {
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(authUser, {
            name: 'update_player_profile',
            args: {
                teamId: 'team-1',
                playerId: 'player-1',
                emergencyContactPhone: '555-0199',
                __confirmed: true
            }
        })).resolves.toMatchObject({
            name: 'update_player_profile',
            ok: true
        });

        expect(playerMocks.updateParentPlayerEditableProfile).toHaveBeenCalledWith({
            user: authUser,
            teamId: 'team-1',
            playerId: 'player-1',
            emergencyContactName: 'Morgan Parent',
            emergencyContactPhone: '555-0199',
            medicalInfo: 'Carries inhaler'
        });
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
