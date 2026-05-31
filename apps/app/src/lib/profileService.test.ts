import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    createAccessCode: vi.fn(),
    createAccountMergeRequest: vi.fn(),
    generateAccessCode: vi.fn(() => 'CODE1234'),
    getNotificationPreferencesForTeam: vi.fn(),
    getParentTeams: vi.fn(),
    getUserAccessCodes: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeamsWithAccess: vi.fn(),
    saveNotificationPreferencesForTeam: vi.fn(),
    updateUserProfile: vi.fn(),
    upsertNotificationDeviceToken: vi.fn(),
    uploadUserPhoto: vi.fn()
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/notification-preferences.js', () => ({
    normalizeTeamNotificationPreferences: vi.fn((preferences) => ({
        liveChat: Boolean(preferences?.liveChat),
        liveScore: Boolean(preferences?.liveScore),
        schedule: Boolean(preferences?.schedule)
    }))
}));
vi.mock('../../../../js/firebase-runtime-config.js', () => ({
    resolveImageFirebaseConfig: vi.fn(() => ({ apiKey: 'key', storageBucket: 'bucket' }))
}));
vi.mock('./authService', () => ({
    firebaseAuth: { app: { options: { projectId: 'demo-project' } } },
    getNativeAuthIdToken: vi.fn()
}));
vi.mock('../../../../js/team-visibility.js', () => ({
    isTeamActive: vi.fn(() => true)
}));

import { requestAccountMerge } from './profileService';

describe('requestAccountMerge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('normalizes emails and calls createAccountMergeRequest', async () => {
        dbMocks.createAccountMergeRequest.mockResolvedValue('merge-1');

        await expect(requestAccountMerge('user-1', ' Parent@Example.com ', ' Child@Example.com ')).resolves.toBe('merge-1');

        expect(dbMocks.createAccountMergeRequest).toHaveBeenCalledWith('user-1', {
            primaryEmail: 'parent@example.com',
            secondaryEmail: 'child@example.com'
        });
    });
});
