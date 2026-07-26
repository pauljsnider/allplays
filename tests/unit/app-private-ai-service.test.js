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
    runTransaction: vi.fn((db, callback) => callback({
        get: vi.fn(async () => ({
            exists: () => true,
            data: () => ({
                status: 'pending',
                userId: 'user-1',
                expiresAt: new Date(Date.now() + 60_000).toISOString()
            })
        })),
        set: vi.fn()
    })),
    serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
    startAfter: vi.fn((cursor) => ({ type: 'startAfter', cursor })),
    setDoc: vi.fn()
}));

const aiMocks = vi.hoisted(() => {
    const model = {
        generateContent: vi.fn()
    };
    const makeSchema = (type, options = {}) => ({ type, ...options });
    return {
        model,
        getApp: vi.fn(() => ({ name: 'app' })),
        getAI: vi.fn(() => ({ name: 'ai' })),
        getGenerativeModel: vi.fn(() => model),
        GoogleAIBackend: vi.fn(function GoogleAIBackend() {}),
        Schema: {
            object: vi.fn((options) => makeSchema('object', options)),
            array: vi.fn((options) => makeSchema('array', options)),
            string: vi.fn((options) => makeSchema('string', options)),
            boolean: vi.fn((options) => makeSchema('boolean', options))
        }
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
    createScheduleImportGame: vi.fn(),
    createScheduleImportPractice: vi.fn(),
    createParentScheduleRideOffer: vi.fn(),
    finalizeScheduleImportBatch: vi.fn(),
    loadParentPracticePacket: vi.fn(),
    loadParentSchedule: vi.fn(),
    loadParentScheduleAssignments: vi.fn(),
    loadParentScheduleEventDetail: vi.fn(),
    loadParentScheduleRideOffers: vi.fn(),
    loadStaffPracticeAttendance: vi.fn(),
    markParentPracticePacketComplete: vi.fn(),
    requestParentScheduleRideSpot: vi.fn(),
    releaseParentScheduleAssignmentClaim: vi.fn(),
    setParentScheduleRideOfferStatus: vi.fn(),
    saveStaffPracticeAttendance: vi.fn(),
    submitParentScheduleRsvp: vi.fn(),
    submitParentScheduleRsvpForChildren: vi.fn(),
    summarizeParentScheduleRideOffers: vi.fn()
}));

const teamMocks = vi.hoisted(() => ({
    applyRosterImportPlanForApp: vi.fn(),
    createRosterParentInviteForApp: vi.fn(),
    loadParentTeamDetail: vi.fn(),
    loadTeamRosterParentInvites: vi.fn(),
    loadTeamStaffPermissions: vi.fn(),
    loadTeamTrackingAdmin: vi.fn(),
    loadRosterImportContextForApp: vi.fn(),
    retryRosterParentInviteEmailForApp: vi.fn()
}));

const rosterAiMocks = vi.hoisted(() => ({
    buildRosterAiImportCommitPlan: vi.fn(),
    extractPastedRosterCsv: vi.fn(),
    generateRosterAiImportRows: vi.fn(),
    normalizeRosterAiImportResponse: vi.fn()
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
    GoogleAIBackend: aiMocks.GoogleAIBackend,
    Schema: aiMocks.Schema
}));
vi.mock('../../apps/app/src/lib/chatService.ts', () => chatMocks);
vi.mock('../../apps/app/src/lib/homeService.ts', () => homeMocks);
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);
vi.mock('../../apps/app/src/lib/teamDetailService.ts', () => teamMocks);
vi.mock('../../apps/app/src/lib/rosterAiImport.ts', () => rosterAiMocks);
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

function rosterPreviewRow(overrides = {}) {
    const operation = overrides.operation || {
        type: 'update',
        playerId: 'player-1',
        payload: { name: 'Avery', number: '10' },
        errors: []
    };
    return {
        rowNumber: 1,
        action: 'update',
        playerId: 'player-1',
        name: 'Avery',
        number: '10',
        reason: '',
        fields: [
            { key: 'name', label: 'Name', type: 'text', value: 'Avery' },
            { key: 'number', label: 'Jersey Number', type: 'text', value: '10' }
        ],
        contacts: [],
        inviteCount: 0,
        duplicatePlayerId: '',
        duplicatePlayerName: '',
        errors: [],
        operation,
        ...overrides
    };
}

async function executeConfirmedToolForTest(user, call, context = {}) {
    const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');
    const staged = await runPrivateAiTool(user, call, context);
    if (!staged.requiresConfirmation || !staged.confirmationId) return staged;
    const confirmed = await generatePrivateAiAnswer(
        user,
        `confirm ${staged.confirmationId}`,
        [],
        { conversationId: context.conversationId }
    );
    return confirmed.toolResults[0];
}

function mockTeamScopedPendingActionPersistence({
    confirmationId,
    teamId = 'team-1',
    args,
    conversationId = 'default',
    summary = 'Roster import'
}) {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const userData = {
        status: 'pending',
        userId: 'user-1',
        toolName: 'apply_roster_import',
        args: { teamId, operationSummary: { total: args.operations?.length || 0 } },
        payloadScope: 'team',
        teamId,
        conversationId,
        summary,
        expiresAt
    };
    const teamData = {
        status: 'pending',
        userId: 'user-1',
        toolName: 'apply_roster_import',
        teamId,
        args,
        expiresAt
    };
    const snapshotFor = (reference) => {
        const path = reference?.path?.join('/');
        const data = path?.startsWith(`teams/${teamId}/`) ? teamData : userData;
        return { exists: () => true, data: () => data };
    };
    firebaseMocks.getDoc.mockImplementation(async (reference) => snapshotFor(reference));
    const transactionSet = vi.fn();
    firebaseMocks.runTransaction.mockImplementation((db, callback) => callback({
        get: vi.fn(async (reference) => snapshotFor(reference)),
        set: transactionSet
    }));
    return transactionSet;
}

beforeEach(async () => {
    vi.clearAllMocks();
    firebaseMocks.runTransaction.mockImplementation((db, callback) => {
        const transactionSet = vi.fn();
        return callback({
            get: vi.fn(async (reference) => {
                const targetPath = reference?.path?.join('/');
                const pendingWrite = [...firebaseMocks.setDoc.mock.calls]
                    .reverse()
                    .find((call) => call[0]?.path?.join('/') === targetPath && call[1]?.status === 'pending');
                const data = pendingWrite?.[1] || {
                    status: 'pending',
                    userId: 'user-1',
                    expiresAt: new Date(Date.now() + 60_000).toISOString()
                };
                return {
                    exists: () => true,
                    data: () => data
                };
            }),
            set: transactionSet
        });
    });
    aiMocks.model.generateContent.mockReset();
    rosterAiMocks.buildRosterAiImportCommitPlan.mockImplementation((rows = []) => ({
        operations: rows.map((row) => row.operation),
        addPlayers: [],
        skippedRows: []
    }));
    rosterAiMocks.extractPastedRosterCsv.mockReturnValue('');
    rosterAiMocks.generateRosterAiImportRows.mockResolvedValue({
        rows: [],
        errors: [],
        source: 'ai-text'
    });
    rosterAiMocks.normalizeRosterAiImportResponse.mockReturnValue({ rows: [], errors: [] });
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
    scheduleMocks.createScheduleImportGame.mockResolvedValue('game-imported');
    scheduleMocks.createScheduleImportPractice.mockResolvedValue('practice-imported');
    scheduleMocks.finalizeScheduleImportBatch.mockResolvedValue();
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
    scheduleMocks.loadStaffPracticeAttendance.mockResolvedValue({
        sessionId: 'practice-session-1',
        teamId: 'team-1',
        eventId: 'practice-1',
        rosterSize: 1,
        checkedInCount: 0,
        players: [{
            playerId: 'player-1',
            displayName: 'Avery',
            playerNumber: '9',
            status: 'not_marked',
            checkedInAt: null,
            note: null
        }]
    });
    scheduleMocks.saveStaffPracticeAttendance.mockImplementation(async (event, user, attendance) => attendance);
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
    teamMocks.loadRosterImportContextForApp.mockResolvedValue({
        fields: [],
        players: [{ id: 'player-1', name: 'Avery', number: '9', active: true }]
    });
    teamMocks.applyRosterImportPlanForApp.mockResolvedValue({
        savedOperations: [],
        deactivatedCount: 0,
        reactivatedCount: 0,
        invitationSummary: {
            linked: 0,
            emailed: 0,
            retryable: 0,
            failed: 0,
            retryableRecipients: [],
            failedRecipients: []
        },
        inviteResults: []
    });
    teamMocks.loadTeamStaffPermissions.mockResolvedValue({ members: [] });
    teamMocks.loadTeamTrackingAdmin.mockResolvedValue([]);
    teamMocks.loadTeamRosterParentInvites.mockResolvedValue([]);
    teamMocks.createRosterParentInviteForApp.mockResolvedValue({
        code: 'ABCD1234',
        inviteUrl: 'https://allplays.ai/app/#/accept-invite?code=ABCD1234',
        status: 'pending',
        email: 'parent@example.com',
        emailQueued: true,
        emailDeduplicated: false,
        emailSent: true,
        emailError: null,
        existingUser: false,
        autoLinked: false,
        teamName: 'Bears',
        playerName: 'Avery'
    });
    teamMocks.retryRosterParentInviteEmailForApp.mockResolvedValue({
        code: 'ABCD1234',
        email: 'parent@example.com',
        emailQueued: true,
        emailDeduplicated: false,
        teamName: 'Bears',
        playerName: 'Avery'
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

    it('restores attachment receipts and editable roster preview rows from saved chats', async () => {
        const previewRow = rosterPreviewRow({
            errors: ['Row 1: no matching existing player was found.']
        });
        firebaseMocks.getDocs.mockResolvedValueOnce({
            docs: [{
                id: 'msg-roster-error',
                data: () => ({
                    role: 'assistant',
                    text: 'This roster needs review.',
                    conversationId: 'conversation-roster',
                    clientCreatedAt: '2026-05-21T12:01:00Z',
                    attachment: {
                        name: 'players.csv',
                        kind: 'csv',
                        mimeType: 'text/csv'
                    },
                    artifacts: [{
                        type: 'roster-import',
                        confirmationId: 'ai_roster_1',
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
                        previewRows: [previewRow]
                    }]
                })
            }]
        });

        const { loadPrivateAiMessages } = await import('../../apps/app/src/lib/privateAiService.ts');
        const messages = await loadPrivateAiMessages(authUser, undefined, 'conversation-roster');

        expect(messages[0]).toMatchObject({
            attachment: {
                name: 'players.csv',
                kind: 'csv',
                mimeType: 'text/csv'
            },
            artifacts: [{
                type: 'roster-import',
                previewRows: [{
                    rowNumber: 1,
                    name: 'Avery',
                    errors: ['Row 1: no matching existing player was found.']
                }]
            }]
        });
    });

    it('restores normalized schedule preview rows without retaining raw CSV row data', async () => {
        firebaseMocks.getDocs.mockResolvedValueOnce({
            docs: [{
                id: 'msg-schedule-preview',
                data: () => ({
                    role: 'assistant',
                    text: 'This schedule is ready to review.',
                    conversationId: 'conversation-schedule',
                    clientCreatedAt: '2026-05-21T12:01:00Z',
                    artifacts: [{
                        type: 'schedule-import',
                        confirmationId: 'ai_schedule_1',
                        teamId: 'team-1',
                        teamName: 'Bears',
                        source: 'csv',
                        summary: {
                            total: 1,
                            games: 1,
                            practices: 0,
                            errors: 0
                        },
                        previewRows: [{
                            rowNumber: 1,
                            draft: { rawOpponentColumn: 'Rockets' },
                            normalized: {
                                rowNumber: 1,
                                eventType: 'game',
                                startsAt: '2026-07-30T18:00:00.000Z',
                                endsAt: null,
                                opponent: 'Rockets',
                                title: null,
                                location: 'Field 1',
                                arrivalTime: null,
                                isHome: true,
                                notes: 'Wear white'
                            },
                            errors: []
                        }]
                    }]
                })
            }]
        });

        const { loadPrivateAiMessages } = await import('../../apps/app/src/lib/privateAiService.ts');
        const messages = await loadPrivateAiMessages(authUser, undefined, 'conversation-schedule');

        expect(messages[0].artifacts[0]).toMatchObject({
            type: 'schedule-import',
            previewRows: [{
                rowNumber: 1,
                draft: {},
                normalized: {
                    eventType: 'game',
                    opponent: 'Rockets',
                    isHome: true
                }
            }]
        });
        expect(messages[0].artifacts[0].previewRows[0].draft).toEqual({});
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

    it('recovers legacy default history alongside stored and message-backed conversations', async () => {
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
                id: 'default',
                title: 'What did I miss?',
                lastMessagePreview: 'Legacy answer'
            }),
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
        expect(conversations.filter((conversation) => conversation.id === 'conversation-1')).toHaveLength(1);
    });

    it('paginates recovery when the newest 80 messages all belong to one conversation', async () => {
        const newestConversationDocuments = Array.from({ length: 80 }, (_, index) => ({
            id: `newest-${index}`,
            data: () => ({
                role: index % 2 ? 'assistant' : 'user',
                text: `Newest message ${index}`,
                conversationId: `conversation-${index % 30}`,
                clientCreatedAt: new Date(Date.UTC(2026, 5, 30, 12, 0, 80 - index)).toISOString()
            })
        }));
        const legacyCursorDocument = {
            id: 'legacy-question',
            data: () => ({
                role: 'user',
                text: 'Older legacy question',
                clientCreatedAt: '2026-05-20T12:00:00Z'
            })
        };
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: newestConversationDocuments })
            .mockResolvedValueOnce({ docs: [legacyCursorDocument] });

        const { loadPrivateAiConversations } = await import('../../apps/app/src/lib/privateAiService.ts');
        const conversations = await loadPrivateAiConversations(authUser, 2);

        expect(conversations.map((conversation) => conversation.id)).toContain('default');
        expect(conversations.find((conversation) => conversation.id === 'default')).toMatchObject({ title: 'Older legacy question' });
        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(3);
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(newestConversationDocuments[79]);
    });

    it('paginates message loading when the selected conversation is older than the newest 80 messages', async () => {
        const newestConversationDocuments = Array.from({ length: 80 }, (_, index) => ({
            id: `newest-${index}`,
            data: () => ({
                role: index % 2 ? 'assistant' : 'user',
                text: `Newest message ${index}`,
                conversationId: 'conversation-newest',
                clientCreatedAt: new Date(Date.UTC(2026, 5, 30, 12, 0, 80 - index)).toISOString()
            })
        }));
        const olderConversationDocuments = [
            {
                id: 'older-answer',
                data: () => ({
                    role: 'assistant',
                    text: 'Older answer',
                    conversationId: 'conversation-older',
                    clientCreatedAt: '2026-05-20T12:01:00Z'
                })
            },
            {
                id: 'older-question',
                data: () => ({
                    role: 'user',
                    text: 'Older question',
                    conversationId: 'conversation-older',
                    clientCreatedAt: '2026-05-20T12:00:00Z'
                })
            }
        ];
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: newestConversationDocuments })
            .mockResolvedValueOnce({ docs: olderConversationDocuments });

        const { loadPrivateAiMessages } = await import('../../apps/app/src/lib/privateAiService.ts');
        const messages = await loadPrivateAiMessages(authUser, undefined, 'conversation-older');

        expect(messages.map((message) => message.id)).toEqual(['older-question', 'older-answer']);
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(newestConversationDocuments[79]);
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

    it('stores exact pending-action references on the assistant proposal message', async () => {
        aiMocks.model.generateContent
            .mockResolvedValueOnce(modelText(JSON.stringify({
                toolCalls: [{
                    name: 'update_rsvp',
                    args: {
                        teamId: 'team-1',
                        eventId: 'game-1',
                        playerId: 'player-1',
                        response: 'going'
                    }
                }]
            })))
            .mockResolvedValueOnce(modelText(JSON.stringify({
                answer: 'I staged the RSVP change. Reply yes to confirm this change.'
            })));

        const { sendPrivateAiMessage } = await import('../../apps/app/src/lib/privateAiService.ts');
        const result = await sendPrivateAiMessage(authUser, 'Mark Avery going');
        const confirmationId = result.toolResults[0].confirmationId;

        expect(confirmationId).toMatch(/^ai_/);
        expect(firebaseMocks.addDoc.mock.calls[1][1]).toMatchObject({
            role: 'assistant',
            pendingActionIds: [confirmationId]
        });
        expect(result.assistantMessage.pendingActionIds).toEqual([confirmationId]);
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
        expect(teamMocks.loadParentTeamDetail).toHaveBeenCalledWith('team-1', authUser);

        await expect(runPrivateAiTool(authUser, { name: 'get_team_detail', args: { teamName: 'bear' } })).resolves.toMatchObject({
            ok: true,
            data: expect.objectContaining({
                team: expect.objectContaining({ id: 'team-1', name: 'Bears' })
            })
        });
        expect(teamMocks.loadParentTeamDetail).toHaveBeenCalledWith('team-1', authUser);
    });

    it('fails closed instead of inferring a team when any accessible-team read fails', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1', 'team-2'],
            parentPlayerKeys: []
        };
        homeMocks.loadParentHome.mockResolvedValue({
            teams: [
                { teamId: 'team-1', teamName: 'Bears', players: [] },
                { teamId: 'team-2', teamName: 'Vipers', players: [] }
            ],
            players: []
        });
        teamMocks.loadParentTeamDetail.mockImplementation(async (teamId) => {
            if (teamId === 'team-2') throw new Error('Vipers lookup failed');
            return {
                team: { id: 'team-1', name: 'Bears' },
                players: [],
                inactivePlayers: [],
                canManageTeam: true
            };
        });
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(coachUser, {
            name: 'update_team_settings',
            args: { settings: { name: 'Wrong Team' } }
        })).resolves.toMatchObject({
            ok: false,
            error: 'Vipers lookup failed'
        });
    });

    it('reports home and team-management read failures instead of presenting empty complete data', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        homeMocks.loadParentHome.mockRejectedValueOnce(new Error('Home unavailable'));
        await expect(runPrivateAiTool(coachUser, { name: 'get_home' })).resolves.toMatchObject({
            ok: false,
            error: 'Home unavailable'
        });

        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [] });
        teamMocks.loadTeamStaffPermissions.mockRejectedValueOnce(new Error('Staff unavailable'));
        await expect(runPrivateAiTool(coachUser, {
            name: 'get_team_management_overview',
            args: { teamId: 'team-1' }
        })).resolves.toMatchObject({
            ok: false,
            error: 'Staff unavailable'
        });
    });

    it('combines coach-managed teams with family access in the same tool registry', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        homeMocks.loadParentHome.mockResolvedValueOnce({ teams: [], players: [], actionItems: [], upcomingEvents: [], fees: [] });
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        await expect(runPrivateAiTool(coachUser, { name: 'list_managed_teams' })).resolves.toMatchObject({
            ok: true,
            data: {
                teams: [expect.objectContaining({ teamId: 'team-1', teamName: 'Bears', canManageTeam: true })]
            }
        });
        await expect(runPrivateAiTool(coachUser, { name: 'get_team_roster', args: { teamId: 'team-1' } })).resolves.toMatchObject({
            ok: true,
            data: {
                teamId: 'team-1',
                players: [expect.objectContaining({ id: 'player-1', name: 'Avery' })]
            }
        });
    });

    it('exposes manager tool domains to coach/admin prompts but not family-only prompts', async () => {
        aiMocks.model.generateContent.mockResolvedValue(modelText(JSON.stringify({ answer: 'Ready.' })));
        const { generatePrivateAiAnswer } = await import('../../apps/app/src/lib/privateAiService.ts');

        await generatePrivateAiAnswer(authUser, 'What can you help me with?');
        const familyPrompt = aiMocks.model.generateContent.mock.calls[0][0];
        expect(familyPrompt).not.toContain('list_managed_teams');
        expect(familyPrompt).not.toContain('apply_roster_import');
        expect(familyPrompt).not.toContain('apply_schedule_import');

        aiMocks.model.generateContent.mockClear();
        const coachUser = {
            ...authUser,
            roles: ['parent', 'coach'],
            coachOf: ['team-1']
        };
        await generatePrivateAiAnswer(coachUser, 'What can you help me with?');
        const combinedRolePrompt = aiMocks.model.generateContent.mock.calls[0][0];
        expect(combinedRolePrompt).toContain('list_managed_teams');
        expect(combinedRolePrompt).toContain('apply_roster_import');
        expect(combinedRolePrompt).toContain('apply_schedule_import');
        expect(combinedRolePrompt).toContain('get_player_stats');

        aiMocks.model.generateContent.mockClear();
        const platformAdminUser = {
            ...authUser,
            roles: ['platformAdmin'],
            coachOf: [],
            isPlatformAdmin: true
        };
        await generatePrivateAiAnswer(platformAdminUser, 'What can you help me with?');
        const platformAdminPrompt = aiMocks.model.generateContent.mock.calls[0][0];
        expect(platformAdminPrompt).toContain('list_managed_teams');
        expect(platformAdminPrompt).toContain('apply_roster_import');
        expect(platformAdminPrompt).toContain('apply_schedule_import');
    });

    it('validates supported AI chat files and infers roster, schedule, or general analysis intent', async () => {
        const {
            getPrivateAiAttachmentValidationError,
            inferPrivateAiAttachmentIntent,
            maxPrivateAiAttachmentBytes
        } = await import('../../apps/app/src/lib/privateAiService.ts');

        expect(getPrivateAiAttachmentValidationError(
            new File(['pdf'], 'team-handbook.pdf', { type: 'application/pdf' })
        )).toBe('');
        expect(getPrivateAiAttachmentValidationError(
            new File(['notes'], 'notes.txt', { type: 'text/plain' })
        )).toContain('Attach a CSV, PDF');
        expect(getPrivateAiAttachmentValidationError({
            name: 'oversized.pdf',
            type: 'application/pdf',
            size: maxPrivateAiAttachmentBytes + 1
        })).toContain('10 MB');

        expect(inferPrivateAiAttachmentIntent({
            fileName: 'players.csv',
            csvText: 'Player Name,Jersey Number,Parent Email\nAvery,9,parent@example.com'
        })).toBe('roster-import');
        expect(inferPrivateAiAttachmentIntent({
            fileName: 'spring.csv',
            csvText: 'Event Type,Date,Opponent,Location\ngame,2026-07-30,Rockets,Field 1'
        })).toBe('schedule-import');
        expect(inferPrivateAiAttachmentIntent({
            text: 'Summarize the action items.',
            fileName: 'team-handbook.pdf'
        })).toBe('general-analysis');
    });

    it('routes a natural coach roster update to the roster review instead of generic chat JSON', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        const prompt = "For Bears, update only Avery's jersey number from 9 to 10. Keep everything else unchanged.";
        const previewRow = rosterPreviewRow();
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [], actionItems: [], upcomingEvents: [], fees: [] });
        rosterAiMocks.generateRosterAiImportRows.mockResolvedValue({
            rows: [previewRow],
            errors: [],
            source: 'ai-text'
        });

        const { sendPrivateAiMessage } = await import('../../apps/app/src/lib/privateAiService.ts');
        const result = await sendPrivateAiMessage(
            coachUser,
            prompt,
            'roster-chat',
            { teamId: 'team-1', teamName: 'Bears' }
        );

        expect(rosterAiMocks.generateRosterAiImportRows).toHaveBeenCalledWith({
            text: prompt,
            csvText: undefined,
            imageFile: undefined,
            currentPlayers: [{ id: 'player-1', name: 'Avery', number: '9', active: true }],
            rosterFields: []
        });
        expect(aiMocks.model.generateContent).not.toHaveBeenCalled();
        expect(result.assistantMessage.text).toContain('Reply yes to import these players');
        expect(result.assistantMessage.artifacts).toEqual([
            expect.objectContaining({
                type: 'roster-import',
                teamId: 'team-1',
                teamName: 'Bears',
                source: 'ai-text',
                previewRows: [previewRow]
            })
        ]);
        expect(result.toolResults).toEqual([
            expect.objectContaining({
                name: 'apply_roster_import',
                ok: true,
                requiresConfirmation: true
            })
        ]);
        const storedAssistant = firebaseMocks.addDoc.mock.calls
            .map((call) => call[1])
            .find((payload) => payload.role === 'assistant');
        expect(storedAssistant.artifacts[0]).not.toHaveProperty('previewRows');
        expect(JSON.stringify(storedAssistant.artifacts[0])).not.toContain('Avery');
        expect(JSON.stringify(storedAssistant.artifacts[0])).not.toContain('number');
    });

    it('stores a private attachment receipt without persisting the raw roster file', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        const csvText = 'Player Name,Jersey Number,Parent Email\nAvery,10,parent@example.com';
        const csv = new File([csvText], 'players.csv', { type: 'text/csv' });
        Object.defineProperty(csv, 'text', { value: async () => csvText });
        rosterAiMocks.generateRosterAiImportRows.mockResolvedValue({
            rows: [rosterPreviewRow()],
            errors: [],
            source: 'csv'
        });

        const { sendPrivateAiAttachmentMessage } = await import('../../apps/app/src/lib/privateAiService.ts');
        const result = await sendPrivateAiAttachmentMessage(coachUser, {
            teamId: 'team-1',
            text: 'Update the Bears roster.',
            file: csv
        }, 'roster-chat');

        expect(result.userMessage).toMatchObject({
            text: 'Review pasted roster CSV data for import.',
            attachment: {
                name: 'players.csv',
                kind: 'csv',
                mimeType: 'text/csv'
            }
        });
        const storedUser = firebaseMocks.addDoc.mock.calls
            .map((call) => call[1])
            .find((payload) => payload.role === 'user');
        expect(storedUser).toMatchObject({
            text: 'Review pasted roster CSV data for import.',
            attachment: {
                name: 'players.csv',
                kind: 'csv',
                mimeType: 'text/csv'
            }
        });
        expect(storedUser).not.toHaveProperty('file');
    });

    it('preserves line breaks and routes prose followed by CSV to a CSV roster artifact', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        const csvText = 'Name,Number\nAvery,11';
        const prompt = `For Bears, update this roster:\n\n${csvText}\n\nKeep omitted fields unchanged.`;
        const previewRow = rosterPreviewRow({
            number: '11',
            fields: [
                { key: 'name', label: 'Name', type: 'text', value: 'Avery' },
                { key: 'number', label: 'Jersey Number', type: 'text', value: '11' }
            ],
            operation: {
                type: 'update',
                playerId: 'player-1',
                payload: { name: 'Avery', number: '11' },
                errors: []
            }
        });
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [], actionItems: [], upcomingEvents: [], fees: [] });
        rosterAiMocks.extractPastedRosterCsv.mockImplementation((value) => value === prompt ? csvText : '');
        rosterAiMocks.generateRosterAiImportRows.mockResolvedValue({
            rows: [previewRow],
            errors: [],
            source: 'csv'
        });

        const { sendPrivateAiMessage } = await import('../../apps/app/src/lib/privateAiService.ts');
        const result = await sendPrivateAiMessage(
            coachUser,
            prompt,
            'roster-chat',
            { teamId: 'team-1', teamName: 'Bears' }
        );

        expect(rosterAiMocks.generateRosterAiImportRows).toHaveBeenCalledWith(expect.objectContaining({
            text: prompt,
            csvText
        }));
        expect(rosterAiMocks.extractPastedRosterCsv).toHaveBeenCalledWith(prompt);
        expect(aiMocks.model.generateContent).not.toHaveBeenCalled();
        expect(result.assistantMessage.artifacts?.[0]).toMatchObject({
            type: 'roster-import',
            teamId: 'team-1',
            source: 'csv',
            previewRows: [previewRow]
        });
    });

    it('extracts a pasted roster CSV before truncating the generic chat prompt', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        const csvText = [
            'Name,Number,Parent Email',
            ...Array.from({ length: 120 }, (_, index) => (
                `Player ${String(index + 1).padStart(3, '0')},${index + 1},parent${index + 1}@example.com`
            ))
        ].join('\n');
        const prompt = `For Bears, import this complete roster:\n${csvText}`;
        const previewRow = rosterPreviewRow();
        expect(prompt.length).toBeGreaterThan(1800);
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [], actionItems: [], upcomingEvents: [], fees: [] });
        rosterAiMocks.extractPastedRosterCsv.mockImplementation((value) => value === prompt ? csvText : '');
        rosterAiMocks.generateRosterAiImportRows.mockResolvedValue({
            rows: [previewRow],
            errors: [],
            source: 'csv'
        });

        const { sendPrivateAiMessage } = await import('../../apps/app/src/lib/privateAiService.ts');
        await sendPrivateAiMessage(
            coachUser,
            prompt,
            'roster-chat',
            { teamId: 'team-1', teamName: 'Bears' }
        );

        expect(rosterAiMocks.extractPastedRosterCsv).toHaveBeenCalledWith(prompt);
        expect(rosterAiMocks.generateRosterAiImportRows).toHaveBeenCalledWith(expect.objectContaining({
            csvText
        }));
    });

    it('keeps informational roster questions in generic chat instead of staging an import', async () => {
        aiMocks.model.generateContent.mockResolvedValueOnce(modelText(JSON.stringify({
            answer: 'Parents can manage linked players but cannot change a team roster.'
        })));

        const { sendPrivateAiMessage } = await import('../../apps/app/src/lib/privateAiService.ts');
        const result = await sendPrivateAiMessage(authUser, 'Can parents add players?');

        expect(rosterAiMocks.generateRosterAiImportRows).not.toHaveBeenCalled();
        expect(aiMocks.model.generateContent).toHaveBeenCalledTimes(1);
        expect(result.assistantMessage.text).toBe('Parents can manage linked players but cannot change a team roster.');
        expect(result.assistantMessage.artifacts).toEqual([]);
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
        await executeConfirmedToolForTest(authUser, { name: 'send_team_message', args: { teamId: 'team-1', text: 'See you at practice' } });
        await executeConfirmedToolForTest(authUser, { name: 'claim_assignment', args: { eventId: 'game-1', teamId: 'team-1', role: 'Snacks' } });
        await executeConfirmedToolForTest(authUser, { name: 'release_assignment', args: { eventId: 'game-1', teamId: 'team-1', role: 'Snacks' } });
        const packetResult = await executeConfirmedToolForTest(authUser, { name: 'mark_practice_packet_complete', args: { eventId: 'practice-1', teamId: 'team-1' } });
        await executeConfirmedToolForTest(authUser, { name: 'submit_access_request', args: { teamId: 'team-1', playerId: 'player-1', relation: 'Parent' } });
        await executeConfirmedToolForTest(authUser, { name: 'revoke_family_share_link', args: { tokenId: 'share-1' } });
        await executeConfirmedToolForTest(authUser, { name: 'update_family_share_calendars', args: { tokenId: 'share-1', extraCalendarUrls: ['https://calendar.example/feed.ics'] } });

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
        await expect(executeConfirmedToolForTest(authUser, { name: 'revoke_family_share_link', args: {} })).resolves.toMatchObject({
            ok: false,
            error: 'tokenId is required for family share changes.'
        });
        await expect(executeConfirmedToolForTest(authUser, {
            name: 'mark_practice_packet_complete',
            args: { eventId: 'practice-1', teamId: 'team-1', playerName: 'Missing Child' }
        })).resolves.toMatchObject({
            ok: false,
            error: 'No matching child was found for this practice packet.'
        });
        expect(toolsMocks.revokeParentFamilyShare).not.toHaveBeenCalled();
        expect(scheduleMocks.markParentPracticePacketComplete).not.toHaveBeenCalled();
    });

    it('executes confirmed AI player incentive writes', async () => {
        await executeConfirmedToolForTest(authUser, { name: 'save_player_incentive_rule', args: { teamId: 'team-1', playerId: 'player-1', statKey: 'goals', amount: 2 } });
        await executeConfirmedToolForTest(authUser, { name: 'set_player_incentive_cap', args: { teamId: 'team-1', playerId: 'player-1', maxPerGameAmount: 5 } });
        await executeConfirmedToolForTest(authUser, { name: 'mark_player_incentive_paid', args: { teamId: 'team-1', playerId: 'player-1', gameId: 'game-1', amount: 4 } });

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

    it('ignores planner-supplied confirmation flags and still stages writes', async () => {
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        const result = await runPrivateAiTool(authUser, {
            name: 'update_rsvp',
            args: {
                teamId: 'team-1',
                eventId: 'game-1',
                playerId: 'player-1',
                response: 'going',
                __confirmed: true
            }
        });

        expect(result).toMatchObject({
            ok: true,
            requiresConfirmation: true,
            confirmationId: expect.stringMatching(/^ai_/)
        });
        expect(scheduleMocks.submitParentScheduleRsvp).not.toHaveBeenCalled();
        const pendingWrite = firebaseMocks.setDoc.mock.calls.find((call) => (
            call[0]?.path?.includes('privateAiPendingActions')
            && call[1]?.toolName === 'update_rsvp'
        ));
        expect(pendingWrite[1].args).not.toHaveProperty('__confirmed');
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

    it('transactionally executes a pending write only once', async () => {
        const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');
        const staged = await runPrivateAiTool(authUser, {
            name: 'update_rsvp',
            args: { teamId: 'team-1', eventId: 'game-1', playerId: 'player-1', response: 'going' }
        });

        await generatePrivateAiAnswer(authUser, `confirm ${staged.confirmationId}`);
        const repeated = await generatePrivateAiAnswer(authUser, `confirm ${staged.confirmationId}`);

        expect(scheduleMocks.submitParentScheduleRsvp).toHaveBeenCalledTimes(1);
        expect(repeated.answer).toContain('could not complete');
        expect(firebaseMocks.runTransaction).toHaveBeenCalledTimes(1);
    });

    it('transactionally replaces a roster pending payload after in-chat edits', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [], actionItems: [], upcomingEvents: [], fees: [] });
        const transactionSet = vi.fn();
        const {
            generatePrivateAiAnswer,
            revisePrivateAiRosterImportProposal,
            runPrivateAiTool
        } = await import('../../apps/app/src/lib/privateAiService.ts');
        const originalOperation = {
            type: 'add',
            payload: { name: 'Avery' },
            errors: []
        };
        const revisedOperation = {
            type: 'add',
            payload: { name: 'Avery Smith' },
            errors: []
        };
        const staged = await runPrivateAiTool(coachUser, {
            name: 'apply_roster_import',
            args: {
                teamId: 'team-1',
                __preparedRosterOperations: [originalOperation]
            }
        }, { conversationId: 'roster-chat', confirmationGroupId: 'roster-group' });

        mockTeamScopedPendingActionPersistence({
            confirmationId: staged.confirmationId,
            args: { teamId: 'team-1', operations: [originalOperation] },
            conversationId: 'roster-chat'
        });
        firebaseMocks.runTransaction.mockImplementationOnce((db, callback) => callback({
            get: vi.fn(async () => ({
                exists: () => true,
                data: () => ({
                    status: 'pending',
                    userId: 'user-1',
                    toolName: 'apply_roster_import',
                    teamId: 'team-1',
                    args: { teamId: 'team-1' },
                    expiresAt: new Date(Date.now() + 60_000).toISOString()
                })
            })),
            set: transactionSet
        }));
        const summary = await revisePrivateAiRosterImportProposal(coachUser, {
            confirmationId: staged.confirmationId,
            teamId: 'team-1',
            rows: [{
                rowNumber: 1,
                action: 'add',
                playerId: '',
                name: 'Avery Smith',
                number: '',
                reason: '',
                fields: [{ key: 'name', label: 'Name', type: 'text', value: 'Avery Smith' }],
                contacts: [],
                inviteCount: 0,
                duplicatePlayerId: '',
                duplicatePlayerName: '',
                errors: [],
                operation: revisedOperation
            }]
        });

        expect(summary).toMatchObject({ total: 1, add: 1, errors: 0 });
        expect(transactionSet).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ path: ['users', 'user-1', 'privateAiPendingActions', staged.confirmationId] }),
            expect.objectContaining({
                args: {
                    teamId: 'team-1',
                    source: '',
                    operationSummary: expect.objectContaining({ total: 1, add: 1 }),
                    validationErrorCount: 0
                },
                previewSummary: expect.objectContaining({ total: 1, errors: 0 })
            }),
            { merge: true }
        );
        expect(transactionSet).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ path: ['teams', 'team-1', 'privateAiPendingActions', staged.confirmationId] }),
            expect.objectContaining({
                args: {
                    teamId: 'team-1',
                    operations: [revisedOperation]
                }
            }),
            { merge: true }
        );

        mockTeamScopedPendingActionPersistence({
            confirmationId: staged.confirmationId,
            args: { teamId: 'team-1', operations: [revisedOperation] },
            conversationId: 'roster-chat'
        });
        await generatePrivateAiAnswer(coachUser, `confirm ${staged.confirmationId}`, [], { conversationId: 'roster-chat' });
        expect(teamMocks.applyRosterImportPlanForApp).toHaveBeenCalledWith('team-1', coachUser, [revisedOperation]);
    });

    it('stores private roster payloads at team scope and reports invitation delivery outcomes', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [] });
        const operation = {
            type: 'add',
            payload: {
                name: 'Private Player',
                medicalInfo: 'Private medical note'
            },
            privateFamilyContacts: {
                parents: [{ email: 'retry@example.com', relation: 'Parent' }]
            },
            inviteRequests: [
                { email: 'retry@example.com', relation: 'Parent' },
                { email: 'failed@example.com', relation: 'Guardian' }
            ],
            errors: []
        };
        teamMocks.applyRosterImportPlanForApp.mockResolvedValueOnce({
            savedOperations: [{ ...operation, playerId: 'player-private' }],
            deactivatedCount: 0,
            reactivatedCount: 0,
            invitationSummary: {
                linked: 0,
                emailed: 0,
                retryable: 1,
                failed: 1,
                retryableRecipients: ['retry@example.com'],
                failedRecipients: ['failed@example.com']
            },
            inviteResults: [
                { playerId: 'player-private', email: 'retry@example.com', status: 'code-created' },
                { playerId: 'player-private', email: 'failed@example.com', status: 'failed', error: 'Invite failed' }
            ]
        });
        const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        const staged = await runPrivateAiTool(coachUser, {
            name: 'apply_roster_import',
            args: {
                teamId: 'team-1',
                __preparedRosterOperations: [operation]
            }
        }, { conversationId: 'private-roster' });

        const userPendingWrite = firebaseMocks.setDoc.mock.calls.find((call) => (
            call[0]?.path?.join('/') === `users/user-1/privateAiPendingActions/${staged.confirmationId}`
            && call[1]?.toolName === 'apply_roster_import'
        ));
        const teamPendingWrite = firebaseMocks.setDoc.mock.calls.find((call) => (
            call[0]?.path?.join('/') === `teams/team-1/privateAiPendingActions/${staged.confirmationId}`
            && call[1]?.toolName === 'apply_roster_import'
        ));
        expect(userPendingWrite[1]).toMatchObject({
            payloadScope: 'team',
            teamId: 'team-1',
            args: {
                teamId: 'team-1',
                operationSummary: expect.objectContaining({ total: 1, add: 1, invitations: 2 })
            }
        });
        expect(JSON.stringify(userPendingWrite[1])).not.toContain('Private Player');
        expect(JSON.stringify(userPendingWrite[1])).not.toContain('Private medical note');
        expect(JSON.stringify(userPendingWrite[1])).not.toContain('retry@example.com');
        expect(JSON.stringify(teamPendingWrite[1])).toContain('Private medical note');
        expect(JSON.stringify(teamPendingWrite[1])).toContain('retry@example.com');

        mockTeamScopedPendingActionPersistence({
            confirmationId: staged.confirmationId,
            args: { teamId: 'team-1', operations: [operation] },
            conversationId: 'private-roster'
        });
        const confirmed = await generatePrivateAiAnswer(
            coachUser,
            `confirm ${staged.confirmationId}`,
            [],
            { conversationId: 'private-roster' }
        );

        expect(confirmed.answer).toContain('1 operation');
        expect(confirmed.answer).toContain('1 retryable');
        expect(confirmed.answer).toContain('1 failed');
        expect(confirmed.answer).toContain('retry@example.com');
        expect(confirmed.answer).toContain('failed@example.com');
        const auditWrite = firebaseMocks.setDoc.mock.calls.find((call) => call[0]?.path?.includes('privateAiActionAudit'));
        expect(JSON.stringify(auditWrite[1])).not.toContain('Private medical note');
        expect(JSON.stringify(auditWrite[1])).not.toContain('retry@example.com');
        expect(firebaseMocks.setDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['teams', 'team-1', 'privateAiPendingActions', staged.confirmationId] }),
            expect.objectContaining({ args: {}, status: 'completed' }),
            { merge: true }
        );
    });

    it('claims the latest team-scoped roster revision before executing a confirmation', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        const staleOperation = {
            type: 'update',
            playerId: 'player-1',
            payload: { medicalInfo: 'Stale team-scoped note' },
            errors: []
        };
        const latestOperation = {
            type: 'update',
            playerId: 'player-1',
            payload: { medicalInfo: 'Latest team-scoped note' },
            errors: []
        };
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [] });
        const { generatePrivateAiAnswer, resetPrivateAiModel } = await import('../../apps/app/src/lib/privateAiService.ts');
        resetPrivateAiModel();
        firebaseMocks.getDoc.mockImplementation(async (reference) => {
            const path = reference?.path?.join('/');
            if (path === 'users/user-1/privateAiPendingActions/ai_reload1') {
                return {
                    exists: () => true,
                    data: () => ({
                        status: 'pending',
                        userId: 'user-1',
                        toolName: 'apply_roster_import',
                        teamId: 'team-1',
                        args: {
                            teamId: 'team-1',
                            operationSummary: { total: 1, update: 1 }
                        },
                        payloadScope: 'team',
                        teamId: 'team-1',
                        expiresAt: new Date(Date.now() + 60_000).toISOString()
                    })
                };
            }
            if (path === 'teams/team-1/privateAiPendingActions/ai_reload1') {
                return {
                    exists: () => true,
                    data: () => ({
                        status: 'pending',
                        userId: 'user-1',
                        toolName: 'apply_roster_import',
                        teamId: 'team-1',
                        args: { teamId: 'team-1', operations: [staleOperation] }
                    })
                };
            }
            return { exists: () => false, data: () => null };
        });
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        const transactionSet = vi.fn();
        firebaseMocks.runTransaction.mockImplementationOnce((db, callback) => callback({
            get: vi.fn(async (reference) => {
                const path = reference?.path?.join('/');
                if (path === 'users/user-1/privateAiPendingActions/ai_reload1') {
                    return {
                        exists: () => true,
                        data: () => ({
                            status: 'pending',
                            userId: 'user-1',
                            toolName: 'apply_roster_import',
                            payloadScope: 'team',
                            teamId: 'team-1',
                            args: { teamId: 'team-1', operationSummary: { total: 1, update: 1 } },
                            expiresAt
                        })
                    };
                }
                return {
                    exists: () => true,
                    data: () => ({
                        status: 'pending',
                        userId: 'user-1',
                        toolName: 'apply_roster_import',
                        teamId: 'team-1',
                        args: { teamId: 'team-1', operations: [latestOperation] },
                        expiresAt
                    })
                };
            }),
            set: transactionSet
        }));

        const confirmed = await generatePrivateAiAnswer(coachUser, 'confirm ai_reload1');

        expect(teamMocks.applyRosterImportPlanForApp).toHaveBeenCalledWith('team-1', coachUser, [latestOperation]);
        expect(teamMocks.applyRosterImportPlanForApp).not.toHaveBeenCalledWith('team-1', coachUser, [staleOperation]);
        expect(confirmed.toolResults[0]).toMatchObject({ ok: true, confirmationId: 'ai_reload1' });
        expect(firebaseMocks.getDoc).toHaveBeenCalledWith(expect.objectContaining({
            path: ['teams', 'team-1', 'privateAiPendingActions', 'ai_reload1']
        }));
        expect(transactionSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['users', 'user-1', 'privateAiPendingActions', 'ai_reload1'] }),
            expect.objectContaining({ status: 'executing', executionStartedBy: 'user-1' }),
            { merge: true }
        );
        expect(transactionSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['teams', 'team-1', 'privateAiPendingActions', 'ai_reload1'] }),
            expect.objectContaining({ status: 'executing', executionStartedBy: 'user-1' }),
            { merge: true }
        );
    });

    it('previews a grouped schedule import and executes it only once after confirmation', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [], actionItems: [], upcomingEvents: [], fees: [] });
        const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');
        const rows = [
            {
                rowNumber: 1,
                eventType: 'game',
                startsAt: '2026-07-30T18:00:00.000Z',
                endsAt: null,
                title: null,
                opponent: 'Rockets',
                location: 'Field 1',
                site: null,
                arrivalTime: null,
                isHome: true,
                notes: 'Wear white'
            },
            {
                rowNumber: 2,
                eventType: 'practice',
                startsAt: '2026-07-31T18:00:00.000Z',
                endsAt: '2026-07-31T19:30:00.000Z',
                title: 'Team practice',
                opponent: null,
                location: 'Gym',
                site: null,
                arrivalTime: null,
                isHome: null,
                notes: null
            }
        ];

        const staged = await runPrivateAiTool(coachUser, {
            name: 'apply_schedule_import',
            args: {
                teamId: 'team-1',
                source: 'csv',
                __preparedScheduleRows: rows
            }
        }, { conversationId: 'schedule-chat', confirmationGroupId: 'schedule-group' });

        expect(staged).toMatchObject({
            name: 'apply_schedule_import',
            ok: true,
            requiresConfirmation: true,
            data: {
                previewSummary: {
                    total: 2,
                    games: 1,
                    practices: 1
                }
            }
        });
        expect(scheduleMocks.createScheduleImportGame).not.toHaveBeenCalled();
        expect(scheduleMocks.createScheduleImportPractice).not.toHaveBeenCalled();

        const confirmed = await generatePrivateAiAnswer(
            coachUser,
            `confirm ${staged.confirmationId}`,
            [],
            { conversationId: 'schedule-chat' }
        );
        expect(confirmed.answer).toContain('Schedule imported');
        expect(scheduleMocks.createScheduleImportGame).toHaveBeenCalledTimes(1);
        expect(scheduleMocks.createScheduleImportPractice).toHaveBeenCalledTimes(1);
        expect(scheduleMocks.createScheduleImportGame).toHaveBeenCalledWith(
            'team-1',
            expect.objectContaining({
                opponent: 'Rockets',
                importBatch: expect.objectContaining({ rowNumber: 1, totalCount: 2 })
            }),
            coachUser
        );

        const repeated = await generatePrivateAiAnswer(
            coachUser,
            `confirm ${staged.confirmationId}`,
            [],
            { conversationId: 'schedule-chat' }
        );
        expect(repeated.answer).toContain('could not complete');
        expect(scheduleMocks.createScheduleImportGame).toHaveBeenCalledTimes(1);
        expect(scheduleMocks.createScheduleImportPractice).toHaveBeenCalledTimes(1);
    });

    it('reports partial and total schedule-import failures with failed row numbers', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [] });
        const rows = [
            {
                rowNumber: 1,
                eventType: 'game',
                startsAt: '2026-07-30T18:00:00.000Z',
                opponent: 'Rockets'
            },
            {
                rowNumber: 2,
                eventType: 'practice',
                startsAt: '2026-07-31T18:00:00.000Z',
                title: 'Practice'
            }
        ];
        const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        scheduleMocks.createScheduleImportPractice.mockRejectedValueOnce(new Error('Practice save failed'));
        const partial = await runPrivateAiTool(coachUser, {
            name: 'apply_schedule_import',
            args: { teamId: 'team-1', __preparedScheduleRows: rows }
        }, { conversationId: 'partial-schedule' });
        const partialResult = await generatePrivateAiAnswer(
            coachUser,
            `confirm ${partial.confirmationId}`,
            [],
            { conversationId: 'partial-schedule' }
        );

        expect(partialResult.answer).toContain('partially completed');
        expect(partialResult.answer).toContain('1 imported and 1 failed');
        expect(partialResult.answer).toContain('rows 2');
        expect(partialResult.toolResults[0]).toMatchObject({
            ok: true,
            data: {
                importedCount: 1,
                failedCount: 1,
                failures: [{ rowNumber: 2, error: 'Practice save failed' }]
            }
        });

        scheduleMocks.createScheduleImportGame.mockRejectedValueOnce(new Error('Game save failed'));
        scheduleMocks.createScheduleImportPractice.mockRejectedValueOnce(new Error('Practice save failed'));
        const failed = await runPrivateAiTool(coachUser, {
            name: 'apply_schedule_import',
            args: { teamId: 'team-1', __preparedScheduleRows: rows }
        }, { conversationId: 'failed-schedule' });
        const failedResult = await generatePrivateAiAnswer(
            coachUser,
            `confirm ${failed.confirmationId}`,
            [],
            { conversationId: 'failed-schedule' }
        );

        expect(failedResult.answer).toContain('could not complete');
        expect(failedResult.answer).toContain('no rows were saved');
        expect(failedResult.answer).toContain('Failed rows: 1, 2');
        expect(failedResult.toolResults[0]).toMatchObject({ ok: false });
    });

    it('rejects unknown attendance players and ignores AI-supplied session metadata', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [] });
        scheduleMocks.loadParentSchedule.mockResolvedValue({
            children: [],
            events: [futureEvent({
                id: 'practice-1',
                eventKey: 'team-1:practice-1:',
                type: 'practice',
                practiceSessionId: 'practice-session-1',
                childId: '',
                childName: '',
                isTeamAdmin: true
            })]
        });
        const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        const unknown = await runPrivateAiTool(coachUser, {
            name: 'save_practice_attendance',
            args: {
                teamId: 'team-1',
                eventId: 'practice-1',
                attendance: {
                    sessionId: 'forged-session',
                    rosterSize: 999,
                    players: [{ playerId: 'not-on-roster', status: 'present' }]
                }
            }
        }, { conversationId: 'unknown-attendance' });
        const unknownResult = await generatePrivateAiAnswer(
            coachUser,
            `confirm ${unknown.confirmationId}`,
            [],
            { conversationId: 'unknown-attendance' }
        );

        expect(unknownResult.answer).toContain('not on the current practice roster');
        expect(scheduleMocks.saveStaffPracticeAttendance).not.toHaveBeenCalled();

        const corrected = await runPrivateAiTool(coachUser, {
            name: 'save_practice_attendance',
            args: {
                teamId: 'team-1',
                eventId: 'practice-1',
                attendance: {
                    sessionId: 'forged-session',
                    teamId: 'forged-team',
                    eventId: 'forged-event',
                    rosterSize: 999,
                    checkedInCount: 999,
                    players: [{ playerId: 'player-1', status: 'late', note: 'Traffic' }]
                }
            }
        }, { conversationId: 'valid-attendance' });
        const validResult = await generatePrivateAiAnswer(
            coachUser,
            `confirm ${corrected.confirmationId}`,
            [],
            { conversationId: 'valid-attendance' }
        );

        expect(validResult.toolResults[0]).toMatchObject({ ok: true });
        expect(scheduleMocks.saveStaffPracticeAttendance).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'practice-1', teamId: 'team-1' }),
            coachUser,
            expect.objectContaining({
                sessionId: 'practice-session-1',
                teamId: 'team-1',
                eventId: 'practice-1',
                rosterSize: 1,
                checkedInCount: 0,
                players: [expect.objectContaining({
                    playerId: 'player-1',
                    displayName: 'Avery',
                    playerNumber: '9',
                    status: 'late',
                    note: 'Traffic'
                })]
            })
        );
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

    it('does not mistake “confirm this change” for a confirmation code', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1'],
            parentPlayerKeys: []
        };
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [], actionItems: [], upcomingEvents: [], fees: [] });
        const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');
        const staged = await runPrivateAiTool(coachUser, {
            name: 'invite_roster_parent',
            args: {
                playerName: 'Avery',
                email: 'parent@example.com'
            }
        }, { conversationId: 'invite-chat', confirmationGroupId: 'invite-group' });

        const result = await generatePrivateAiAnswer(coachUser, 'yes', [{
            id: 'assistant-1',
            role: 'assistant',
            text: 'I staged the parent invitation. Reply yes to confirm this change.',
            conversationId: 'invite-chat',
            createdAt: new Date()
        }], { conversationId: 'invite-chat' });

        expect(staged).toMatchObject({
            ok: true,
            requiresConfirmation: true,
            data: {
                previewSummary: expect.objectContaining({
                    teamId: 'team-1',
                    teamName: 'Bears',
                    playerName: 'Avery'
                })
            }
        });
        expect(teamMocks.createRosterParentInviteForApp).toHaveBeenCalledWith(
            'team-1',
            coachUser,
            expect.objectContaining({ id: 'player-1', name: 'Avery' }),
            { email: 'parent@example.com', relation: 'Parent' }
        );
        expect(result.answer).toContain('acceptance email queued');
        expect(result.answer).not.toContain('confirmation code');
    });

    it('asks for a team only when a managed-roster player match is ambiguous', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1', 'team-2'],
            parentPlayerKeys: []
        };
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [], actionItems: [], upcomingEvents: [], fees: [] });
        teamMocks.loadParentTeamDetail.mockImplementation(async (teamId) => ({
            team: { id: teamId, name: teamId === 'team-1' ? 'Bears' : 'Vipers' },
            players: [{ id: `player-${teamId}`, name: 'Will Snider', number: '9' }],
            inactivePlayers: [],
            canManageTeam: true
        }));
        const { runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        const result = await runPrivateAiTool(coachUser, {
            name: 'invite_roster_parent',
            args: {
                playerName: 'Will Snider',
                email: 'robin@example.com'
            }
        });

        expect(result).toMatchObject({
            ok: false,
            error: expect.stringContaining('Multiple managed roster players match')
        });
        expect(result.error).toContain('Bears');
        expect(result.error).toContain('Vipers');
        expect(teamMocks.createRosterParentInviteForApp).not.toHaveBeenCalled();
    });

    it('infers the correct managed team from a unique player before staging and emailing a parent invite', async () => {
        const coachUser = {
            ...authUser,
            roles: ['coach'],
            coachOf: ['team-1', 'team-2'],
            parentPlayerKeys: []
        };
        homeMocks.loadParentHome.mockResolvedValue({ teams: [], players: [], actionItems: [], upcomingEvents: [], fees: [] });
        teamMocks.loadParentTeamDetail.mockImplementation(async (teamId) => ({
            team: { id: teamId, name: teamId === 'team-1' ? 'Bears' : 'Vipers' },
            players: teamId === 'team-1'
                ? [{ id: 'player-bear', name: 'Avery Ace', number: '8' }]
                : [{ id: 'player-viper', name: 'Will Snider', number: '9' }],
            inactivePlayers: [],
            canManageTeam: true
        }));
        teamMocks.createRosterParentInviteForApp.mockResolvedValueOnce({
            code: 'VIPER123',
            inviteUrl: 'https://allplays.ai/app/#/accept-invite?code=VIPER123',
            status: 'pending',
            email: 'robin@allplays.ai',
            emailQueued: true,
            emailDeduplicated: false,
            emailSent: true,
            emailError: null,
            existingUser: false,
            autoLinked: false,
            teamName: 'Vipers',
            playerName: 'Will Snider'
        });
        const { generatePrivateAiAnswer, runPrivateAiTool } = await import('../../apps/app/src/lib/privateAiService.ts');

        const staged = await runPrivateAiTool(coachUser, {
            name: 'invite_roster_parent',
            args: {
                playerName: 'Will Snider',
                email: 'robin@allplays.ai'
            }
        }, { conversationId: 'invite-chat', confirmationGroupId: 'invite-group' });

        expect(staged).toMatchObject({
            ok: true,
            requiresConfirmation: true,
            data: {
                previewSummary: expect.objectContaining({
                    teamId: 'team-2',
                    teamName: 'Vipers',
                    playerId: 'player-viper',
                    playerName: 'Will Snider'
                })
            }
        });
        expect(teamMocks.createRosterParentInviteForApp).not.toHaveBeenCalled();

        const confirmed = await generatePrivateAiAnswer(
            coachUser,
            'yes',
            [],
            { conversationId: 'invite-chat' }
        );

        expect(teamMocks.createRosterParentInviteForApp).toHaveBeenCalledWith(
            'team-2',
            coachUser,
            expect.objectContaining({ id: 'player-viper', name: 'Will Snider' }),
            { email: 'robin@allplays.ai', relation: 'Parent' }
        );
        expect(confirmed.answer).toContain('acceptance email queued');
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
        await expect(executeConfirmedToolForTest(authUser, {
            name: 'update_player_profile',
            args: {
                teamId: 'team-1',
                playerId: 'player-1',
                emergencyContactPhone: '555-0199'
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
