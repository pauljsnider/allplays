// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorState = vi.hoisted(() => ({
    isNative: true,
    plugins: new Set(['Camera'])
}));

const cameraMocks = vi.hoisted(() => ({
    getPhoto: vi.fn()
}));

const capacitorMock = vi.hoisted(() => ({
    isNativePlatform: () => capacitorState.isNative,
    isPluginAvailable: (pluginName: string) => capacitorState.plugins.has(pluginName)
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: capacitorMock
}), { virtual: true });

vi.mock('../../apps/app/node_modules/@capacitor/core/dist/index.cjs.js', () => ({
    Capacitor: capacitorMock
}));

vi.mock('@capacitor/camera', () => ({
    Camera: cameraMocks,
    CameraResultType: { Uri: 'uri' },
    CameraSource: { Camera: 'camera', Photos: 'photos' }
}), { virtual: true });

vi.mock('../../apps/app/node_modules/@capacitor/camera/dist/plugin.cjs.js', () => ({
    Camera: cameraMocks,
    CameraResultType: { Uri: 'uri' },
    CameraSource: { Camera: 'camera', Photos: 'photos' }
}));

vi.mock('../../js/db.js', () => ({
    createAccessCode: vi.fn(),
    createAccountMergeRequest: vi.fn(),
    generateAccessCode: vi.fn(),
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

vi.mock('../../js/notification-preferences.js', () => ({
    normalizeTeamNotificationPreferences: vi.fn((preferences) => preferences || {
        liveChat: true,
        liveScore: false,
        schedule: true
    })
}));

vi.mock('../../js/firebase-runtime-config.js', () => ({
    resolveImageFirebaseConfig: vi.fn(() => ({ apiKey: 'demo-key', storageBucket: 'demo-bucket' }))
}));

vi.mock('../../js/team-visibility.js', () => ({
    isTeamActive: vi.fn(() => true)
}));

vi.mock('../../apps/app/src/lib/authService.ts', () => ({
    firebaseAuth: { app: { options: { projectId: 'demo-allplays' } } },
    getNativeAuthIdToken: vi.fn()
}));

import { acquireProfilePhoto } from '../../apps/app/src/lib/profilePhotoService.ts';

describe('React app profile photo service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capacitorState.isNative = true;
        capacitorState.plugins = new Set(['Camera']);
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                protocol: 'capacitor:'
            }
        });
        cameraMocks.getPhoto.mockResolvedValue({
            webPath: 'https://example.test/profile-photo.jpg',
            format: 'jpeg'
        });
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            blob: async () => new Blob(['bounded-photo'], { type: 'image/jpeg' })
        })));
        vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
            width: 1024,
            height: 768,
            close: vi.fn()
        })));
    });

    it('requests bounded native profile photos and skips canvas resize for already bounded images', async () => {
        const createElementSpy = vi.spyOn(document, 'createElement');

        const file = await acquireProfilePhoto('photos');

        expect(cameraMocks.getPhoto).toHaveBeenCalledWith({
            quality: 85,
            resultType: 'uri',
            source: 'photos',
            correctOrientation: true,
            width: 1024,
            height: 1024
        });
        expect(file).toBeInstanceOf(File);
        expect(file.type).toBe('image/jpeg');
        expect(file.size).toBe(new Blob(['bounded-photo'], { type: 'image/jpeg' }).size);
        expect(file.name).toMatch(/^profile-library-\d+\.jpeg$/);
        expect(createElementSpy).not.toHaveBeenCalledWith('canvas');
    });
});
