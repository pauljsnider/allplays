// @vitest-environment jsdom
// Keep app chat draft coverage in tests/unit so the root npm test script runs it in CI.
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
    getTeam: vi.fn(),
    getTeamEmailDrafts: vi.fn(),
    getTeamEmailTemplates: vi.fn(),
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
    uploadChatImage: vi.fn(),
    upsertChatConversation: vi.fn()
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/vendor/firebase-app.js', () => ({ getApp: vi.fn() }));
vi.mock('../../js/vendor/firebase-ai.js', () => ({ getAI: vi.fn(), getGenerativeModel: vi.fn(), GoogleAIBackend: {} }));
vi.mock('../../js/firebase-runtime-config.js', () => ({ resolveImageFirebaseConfig: vi.fn() }));
vi.mock('../../js/team-visibility.js', () => ({ isTeamActive: vi.fn(() => true) }));
vi.mock('../../apps/app/src/lib/authService.ts', () => ({ firebaseAuth: {}, getNativeAuthIdToken: vi.fn() }));
vi.mock('../../apps/app/src/lib/friendMessageService.ts', () => ({
    canMessageAcceptedFriend: vi.fn(),
    sendAuthorizedDirectMessage: vi.fn()
}));

import { loadTeamEmailDrafts, saveTeamEmailDraft } from '../../apps/app/src/lib/chatService.ts';

describe('team email draft helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads normalized draft records ordered by newest updatedAt first', async () => {
        dbMocks.getTeamEmailDrafts.mockResolvedValue([
            {
                id: 'draft-older',
                subject: ' Older subject ',
                body: ' Older body ',
                recipients: [{ key: 'email:older@example.com', email: 'OLDER@example.com', name: ' Older Parent ' }],
                updatedAt: { seconds: 10 }
            },
            {
                id: 'draft-newer',
                subject: ' Newer subject ',
                body: ' Newer body ',
                recipients: [{ key: 'email:newer@example.com', email: 'newer@example.com', name: 'Newer Parent' }],
                updatedAt: { seconds: 20 }
            }
        ]);

        await expect(loadTeamEmailDrafts('team-1')).resolves.toEqual([
            {
                id: 'draft-newer',
                subject: 'Newer subject',
                body: 'Newer body',
                recipientIds: ['email:newer@example.com'],
                recipients: [{ key: 'email:newer@example.com', email: 'newer@example.com', name: 'Newer Parent', detail: null }],
                authorId: null,
                authorEmail: null,
                authorName: null,
                createdAt: undefined,
                updatedAt: { seconds: 20 }
            },
            {
                id: 'draft-older',
                subject: 'Older subject',
                body: 'Older body',
                recipientIds: ['email:older@example.com'],
                recipients: [{ key: 'email:older@example.com', email: 'older@example.com', name: 'Older Parent', detail: null }],
                authorId: null,
                authorEmail: null,
                authorName: null,
                createdAt: undefined,
                updatedAt: { seconds: 10 }
            }
        ]);
        expect(dbMocks.getTeamEmailDrafts).toHaveBeenCalledWith('team-1');
    });

    it('saves trimmed draft fields with recipient ids and recipient payload', async () => {
        dbMocks.saveTeamEmailDraft.mockResolvedValue({
            id: 'draft-1',
            subject: 'Game tomorrow',
            body: 'Bring water.',
            recipientIds: ['email:parent@example.com'],
            recipients: [{ key: 'email:parent@example.com', email: 'parent@example.com', name: 'Pat Parent', detail: 'Guardian for Avery' }],
            createdAt: { seconds: 2 },
            updatedAt: { seconds: 3 }
        });

        await expect(saveTeamEmailDraft({
            teamId: 'team-1',
            subject: ' Game tomorrow ',
            body: ' Bring water. ',
            recipientIds: ['email:parent@example.com'],
            recipientOptions: [{ id: 'email:parent@example.com', name: 'Pat Parent', detail: 'Guardian for Avery', email: 'parent@example.com' }],
            authorId: 'coach-1',
            authorEmail: 'coach@example.com',
            authorName: 'Coach Carter'
        })).resolves.toMatchObject({
            id: 'draft-1',
            subject: 'Game tomorrow',
            body: 'Bring water.',
            recipientIds: ['email:parent@example.com']
        });

        expect(dbMocks.saveTeamEmailDraft).toHaveBeenCalledWith('team-1', {
            subject: 'Game tomorrow',
            body: 'Bring water.',
            recipients: [{ key: 'email:parent@example.com', email: 'parent@example.com', name: 'Pat Parent', detail: 'Guardian for Avery' }],
            recipientIds: ['email:parent@example.com'],
            authorId: 'coach-1',
            authorEmail: 'coach@example.com',
            authorName: 'Coach Carter',
            status: 'draft'
        }, {});
    });

    it('preserves selector recipient ids even when some options do not expose email addresses', async () => {
        dbMocks.saveTeamEmailDraft.mockResolvedValue({
            id: 'draft-2',
            subject: 'Roster update',
            body: 'Please confirm availability.',
            recipientIds: ['player:player-1', 'user:coach-1', 'email:parent@example.com'],
            recipients: [{ key: 'email:parent@example.com', email: 'parent@example.com', name: 'Pat Parent', detail: 'Guardian for Avery' }],
            createdAt: { seconds: 4 },
            updatedAt: { seconds: 5 }
        });

        await expect(saveTeamEmailDraft({
            teamId: 'team-1',
            subject: 'Roster update',
            body: 'Please confirm availability.',
            recipientIds: ['player:player-1', 'user:coach-1', 'email:parent@example.com'],
            recipientOptions: [
                { id: 'player:player-1', name: 'Avery Smith', detail: '#9' },
                { id: 'user:coach-1', name: 'Coach Jamie', detail: 'Staff' },
                { id: 'email:parent@example.com', name: 'Pat Parent', detail: 'Guardian for Avery', email: 'parent@example.com' }
            ]
        })).resolves.toMatchObject({
            id: 'draft-2',
            recipientIds: ['player:player-1', 'user:coach-1', 'email:parent@example.com']
        });

        expect(dbMocks.saveTeamEmailDraft).toHaveBeenCalledWith('team-1', {
            subject: 'Roster update',
            body: 'Please confirm availability.',
            recipients: [{ key: 'email:parent@example.com', email: 'parent@example.com', name: 'Pat Parent', detail: 'Guardian for Avery' }],
            recipientIds: ['player:player-1', 'user:coach-1', 'email:parent@example.com'],
            authorId: null,
            authorEmail: null,
            authorName: null,
            status: 'draft'
        }, {});
    });

    it('rejects missing recipients, subject, or body before saving', async () => {
        const recipientOptions = [{ id: 'email:parent@example.com', name: 'Pat Parent', email: 'parent@example.com' }];

        await expect(saveTeamEmailDraft({ teamId: 'team-1', subject: 'Hello', body: 'Body', recipientIds: [], recipientOptions })).rejects.toThrow('Choose at least one selected member before saving.');
        await expect(saveTeamEmailDraft({ teamId: 'team-1', subject: ' ', body: 'Body', recipientIds: ['email:parent@example.com'], recipientOptions })).rejects.toThrow('Enter a subject before saving.');
        await expect(saveTeamEmailDraft({ teamId: 'team-1', subject: 'Hello', body: ' ', recipientIds: ['email:parent@example.com'], recipientOptions })).rejects.toThrow('Enter a body before saving.');
        expect(dbMocks.saveTeamEmailDraft).not.toHaveBeenCalled();
    });
});
