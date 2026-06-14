// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    canAccessTeamChat: vi.fn(),
    canModerateChat: vi.fn(),
    deleteChatMessage: vi.fn(),
    deleteUploadedChatAttachments: vi.fn(),
    editChatMessage: vi.fn(),
    getAggregatedStatsForGames: vi.fn(),
    getChatConversations: vi.fn(),
    getChatMessages: vi.fn(),
    getGameEvents: vi.fn(),
    getGames: vi.fn(),
    getParentTeams: vi.fn(),
    getPlayers: vi.fn(),
    getSentTeamEmails: vi.fn(),
    getTeamEmailDrafts: vi.fn(),
    getTeamEmailTemplates: vi.fn(),
    getTeam: vi.fn(),
    getUnreadChatCounts: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeamsWithAccess: vi.fn(),
    postChatMessage: vi.fn(),
    saveTeamEmailDraft: vi.fn(),
    saveTeamEmailTemplate: vi.fn(),
    sendTeamEmail: vi.fn(),
    subscribeToChatMessages: vi.fn(),
    toggleChatReaction: vi.fn(),
    updateChatLastRead: vi.fn(),
    updateChatMuted: vi.fn(),
    clearChatMuted: vi.fn(),
    uploadChatImage: vi.fn(),
    upsertChatConversation: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => false
    }
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/vendor/firebase-app.js', () => ({
    getApp: vi.fn(() => ({}))
}));
vi.mock('../../js/vendor/firebase-ai.js', () => ({
    getAI: vi.fn(),
    getGenerativeModel: vi.fn(),
    GoogleAIBackend: {}
}));
vi.mock('../../js/firebase-runtime-config.js', () => ({
    resolveImageFirebaseConfig: vi.fn(() => ({ storageBucket: 'test-bucket' }))
}));
vi.mock('../../apps/app/src/lib/authService.ts', () => ({
    firebaseAuth: {
        app: {
            options: {
                projectId: 'demo-allplays'
            }
        }
    },
    getNativeAuthIdToken: vi.fn()
}));

beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.canAccessTeamChat.mockImplementation((user, team) => team.id !== 'team-denied');
    dbMocks.canModerateChat.mockImplementation((user, team) => team.id === 'team-coach');
    dbMocks.getUnreadChatCounts.mockResolvedValue({});
    dbMocks.getChatMessages.mockResolvedValue([]);
    dbMocks.sendTeamEmail.mockResolvedValue({ recipientCount: 8, status: 'queued' });
    dbMocks.getSentTeamEmails.mockResolvedValue([]);
});

describe('React app chat recipient service', () => {
    it('hydrates selected member options with profile names and falls back to email', async () => {
        dbMocks.getPlayers.mockResolvedValue([
            {
                id: 'player-1',
                name: 'Avery',
                number: 9,
                parents: [
                    {
                        userId: 'parent-1',
                        email: 'pat@example.com',
                        name: 'pat@example.com'
                    }
                ]
            },
            {
                id: 'player-2',
                name: 'Blake',
                parents: [
                    {
                        email: 'casey@example.com'
                    },
                    {
                        email: 'noname@example.com'
                    }
                ]
            }
        ]);
        dbMocks.getUserProfile.mockResolvedValue({
            fullName: 'Pat Parent',
            email: 'pat@example.com'
        });
        dbMocks.getUserByEmail.mockImplementation(async (email) => (
            email === 'casey@example.com'
                ? { fullName: 'Casey Guardian', email }
                : null
        ));

        const { loadChatRecipientOptions } = await import('../../apps/app/src/lib/chatService.ts');
        const options = await loadChatRecipientOptions('team-1');

        expect(options).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'user:parent-1',
                name: 'Pat Parent',
                detail: 'Guardian for Avery'
            }),
            expect.objectContaining({
                id: 'email:casey@example.com',
                name: 'Casey Guardian',
                detail: 'Guardian for Blake'
            }),
            expect.objectContaining({
                id: 'email:noname@example.com',
                name: 'noname@example.com',
                detail: 'Guardian for Blake'
            })
        ]));
    });

    it('builds the inbox from parent, coach, and admin team access with unread and preview data', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([
            { id: 'team-coach', name: 'Bears', sport: 'Basketball', adminEmails: ['parent@example.com'] },
            { id: 'team-inactive-admin', name: 'Inactive Admin', sport: 'Soccer', adminEmails: ['parent@example.com'], active: false },
            { id: 'team-denied', name: 'Hidden team', sport: 'Soccer' }
        ]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' },
            { id: 'team-inactive-parent', name: 'Inactive Parent', sport: 'Soccer', active: false }
        ]);
        dbMocks.getUnreadChatCounts.mockResolvedValue({
            'team-parent': 2,
            'team-coach': 0
        });
        dbMocks.getChatMessages.mockImplementation(async (teamId) => [
            {
                id: `last-${teamId}`,
                text: teamId === 'team-parent' ? 'Need RSVP' : 'Staff note',
                senderName: teamId === 'team-parent' ? 'Coach Morgan' : 'Director',
                createdAt: new Date(teamId === 'team-parent' ? '2026-05-21T13:00:00Z' : '2026-05-21T12:00:00Z')
            }
        ]);

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent', 'coach']
        });

        expect(dbMocks.getUserTeamsWithAccess).toHaveBeenCalledWith('user-1', 'parent@example.com');
        expect(dbMocks.getParentTeams).toHaveBeenCalledWith('user-1');
        expect(dbMocks.getUnreadChatCounts).toHaveBeenCalledWith('user-1', ['team-coach', 'team-parent']);
        expect(dbMocks.canAccessTeamChat).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'team-inactive-admin' }));
        expect(dbMocks.canAccessTeamChat).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'team-inactive-parent' }));
        expect(dbMocks.canAccessTeamChat).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'user-1',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        }), expect.objectContaining({ id: 'team-denied' }));
        expect(inbox.teams.map((team) => team.id)).toEqual(['team-parent', 'team-coach']);
        expect(inbox.teams[0]).toEqual(expect.objectContaining({
            id: 'team-parent',
            role: 'Parent',
            canModerate: false,
            unreadCount: 2,
            lastMessage: expect.objectContaining({ text: 'Need RSVP' })
        }));
        expect(inbox.teams[1]).toEqual(expect.objectContaining({
            id: 'team-coach',
            role: 'Coach',
            canModerate: true,
            unreadCount: 0,
            lastMessage: expect.objectContaining({ text: 'Staff note' })
        }));
    });

    it('uses only the newest conversation lookup per team when timestamps are usable', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
        ]);
        dbMocks.getChatConversations.mockResolvedValue([
            { id: 'team', type: 'team', name: 'Zebras Team Chat', updatedAt: new Date('2026-05-21T12:00:00Z') },
            { id: 'group_family', type: 'group', name: 'Carpool', lastMessageAt: new Date('2026-05-21T13:00:00Z') },
            { id: 'direct_user-1__coach-1', type: 'direct', name: 'Coach Morgan', participantIds: ['user-1', 'coach-1'], updatedAt: new Date('2026-05-21T14:00:00Z') }
        ]);
        dbMocks.getChatMessages.mockImplementation(async (teamId, options = {}) => {
            if (options.conversationId === 'direct_user-1__coach-1') {
                return [{
                    id: 'direct-last',
                    text: 'Uniform pickup moved to 6.',
                    senderName: 'Coach Morgan',
                    createdAt: new Date('2026-05-21T14:00:00Z')
                }];
            }
            if (options.conversationId === 'group_family') {
                return [{
                    id: 'group-last',
                    text: 'Van leaves at 5:30.',
                    senderName: 'Sam Parent',
                    createdAt: new Date('2026-05-21T13:00:00Z')
                }];
            }
            return [{
                id: 'team-last',
                text: 'Older team announcement.',
                senderName: 'Coach Jamie',
                createdAt: new Date('2026-05-21T12:00:00Z')
            }];
        });

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        });

        expect(dbMocks.getChatMessages).toHaveBeenCalledTimes(1);
        expect(dbMocks.getChatMessages).toHaveBeenCalledWith('team-parent', { limit: 1, conversationId: 'direct_user-1__coach-1' });
        expect(inbox.teams[0].lastMessage).toEqual(expect.objectContaining({
            id: 'direct-last',
            text: 'Uniform pickup moved to 6.'
        }));
    });

    it('falls back to missing conversation timestamps without restoring the full fan-out', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
        ]);
        dbMocks.getChatConversations.mockResolvedValue([
            { id: 'team', type: 'team', name: 'Zebras Team Chat' },
            { id: 'direct_user-1__coach-1', type: 'direct', name: 'Coach Morgan', participantIds: ['user-1', 'coach-1'], updatedAt: new Date('2026-05-21T13:00:00Z') },
            { id: 'group_family', type: 'group', name: 'Carpool', lastMessageAt: new Date('2026-05-21T12:00:00Z') }
        ]);
        dbMocks.getChatMessages.mockImplementation(async (teamId, options = {}) => {
            if (options.conversationId === 'direct_user-1__coach-1') {
                return [{
                    id: 'direct-last',
                    text: 'Uniform pickup moved to 6.',
                    senderName: 'Coach Morgan',
                    createdAt: new Date('2026-05-21T13:00:00Z')
                }];
            }
            if (options.conversationId === 'group_family') {
                return [{
                    id: 'group-last',
                    text: 'Van leaves at 5:30.',
                    senderName: 'Sam Parent',
                    createdAt: new Date('2026-05-21T12:00:00Z')
                }];
            }
            return [{
                id: 'team-last',
                text: 'Older team announcement.',
                senderName: 'Coach Jamie',
                createdAt: new Date('2026-05-21T11:00:00Z')
            }];
        });

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        });

        expect(dbMocks.getChatMessages).toHaveBeenCalledTimes(2);
        expect(dbMocks.getChatMessages).toHaveBeenNthCalledWith(1, 'team-parent', { limit: 1, conversationId: 'direct_user-1__coach-1' });
        expect(dbMocks.getChatMessages).toHaveBeenNthCalledWith(2, 'team-parent', { limit: 1, conversationId: 'team' });
        expect(inbox.teams[0].lastMessage).toEqual(expect.objectContaining({
            id: 'direct-last',
            text: 'Uniform pickup moved to 6.'
        }));
    });

    it('checks older timestamped conversations when the newest conversation has no messages yet', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
        ]);
        dbMocks.getChatConversations.mockResolvedValue([
            { id: 'direct_user-1__coach-1', type: 'direct', name: 'Coach Morgan', participantIds: ['user-1', 'coach-1'], updatedAt: new Date('2026-05-21T14:00:00Z') },
            { id: 'group_family', type: 'group', name: 'Carpool', lastMessageAt: new Date('2026-05-21T13:00:00Z') },
            { id: 'team', type: 'team', name: 'Zebras Team Chat', updatedAt: new Date('2026-05-21T12:00:00Z') }
        ]);
        dbMocks.getChatMessages.mockImplementation(async (teamId, options = {}) => {
            if (options.conversationId === 'direct_user-1__coach-1') {
                return [];
            }
            if (options.conversationId === 'group_family') {
                return [{
                    id: 'group-last',
                    text: 'Van leaves at 5:30.',
                    senderName: 'Sam Parent',
                    createdAt: new Date('2026-05-21T13:00:00Z')
                }];
            }
            return [{
                id: 'team-last',
                text: 'Older team announcement.',
                senderName: 'Coach Jamie',
                createdAt: new Date('2026-05-21T12:00:00Z')
            }];
        });

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        });

        expect(dbMocks.getChatMessages).toHaveBeenCalledTimes(2);
        expect(dbMocks.getChatMessages).toHaveBeenNthCalledWith(1, 'team-parent', { limit: 1, conversationId: 'direct_user-1__coach-1' });
        expect(dbMocks.getChatMessages).toHaveBeenNthCalledWith(2, 'team-parent', { limit: 1, conversationId: 'group_family' });
        expect(inbox.teams[0].lastMessage).toEqual(expect.objectContaining({
            id: 'group-last',
            text: 'Van leaves at 5:30.'
        }));
    });

    it('returns no inbox teams for signed-out users', async () => {
        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(loadChatInbox(null)).resolves.toEqual({ teams: [] });
        expect(dbMocks.getUserProfile).not.toHaveBeenCalled();
        expect(dbMocks.getUserTeamsWithAccess).not.toHaveBeenCalled();
    });

    it('routes selected-member messages into a non-default conversation before posting', async () => {
        const photo = new File(['photo'], 'arrival.jpg', { type: 'image/jpeg' });
        const video = new File(['clip'], 'warmups.mp4', { type: 'video/mp4' });
        const uploadedPhoto = {
            type: 'image',
            url: 'https://cdn.example.test/arrival.jpg',
            path: 'team-photos/arrival.jpg',
            name: 'arrival.jpg',
            mimeType: 'image/jpeg',
            size: photo.size
        };
        const uploadedVideo = {
            type: 'video',
            url: 'https://cdn.example.test/warmups.mp4',
            path: 'team-videos/warmups.mp4',
            name: 'warmups.mp4',
            mimeType: 'video/mp4',
            size: video.size
        };
        dbMocks.uploadChatImage
            .mockResolvedValueOnce(uploadedPhoto)
            .mockResolvedValueOnce(uploadedVideo);
        dbMocks.upsertChatConversation.mockResolvedValue({
            id: 'group-player-coach',
            type: 'group',
            participantIds: ['user-1', 'player:player-1', 'user:coach-1'],
            participantRoles: []
        });
        dbMocks.postChatMessage.mockResolvedValue({ id: 'msg-1' });
        const progress = [];

        const { sendTeamChatMessage } = await import('../../apps/app/src/lib/chatService.ts');
        const result = await sendTeamChatMessage({
            teamId: 'team-1',
            user: {
                uid: 'user-1',
                email: 'parent@example.com',
                displayName: 'Pat Parent'
            },
            profile: {
                fullName: 'Pat Profile',
                photoUrl: 'https://cdn.example.test/pat.jpg'
            },
            text: '@ALL PLAYS summarize this thread',
            files: [photo, video],
            selectedConversation: null,
            selectedConversationId: 'team',
            selectedRecipientTarget: 'individuals',
            selectedRecipientIds: ['user:coach-1', 'player:player-1'],
            onProgress: (stage) => progress.push(stage)
        });

        expect(progress).toEqual(['uploading', 'uploading', 'posting']);
        expect(dbMocks.uploadChatImage).toHaveBeenNthCalledWith(1, 'team-1', photo);
        expect(dbMocks.uploadChatImage).toHaveBeenNthCalledWith(2, 'team-1', video);
        expect(dbMocks.upsertChatConversation).toHaveBeenCalledWith('team-1', expect.objectContaining({
            type: 'group',
            participantIds: ['user-1', 'player:player-1', 'user:coach-1'],
            participantRoles: []
        }));
        expect(dbMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
            text: '@ALL PLAYS summarize this thread',
            senderId: 'user-1',
            senderName: 'Pat Profile',
            senderEmail: 'parent@example.com',
            senderPhotoUrl: 'https://cdn.example.test/pat.jpg',
            attachments: [uploadedPhoto, uploadedVideo],
            conversationId: 'group-player-coach',
            targetType: 'individuals',
            recipientIds: ['player:player-1', 'user:coach-1'],
            targetRole: null
        }));
        expect(result).toEqual({
            conversationId: 'group-player-coach',
            createdConversation: expect.objectContaining({ id: 'group-player-coach' }),
            wantsAi: true
        });
    });

    it('routes staff-only messages into a non-default conversation before posting', async () => {
        dbMocks.upsertChatConversation.mockResolvedValue({
            id: 'staff-conversation',
            type: 'group',
            participantIds: ['coach-1'],
            participantRoles: ['staff']
        });
        dbMocks.postChatMessage.mockResolvedValue({ id: 'msg-staff-1' });

        const { sendTeamChatMessage } = await import('../../apps/app/src/lib/chatService.ts');
        const result = await sendTeamChatMessage({
            teamId: 'team-1',
            user: {
                uid: 'coach-1',
                email: 'coach@example.com',
                displayName: 'Coach Jamie'
            },
            profile: {
                fullName: 'Coach Jamie'
            },
            text: 'Coaches only update',
            files: [],
            selectedConversation: null,
            selectedConversationId: 'team',
            selectedRecipientTarget: 'staff',
            selectedRecipientIds: []
        });

        expect(dbMocks.upsertChatConversation).toHaveBeenCalledWith('team-1', expect.objectContaining({
            type: 'group',
            participantIds: ['coach-1'],
            participantRoles: ['staff'],
            name: 'Staff only'
        }));
        expect(dbMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
            text: 'Coaches only update',
            conversationId: 'staff-conversation',
            targetType: 'staff',
            recipientIds: [],
            targetRole: 'staff'
        }));
        expect(result).toEqual({
            conversationId: 'staff-conversation',
            createdConversation: expect.objectContaining({ id: 'staff-conversation' }),
            wantsAi: false
        });
    });

    it('rejects empty selected-member targeting before falling back to full team', async () => {
        const { sendTeamChatMessage } = await import('../../apps/app/src/lib/chatService.ts');
        await expect(sendTeamChatMessage({
            teamId: 'team-1',
            user: {
                uid: 'user-1',
                email: 'parent@example.com',
                displayName: 'Pat Parent'
            },
            profile: {},
            text: 'Private update',
            files: [],
            selectedConversation: null,
            selectedConversationId: 'team',
            selectedRecipientTarget: 'individuals',
            selectedRecipientIds: []
        })).rejects.toThrow('Choose at least one selected member before sending.');

        expect(dbMocks.postChatMessage).not.toHaveBeenCalled();
        expect(dbMocks.upsertChatConversation).not.toHaveBeenCalled();
    });

    it('sends team email through the backend callable wrapper', async () => {
        const { sendTeamEmailMessage, loadSentTeamEmails } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(sendTeamEmailMessage({
            teamId: 'team-1',
            subject: ' Practice update ',
            body: ' Bring jerseys ',
            targetType: 'individuals',
            recipientIds: ['user:coach-1']
        })).resolves.toEqual({ recipientCount: 8, status: 'queued' });

        expect(dbMocks.sendTeamEmail).toHaveBeenCalledWith('team-1', {
            subject: 'Practice update',
            body: 'Bring jerseys',
            targetType: 'individuals',
            recipientIds: ['user:coach-1']
        });

        await loadSentTeamEmails('team-1', { limit: 10 });
        expect(dbMocks.getSentTeamEmails).toHaveBeenCalledWith('team-1', { limit: 10 });
    });

    it('validates team email subject, body, and selected recipients', async () => {
        const { sendTeamEmailMessage } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(sendTeamEmailMessage({
            teamId: 'team-1',
            subject: '   ',
            body: 'Body',
            targetType: 'full_team'
        })).rejects.toThrow('Subject and message are required.');
        await expect(sendTeamEmailMessage({
            teamId: 'team-1',
            subject: 'Subject',
            body: 'Body',
            targetType: 'individuals',
            recipientIds: []
        })).rejects.toThrow('Choose at least one selected member before sending.');
        expect(dbMocks.sendTeamEmail).not.toHaveBeenCalled();
    });

    describe('loadChatInbox sort order', () => {
        it('puts the team with a newer lastMessage first', async () => {
            dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
            dbMocks.getUserTeamsWithAccess.mockResolvedValue([
                { id: 'team-a', name: 'Alpha', sport: 'Soccer' },
                { id: 'team-b', name: 'Beta', sport: 'Soccer' }
            ]);
            dbMocks.getParentTeams.mockResolvedValue([]);
            dbMocks.getChatMessages.mockImplementation(async (teamId) => [
                {
                    id: `msg-${teamId}`,
                    text: 'hello',
                    senderName: 'Coach',
                    createdAt: new Date(teamId === 'team-b' ? '2026-05-21T14:00:00Z' : '2026-05-21T12:00:00Z')
                }
            ]);

            const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
            const inbox = await loadChatInbox({
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach',
                roles: ['coach']
            });

            expect(inbox.teams.map((t) => t.id)).toEqual(['team-b', 'team-a']);
        });

        it('puts teams with no lastMessage after teams that have messages', async () => {
            dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
            dbMocks.getUserTeamsWithAccess.mockResolvedValue([
                { id: 'team-a', name: 'Alpha', sport: 'Soccer' },
                { id: 'team-b', name: 'Beta', sport: 'Soccer' },
                { id: 'team-c', name: 'Gamma', sport: 'Soccer' }
            ]);
            dbMocks.getParentTeams.mockResolvedValue([]);
            dbMocks.getChatMessages.mockImplementation(async (teamId) => {
                if (teamId === 'team-c') return [];
                return [
                    {
                        id: `msg-${teamId}`,
                        text: 'hello',
                        senderName: 'Coach',
                        createdAt: new Date(teamId === 'team-b' ? '2026-05-21T14:00:00Z' : '2026-05-21T12:00:00Z')
                    }
                ];
            });

            const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
            const inbox = await loadChatInbox({
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach',
                roles: ['coach']
            });

            expect(inbox.teams.map((t) => t.id)).toEqual(['team-b', 'team-a', 'team-c']);
        });

        it('sorts alphabetically when two teams have no messages', async () => {
            dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
            dbMocks.getUserTeamsWithAccess.mockResolvedValue([
                { id: 'team-z', name: 'Zebras', sport: 'Soccer' },
                { id: 'team-a', name: 'Antelopes', sport: 'Soccer' }
            ]);
            dbMocks.getParentTeams.mockResolvedValue([]);
            dbMocks.getChatMessages.mockResolvedValue([]);

            const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
            const inbox = await loadChatInbox({
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach',
                roles: ['coach']
            });

            expect(inbox.teams.map((t) => t.id)).toEqual(['team-a', 'team-z']);
        });
    });

    it('cleans uploaded chat media if the message write fails', async () => {
        const photo = new File(['photo'], 'arrival.jpg', { type: 'image/jpeg' });
        const uploadedPhoto = {
            type: 'image',
            url: 'https://cdn.example.test/arrival.jpg',
            path: 'team-photos/arrival.jpg',
            name: 'arrival.jpg',
            mimeType: 'image/jpeg',
            size: photo.size
        };
        dbMocks.uploadChatImage.mockResolvedValue(uploadedPhoto);
        dbMocks.postChatMessage.mockRejectedValue(new Error('Firestore unavailable'));

        const { sendTeamChatMessage } = await import('../../apps/app/src/lib/chatService.ts');
        await expect(sendTeamChatMessage({
            teamId: 'team-1',
            user: {
                uid: 'user-1',
                email: 'parent@example.com',
                displayName: 'Pat Parent'
            },
            profile: {},
            text: 'Photo only',
            files: [photo],
            selectedConversation: null,
            selectedConversationId: 'team',
            selectedRecipientTarget: 'full_team',
            selectedRecipientIds: []
        })).rejects.toThrow('Firestore unavailable');

        expect(dbMocks.deleteUploadedChatAttachments).toHaveBeenCalledWith([uploadedPhoto]);
    });

    it('muteTeamChat sets mutedAt via updateChatMuted', async () => {
        dbMocks.updateChatMuted.mockResolvedValue(undefined);

        const { muteTeamChat } = await import('../../apps/app/src/lib/chatService.ts');
        await muteTeamChat('user-1', 'team-1');

        expect(dbMocks.updateChatMuted).toHaveBeenCalledWith('user-1', 'team-1');
        expect(dbMocks.clearChatMuted).not.toHaveBeenCalled();
    });

    it('unmuteTeamChat deletes mutedAt via clearChatMuted', async () => {
        dbMocks.clearChatMuted.mockResolvedValue(undefined);

        const { unmuteTeamChat } = await import('../../apps/app/src/lib/chatService.ts');
        await unmuteTeamChat('user-1', 'team-1');

        expect(dbMocks.clearChatMuted).toHaveBeenCalledWith('user-1', 'team-1');
        expect(dbMocks.updateChatMuted).not.toHaveBeenCalled();
    });

    it('rethrows failed web mute writes so callers can roll back optimistic state', async () => {
        dbMocks.updateChatMuted.mockRejectedValueOnce(new Error('offline'));
        dbMocks.clearChatMuted.mockRejectedValueOnce(new Error('permission-denied'));

        const { muteTeamChat, unmuteTeamChat } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(muteTeamChat('user-1', 'team-1')).rejects.toThrow('offline');
        await expect(unmuteTeamChat('user-1', 'team-1')).rejects.toThrow('permission-denied');
    });

    it('loadChatInbox sets isMuted from chatMuted profile field', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [],
            chatMuted: { 'team-parent': new Date('2026-06-01T12:00:00Z') }
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
        ]);
        dbMocks.getUnreadChatCounts.mockResolvedValue({});
        dbMocks.getChatMessages.mockResolvedValue([]);

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        });

        expect(inbox.teams[0]).toEqual(expect.objectContaining({
            id: 'team-parent',
            isMuted: true
        }));
    });
});
