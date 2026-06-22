// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getUserProfile: vi.fn(),
    getUserTeamsWithAccess: vi.fn(),
    getParentTeams: vi.fn(),
    getUserAccessCodes: vi.fn(),
    getUserAccessCodesPage: vi.fn(),
    createAccessCode: vi.fn(),
    generateAccessCode: vi.fn(() => 'CODE1234'),
    updateUserProfile: vi.fn(),
    uploadUserPhoto: vi.fn(),
    createAccountMergeRequest: vi.fn(),
    getNotificationPreferencesForTeam: vi.fn(),
    saveNotificationPreferencesForTeam: vi.fn(),
    upsertNotificationDeviceToken: vi.fn()
}));

const authServiceMocks = vi.hoisted(() => ({
    firebaseAuth: { app: { options: { projectId: 'demo-project' } } },
    getNativeAuthIdToken: vi.fn()
}));

const telemetryMocks = vi.hoisted(() => {
    const timerEnd = vi.fn();
    return {
        timerEnd,
        captureHandledAppError: vi.fn(),
        createAppTimer: vi.fn(() => ({ end: timerEnd }))
    };
});

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/notification-preferences.js', () => ({
    normalizeTeamNotificationPreferences: vi.fn((preferences) => ({
        liveChat: Boolean(preferences?.liveChat),
        liveScore: Boolean(preferences?.liveScore),
        schedule: Boolean(preferences?.schedule)
    }))
}));
vi.mock('../../js/firebase-runtime-config.js', () => ({
    resolveImageFirebaseConfig: vi.fn(() => ({ apiKey: 'key', storageBucket: 'bucket' }))
}));
vi.mock('../../js/team-visibility.js', () => ({
    isTeamActive: vi.fn(() => true)
}));
vi.mock('../../apps/app/src/lib/authService', () => authServiceMocks);
vi.mock('../../apps/app/src/lib/telemetry', () => telemetryMocks);

import { loadProfileDocument } from '../../apps/app/src/lib/profileService';

function readRepoFile(relativePath: string) {
    return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('app service-load telemetry', () => {
    beforeEach(() => {
        Object.values(dbMocks).forEach((mock) => mock.mockReset());
        authServiceMocks.getNativeAuthIdToken.mockReset();
        telemetryMocks.timerEnd.mockClear();
        telemetryMocks.captureHandledAppError.mockClear();
        telemetryMocks.createAppTimer.mockClear();
        telemetryMocks.createAppTimer.mockReturnValue({ end: telemetryMocks.timerEnd });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('records profile load timing when the SDK path succeeds', async () => {
        dbMocks.getUserProfile.mockResolvedValue({ fullName: 'Pat Parent' });

        await expect(loadProfileDocument('user-1')).resolves.toEqual({ fullName: 'Pat Parent' });

        expect(telemetryMocks.createAppTimer).toHaveBeenCalledWith('profile document service load', {
            category: 'service_load',
            service: 'profile',
            operation: 'profile-load'
        });
        expect(telemetryMocks.timerEnd).toHaveBeenCalledWith({
            path: 'sdk',
            userIdPresent: true
        });
        expect(telemetryMocks.captureHandledAppError).not.toHaveBeenCalled();
    });

    it('emits handled telemetry for SDK profile load fallback without raw user IDs', async () => {
        const sdkError = new TypeError('Failed to fetch with Authorization Bearer secret-token');
        dbMocks.getUserProfile.mockRejectedValue(sdkError);
        authServiceMocks.getNativeAuthIdToken.mockResolvedValue('native-token');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                name: 'projects/demo/databases/(default)/documents/users/user-1',
                fields: {
                    fullName: { stringValue: 'Native Pat' }
                }
            })
        }));

        await expect(loadProfileDocument('user-1')).resolves.toEqual({
            id: 'user-1',
            fullName: 'Native Pat'
        });

        expect(telemetryMocks.captureHandledAppError).toHaveBeenCalledWith(
            'profile profile-load',
            sdkError,
            expect.objectContaining({
                service: 'profile',
                operation: 'profile-load',
                fallback: 'rest',
                userIdPresent: true
            })
        );
        expect(JSON.stringify(telemetryMocks.captureHandledAppError.mock.calls[0][2])).not.toContain('user-1');
        expect(telemetryMocks.timerEnd).toHaveBeenCalledWith({
            path: 'rest_fallback',
            fallback: true,
            userIdPresent: true
        });
    });

    it('keeps service-load metadata attached to profile and parent schedule timers', () => {
        const profileServiceSource = readRepoFile('apps/app/src/lib/profileService.ts');
        const scheduleServiceSource = readRepoFile('apps/app/src/lib/scheduleService.ts');

        expect(profileServiceSource).toContain("from './telemetry'");
        expect(profileServiceSource).toContain("createAppTimer('profile document service load'");
        expect(profileServiceSource).toContain("captureHandledAppError(`profile ${operation}`");
        expect(scheduleServiceSource).toContain("startUxTimer('parent schedule service load', {");
        expect(scheduleServiceSource).toContain("category: 'service_load'");
        expect(scheduleServiceSource).toContain("service: 'schedule'");
        expect(scheduleServiceSource).toContain("operation: 'parent-schedule-load'");
    });
});
