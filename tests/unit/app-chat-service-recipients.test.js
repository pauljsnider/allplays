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
    getTeam: vi.fn(),
    getUnreadChatCounts: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeamsWithAccess: vi.fn(),
    postChatMessage: vi.fn(),
    subscribeToChatMessages: vi.fn(),
    toggleChatReaction: vi.fn(),
    updateChatLastRead: vi.fn(),
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
            { id: 'team-denied', name: 'Hidden team', sport: 'Soccer' }
        ]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
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
                createdAt: new Date('2026-05-21T12:00:00Z')
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

    it('returns no inbox teams for signed-out users', async () => {
        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(loadChatInbox(null)).resolves.toEqual({ teams: [] });
        expect(dbMocks.getUserProfile).not.toHaveBeenCalled();
        expect(dbMocks.getUserTeamsWithAccess).not.toHaveBeenCalled();
    });

    it('uploads media, creates targeted conversations, and posts complete chat metadata', async () => {
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
});
