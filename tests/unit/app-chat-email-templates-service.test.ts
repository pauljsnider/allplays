// @vitest-environment jsdom
// Keep app chat template coverage in tests/unit so the root npm test script runs it in CI.
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

import { loadTeamEmailTemplates, saveTeamEmailTemplate } from '../../apps/app/src/lib/chatService.ts';

describe('team email template helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads normalized template records from the legacy store helpers', async () => {
        dbMocks.getTeamEmailTemplates.mockResolvedValue([
            {
                id: 'template-1',
                name: ' Weekly update ',
                subject: ' Practice tonight ',
                body: ' Be there by 6. ',
                authorName: 'Coach',
                updatedAt: { seconds: 1 }
            }
        ]);

        await expect(loadTeamEmailTemplates('team-1')).resolves.toEqual([
            {
                id: 'template-1',
                name: 'Weekly update',
                subject: 'Practice tonight',
                body: 'Be there by 6.',
                authorId: null,
                authorEmail: null,
                authorName: 'Coach',
                createdAt: undefined,
                updatedAt: { seconds: 1 }
            }
        ]);
        expect(dbMocks.getTeamEmailTemplates).toHaveBeenCalledWith('team-1');
    });

    it('validates and saves trimmed template fields through the legacy helper', async () => {
        dbMocks.saveTeamEmailTemplate.mockResolvedValue({
            id: 'template-2',
            name: 'Reminder',
            subject: 'Bring water',
            body: 'Hydrate first.',
            createdAt: { seconds: 2 },
            updatedAt: { seconds: 3 }
        });

        await expect(saveTeamEmailTemplate({
            teamId: 'team-1',
            name: ' Reminder ',
            subject: ' Bring water ',
            body: ' Hydrate first. '
        })).resolves.toMatchObject({
            id: 'template-2',
            name: 'Reminder',
            subject: 'Bring water',
            body: 'Hydrate first.'
        });

        expect(dbMocks.saveTeamEmailTemplate).toHaveBeenCalledWith('team-1', {
            name: 'Reminder',
            subject: 'Bring water',
            body: 'Hydrate first.'
        });
    });

    it('rejects missing template name, subject, or body before saving', async () => {
        await expect(saveTeamEmailTemplate({ teamId: 'team-1', name: ' ', subject: 'Hello', body: 'Body' })).rejects.toThrow('Enter a template name before saving.');
        await expect(saveTeamEmailTemplate({ teamId: 'team-1', name: 'Template', subject: ' ', body: 'Body' })).rejects.toThrow('Enter a subject before saving.');
        await expect(saveTeamEmailTemplate({ teamId: 'team-1', name: 'Template', subject: 'Hello', body: ' ' })).rejects.toThrow('Enter a body before saving.');
        expect(dbMocks.saveTeamEmailTemplate).not.toHaveBeenCalled();
    });
});
