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
vi.mock('@capacitor/camera', () => ({
    Camera: {},
    CameraResultType: {},
    CameraSource: {}
}));
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(() => false)
    }
}));
vi.mock('./authService', () => ({
    firebaseAuth: { app: { options: { projectId: 'demo-project' } } },
    getNativeAuthIdToken: vi.fn()
}));
vi.mock('./telemetry', () => telemetryMocks);
vi.mock('../../../../js/team-visibility.js', () => ({
    isTeamActive: vi.fn((team) => team?.isActive !== false)
}));

import { normalizeProfilePhoto } from './profilePhotoService';
import { getNativeAuthIdToken } from './authService';
import { createProfileAccessCode, loadNotificationTeams, loadParentTeams, loadProfileAccessCodesPage, loadProfileDocument, requestAccountMerge } from './profileService';

describe('createProfileAccessCode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns the collision-safe code actually persisted by the shared generator', async () => {
        dbMocks.generateAccessCode.mockReturnValue('FIRST123');
        dbMocks.createAccessCode.mockResolvedValue({ id: 'SECOND45', code: 'SECOND45' });

        await expect(createProfileAccessCode('user-1', 'friend@example.com', '')).resolves.toBe('SECOND45');
        expect(dbMocks.createAccessCode).toHaveBeenCalledWith('user-1', 'friend@example.com', '', 'FIRST123', {
            type: 'friend_invite'
        });
    });

    it('rejects untargeted friend invites before creating an unreadable access code', async () => {
        await expect(createProfileAccessCode('user-1', '  ', '')).rejects.toThrow('Enter an email or phone number for the invite.');

        expect(dbMocks.generateAccessCode).not.toHaveBeenCalled();
        expect(dbMocks.createAccessCode).not.toHaveBeenCalled();
    });

    it('uses the code as the Firestore document id in the native REST fallback', async () => {
        dbMocks.generateAccessCode.mockReturnValue('FIRST123');
        dbMocks.createAccessCode.mockRejectedValue(new Error('SDK unavailable'));
        vi.mocked(getNativeAuthIdToken).mockResolvedValue('native-token');
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);

            if (init?.method === 'PATCH') {
                return { ok: true, status: 200, json: async () => ({}) };
            }

            if (url.endsWith('/documents/users/user-1')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        name: 'projects/demo-project/databases/(default)/documents/users/user-1',
                        fields: {
                            displayName: { stringValue: 'Pat Parent' },
                            photoUrl: { stringValue: 'https://example.com/pat.jpg' },
                            parentTeamIds: {
                                arrayValue: {
                                    values: [
                                        { stringValue: 'team-1' },
                                        { stringValue: 'team-2' }
                                    ]
                                }
                            }
                        }
                    })
                };
            }

            return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(createProfileAccessCode('user-1', '', '555-0100')).resolves.toBe('FIRST123');

        const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
        const patchBody = JSON.parse(String(patchCall?.[1]?.body || '{}'));
        const fields = patchBody.fields || {};
        const inviterProfileFields = fields.inviterProfile?.mapValue?.fields || {};

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/accessCodes/FIRST123?currentDocument.exists=false'),
            expect.objectContaining({
                method: 'PATCH',
                body: expect.stringContaining('"friend_invite"')
            })
        );
        expect(inviterProfileFields.displayName).toEqual({ stringValue: 'Pat Parent' });
        expect(inviterProfileFields.fullName).toEqual({ stringValue: 'Pat Parent' });
        expect(inviterProfileFields.photoUrl).toEqual({ stringValue: 'https://example.com/pat.jpg' });
        expect(inviterProfileFields.discoveryTeamIds?.arrayValue?.values).toEqual([
            { stringValue: 'team-1' },
            { stringValue: 'team-2' }
        ]);
        expect(Number.isNaN(Date.parse(String(fields.expiresAt?.timestampValue || '')))).toBe(false);
        expect(new Date(String(fields.expiresAt.timestampValue)).getTime()).toBeGreaterThan(Date.now());
    });
});

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

describe('native parent-team fallback hydration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getNativeAuthIdToken).mockResolvedValue('native-token');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function mockNativeProfileFallbackFetch() {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);

            if (url.endsWith('/documents/users/user-1')) {
                return {
                    ok: true,
                    json: async () => ({
                        name: 'projects/demo-project/databases/(default)/documents/users/user-1',
                        fields: {
                            parentOf: {
                                arrayValue: {
                                    values: [
                                        { mapValue: { fields: { teamId: { stringValue: 'team-3' } } } },
                                        { mapValue: { fields: { teamId: { stringValue: 'team-1' } } } },
                                        { mapValue: { fields: { teamId: { stringValue: 'team-2' } } } },
                                        { mapValue: { fields: { teamId: { stringValue: 'team-1' } } } }
                                    ]
                                }
                            }
                        }
                    })
                };
            }

            if (url.endsWith(':runQuery')) {
                const body = JSON.parse(String(init?.body || '{}'));
                const fieldPath = body?.structuredQuery?.where?.fieldFilter?.field?.fieldPath;

                if (fieldPath === 'ownerId' || fieldPath === 'adminEmails') {
                    return {
                        ok: true,
                        json: async () => ([])
                    };
                }
            }

            if (url.endsWith('/documents/teams/team-1')) {
                return {
                    ok: true,
                    json: async () => ({
                        name: 'projects/demo-project/databases/(default)/documents/teams/team-1',
                        fields: {
                            name: { stringValue: 'Bears' },
                            isActive: { booleanValue: true }
                        }
                    })
                };
            }

            if (url.endsWith('/documents/teams/team-2')) {
                return {
                    ok: true,
                    json: async () => ({
                        name: 'projects/demo-project/databases/(default)/documents/teams/team-2',
                        fields: {
                            name: { stringValue: 'Archived Team' },
                            isActive: { booleanValue: false }
                        }
                    })
                };
            }

            if (url.endsWith('/documents/teams/team-3')) {
                return {
                    ok: true,
                    json: async () => ({
                        name: 'projects/demo-project/databases/(default)/documents/teams/team-3',
                        fields: {
                            name: { stringValue: 'Cougars' },
                            isActive: { booleanValue: true }
                        }
                    })
                };
            }

            throw new Error(`Unexpected fetch: ${url}`);
        });

        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    it('uses per-document team reads for notification teams so parent hydration stays rule-compatible', async () => {
        dbMocks.getUserTeamsWithAccess.mockRejectedValue(new Error('sdk failed'));
        dbMocks.getParentTeams.mockRejectedValue(new Error('sdk failed'));
        const fetchMock = mockNativeProfileFallbackFetch();

        await expect(loadNotificationTeams('user-1', 'parent@example.com')).resolves.toEqual([
            { id: 'team-1', name: 'Bears' },
            { id: 'team-3', name: 'Cougars' }
        ]);

        expect(fetchMock.mock.calls.some(([, init]) => String(init?.body || '').includes('"fieldPath":"__name__"'))).toBe(false);
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/documents/teams/team-1'))).toBe(true);
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/documents/teams/team-2'))).toBe(true);
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/documents/teams/team-3'))).toBe(true);
    });

    it('reuses the per-document fallback loader for parent teams', async () => {
        dbMocks.getParentTeams.mockRejectedValue(new Error('sdk failed'));
        const fetchMock = mockNativeProfileFallbackFetch();

        await expect(loadParentTeams('user-1')).resolves.toEqual([
            { id: 'team-1', name: 'Bears' },
            { id: 'team-3', name: 'Cougars' }
        ]);

        const batchQueryCalls = fetchMock.mock.calls.filter(([, init]) => String(init?.body || '').includes('"fieldPath":"__name__"'));
        expect(batchQueryCalls).toHaveLength(0);
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/documents/teams/team-1'))).toBe(true);
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
