// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    createAccessCode: vi.fn(),
    createAccountMergeRequest: vi.fn(),
    generateAccessCode: vi.fn(() => 'CODE1234'),
    getNotificationPreferencesForTeam: vi.fn(),
    getParentTeams: vi.fn(),
    getUserAccessCodes: vi.fn(),
    getUserAccessCodesPage: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeamsWithAccess: vi.fn(),
    saveNotificationPreferencesForTeam: vi.fn(),
    updateUserProfile: vi.fn(),
    upsertNotificationDeviceToken: vi.fn(),
    uploadUserPhoto: vi.fn()
}));
const telemetryMocks = vi.hoisted(() => {
    const timerEnd = vi.fn();
    return {
        timerEnd,
        captureHandledAppError: vi.fn(),
        createAppTimer: vi.fn(() => ({ end: timerEnd }))
    };
});

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
vi.mock('./telemetry', () => telemetryMocks);
vi.mock('../../../../js/team-visibility.js', () => ({
    isTeamActive: vi.fn(() => true)
}));

import { normalizeProfilePhoto } from './profilePhotoService';
import { getNativeAuthIdToken } from './authService';
import { loadProfileAccessCodesPage, loadProfileDocument, requestAccountMerge } from './profileService';

it('routes handled profile-service failures through the shared logger helper', () => {
    const profileServiceSource = readFileSync('src/lib/profileService.ts', 'utf8');

    expect(profileServiceSource).toContain("from './logger'");
    expect(profileServiceSource).toContain("from './telemetry'");
    expect(profileServiceSource).toContain("createLogger('profile-service')");
    expect(profileServiceSource).toContain("createAppTimer('profile document service load'");
    expect(profileServiceSource).toContain("captureHandledAppError(`profile ${operation}`");
    expect(profileServiceSource).not.toContain('console.');
});

describe('loadProfileDocument telemetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
        vi.mocked(getNativeAuthIdToken).mockResolvedValue('native-token');
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
});

describe('normalizeProfilePhoto', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resizes oversized profile photos before upload', async () => {
        const sourceFile = new File([new Uint8Array(900000)], 'profile.png', { type: 'image/png' });
        const bitmap = {
            width: 2400,
            height: 1800,
            close: vi.fn()
        };
        const drawImage = vi.fn();
        const toBlob = vi.fn((callback: (blob: Blob | null) => void) => callback(new Blob([new Uint8Array(120000)], { type: 'image/png' })));
        const originalCreateElement = document.createElement.bind(document);
        const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName === 'canvas') {
                return {
                    width: 0,
                    height: 0,
                    getContext: vi.fn(() => ({ drawImage })),
                    toBlob
                } as unknown as HTMLCanvasElement;
            }
            return originalCreateElement(tagName);
        });

        vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));

        const normalizedFile = await normalizeProfilePhoto(sourceFile);

        expect(normalizedFile).not.toBe(sourceFile);
        expect(normalizedFile.size).toBeLessThan(sourceFile.size);
        expect(normalizedFile.type).toBe('image/png');
        expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1024, 768);
        expect(toBlob).toHaveBeenCalled();
        expect(bitmap.close).toHaveBeenCalled();

        createElementSpy.mockRestore();
    });
});

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

describe('loadProfileAccessCodesPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the bounded access-code page helper with cursor and page size', async () => {
        const cursor = { id: 'cursor' };
        dbMocks.getUserAccessCodesPage.mockResolvedValue({
            codes: [{ id: 'code-1', code: 'ACTIVE123' }],
            nextCursor: null
        });

        await expect(loadProfileAccessCodesPage('user-1', { cursor, pageSize: 3 })).resolves.toEqual({
            codes: [{ id: 'code-1', code: 'ACTIVE123' }],
            nextCursor: null
        });

        expect(dbMocks.getUserAccessCodesPage).toHaveBeenCalledWith('user-1', { cursor, pageSize: 3 });
    });

    it('falls back to a safe empty result when the access-code page helper returns no page payload', async () => {
        dbMocks.getUserAccessCodesPage.mockResolvedValue(undefined);

        await expect(loadProfileAccessCodesPage('user-1')).resolves.toEqual({
            codes: [],
            nextCursor: null
        });
    });
});
