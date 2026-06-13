// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorState = {
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn()
};

const firebaseMessagingMocks = {
    addListener: vi.fn(),
    checkPermissions: vi.fn(),
    createChannel: vi.fn(),
    getToken: vi.fn(),
    isSupported: vi.fn(),
    requestPermissions: vi.fn()
};

const profileServiceMocks = {
    saveNotificationDeviceToken: vi.fn()
};

const locationAssignMock = vi.fn();

async function loadPushService() {
    return await import('./pushService');
}

describe('pushService permission states', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        capacitorState.isNativePlatform.mockReturnValue(true);
        capacitorState.getPlatform.mockReturnValue('ios');
        firebaseMessagingMocks.isSupported.mockResolvedValue({ isSupported: true });
        firebaseMessagingMocks.addListener.mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });
        firebaseMessagingMocks.createChannel.mockResolvedValue(undefined);
        firebaseMessagingMocks.getToken.mockResolvedValue({ token: 'native-token' });
        firebaseMessagingMocks.checkPermissions.mockResolvedValue({ receive: 'prompt' });
        firebaseMessagingMocks.requestPermissions.mockResolvedValue({ receive: 'prompt' });
        profileServiceMocks.saveNotificationDeviceToken.mockResolvedValue(undefined);
        vi.doMock('@capacitor/core', () => ({
            Capacitor: capacitorState
        }));
        vi.doMock('@capacitor-firebase/messaging', () => ({
            FirebaseMessaging: firebaseMessagingMocks
        }));
        vi.doMock('./profileService', () => profileServiceMocks);
        vi.doMock('./pushNotificationRouting', () => ({
            rememberPendingPushRoute: vi.fn(),
            resolvePushNotificationRoute: vi.fn()
        }));
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...window.location,
                assign: locationAssignMock
            }
        });
    });

    it('maps granted native permissions to enabled state', async () => {
        firebaseMessagingMocks.checkPermissions.mockResolvedValue({ receive: 'granted' });
        const { getPushNotificationPermissionStatus } = await loadPushService();

        await expect(getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'enabled',
            isNative: true,
            platform: 'ios',
            canPrompt: false,
            canOpenSettings: false
        });
    });

    it('maps prompt native permissions to prompt state', async () => {
        firebaseMessagingMocks.checkPermissions.mockResolvedValue({ receive: 'prompt' });
        const { getPushNotificationPermissionStatus } = await loadPushService();

        await expect(getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'prompt',
            isNative: true,
            platform: 'ios',
            canPrompt: true,
            canOpenSettings: false
        });
    });

    it('maps prompt-with-rationale native permissions to prompt state', async () => {
        firebaseMessagingMocks.checkPermissions.mockResolvedValue({ receive: 'prompt-with-rationale' });
        const { getPushNotificationPermissionStatus } = await loadPushService();

        await expect(getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'prompt',
            isNative: true,
            platform: 'ios',
            canPrompt: true,
            canOpenSettings: false
        });
    });

    it('maps denied native permissions to blocked state', async () => {
        firebaseMessagingMocks.checkPermissions.mockResolvedValue({ receive: 'denied' });
        const { getPushNotificationPermissionStatus } = await loadPushService();

        await expect(getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'blocked',
            isNative: true,
            platform: 'ios',
            canPrompt: false,
            canOpenSettings: true
        });
    });

    it('maps unsupported devices to unsupported state', async () => {
        firebaseMessagingMocks.isSupported.mockResolvedValue({ isSupported: false });
        const { getPushNotificationPermissionStatus } = await loadPushService();

        await expect(getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'unsupported',
            isNative: true,
            platform: 'ios',
            canPrompt: false,
            canOpenSettings: false
        });
    });

    it('maps non-native shells to unsupported state for settings recovery UI', async () => {
        capacitorState.isNativePlatform.mockReturnValue(false);
        capacitorState.getPlatform.mockReturnValue('web');
        const { getPushNotificationPermissionStatus } = await loadPushService();

        await expect(getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'unsupported',
            isNative: false,
            platform: 'web',
            canPrompt: false,
            canOpenSettings: false
        });
    });

    it('throws a blocked permission error after the native prompt is denied', async () => {
        firebaseMessagingMocks.checkPermissions.mockResolvedValue({ receive: 'prompt' });
        firebaseMessagingMocks.requestPermissions.mockResolvedValue({ receive: 'denied' });
        const { enablePushNotificationsForUser } = await loadPushService();

        await expect(enablePushNotificationsForUser('user-1')).rejects.toMatchObject({
            code: 'push-permission-blocked',
            permissionStatus: {
                state: 'blocked',
                canOpenSettings: true
            }
        });
    });

    it('opens app notification settings with the platform-specific recovery url', async () => {
        capacitorState.getPlatform.mockReturnValue('android');
        const { openPushNotificationSettings } = await loadPushService();

        await openPushNotificationSettings();

        expect(locationAssignMock).toHaveBeenCalledWith(
            'intent:#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;S.extra_app_package=ai.allplays.lite;end'
        );
    });

    it('creates category Android channels on Android startup', async () => {
        capacitorState.getPlatform.mockReturnValue('android');
        const { ensureAndroidNotificationChannels } = await loadPushService();

        await ensureAndroidNotificationChannels();

        expect(firebaseMessagingMocks.createChannel).toHaveBeenCalledTimes(5);
        expect(firebaseMessagingMocks.createChannel).toHaveBeenCalledWith(expect.objectContaining({
            id: 'allplays_messages',
            name: 'Messages',
            importance: 4
        }));
        expect(firebaseMessagingMocks.createChannel).toHaveBeenCalledWith(expect.objectContaining({
            id: 'allplays_game_day',
            name: 'Game day',
            importance: 4
        }));
        expect(firebaseMessagingMocks.createChannel).toHaveBeenCalledWith(expect.objectContaining({
            id: 'allplays_schedule',
            name: 'Schedule',
            importance: 3
        }));
        expect(firebaseMessagingMocks.createChannel).toHaveBeenCalledWith(expect.objectContaining({
            id: 'allplays_money',
            name: 'Money',
            importance: 3
        }));
        expect(firebaseMessagingMocks.createChannel).toHaveBeenCalledWith(expect.objectContaining({
            id: 'allplays_team',
            name: 'Team',
            importance: 3
        }));
    });

    it('skips Android channel creation outside Android native shells', async () => {
        capacitorState.getPlatform.mockReturnValue('ios');
        const { ensureAndroidNotificationChannels } = await loadPushService();

        await ensureAndroidNotificationChannels();

        expect(firebaseMessagingMocks.createChannel).not.toHaveBeenCalled();
    });
});
