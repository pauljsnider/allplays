// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const legacyPushMocks = {
    canUsePushNotifications: vi.fn(),
    registerPushNotifications: vi.fn()
};

const locationAssignMock = vi.fn();
let localStorageEntries: Map<string, string>;

async function loadPushService() {
    return await import('./pushService');
}

function setWebPushSupport(permission: NotificationPermission = 'default') {
    Object.defineProperty(window, 'PushManager', {
        configurable: true,
        value: function PushManager() {}
    });
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {}
    });
    Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: {
            permission,
            requestPermission: vi.fn(async () => permission)
        }
    });
}

function clearWebPushSupport() {
    Reflect.deleteProperty(window, 'PushManager');
    Reflect.deleteProperty(navigator, 'serviceWorker');
    Reflect.deleteProperty(window, 'Notification');
}

describe('pushService permission states', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubEnv('VITE_ALLPLAYS_FCM_VAPID_KEY', 'test-vapid-key');
        capacitorState.isNativePlatform.mockReturnValue(true);
        capacitorState.getPlatform.mockReturnValue('ios');
        firebaseMessagingMocks.isSupported.mockResolvedValue({ isSupported: true });
        firebaseMessagingMocks.addListener.mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });
        firebaseMessagingMocks.createChannel.mockResolvedValue(undefined);
        firebaseMessagingMocks.getToken.mockResolvedValue({ token: 'native-token' });
        firebaseMessagingMocks.checkPermissions.mockResolvedValue({ receive: 'prompt' });
        firebaseMessagingMocks.requestPermissions.mockResolvedValue({ receive: 'prompt' });
        profileServiceMocks.saveNotificationDeviceToken.mockResolvedValue(undefined);
        legacyPushMocks.canUsePushNotifications.mockResolvedValue(true);
        legacyPushMocks.registerPushNotifications.mockResolvedValue({ token: 'web-token' });
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
        vi.doMock('@legacy/push-notifications.js', () => legacyPushMocks);
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...window.location,
                assign: locationAssignMock
            }
        });
        localStorageEntries = new Map();
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: vi.fn((key: string) => localStorageEntries.get(key) || null),
                setItem: vi.fn((key: string, value: string) => {
                    localStorageEntries.set(key, value);
                }),
                removeItem: vi.fn((key: string) => {
                    localStorageEntries.delete(key);
                }),
                clear: vi.fn(() => {
                    localStorageEntries.clear();
                })
            }
        });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        clearWebPushSupport();
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

    it('maps web default permissions to prompt state for browser registration', async () => {
        capacitorState.isNativePlatform.mockReturnValue(false);
        capacitorState.getPlatform.mockReturnValue('web');
        setWebPushSupport('default');
        const { getPushNotificationPermissionStatus } = await loadPushService();

        await expect(getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'prompt',
            isNative: false,
            platform: 'web',
            canPrompt: true,
            canOpenSettings: false
        });
    });

    it('maps granted and denied web permissions without opening device settings', async () => {
        capacitorState.isNativePlatform.mockReturnValue(false);
        capacitorState.getPlatform.mockReturnValue('web');
        setWebPushSupport('granted');
        let service = await loadPushService();

        await expect(service.getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'enabled',
            isNative: false,
            platform: 'web',
            canPrompt: false,
            canOpenSettings: false
        });

        vi.resetModules();
        setWebPushSupport('denied');
        service = await loadPushService();

        await expect(service.getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'blocked',
            isNative: false,
            platform: 'web',
            canPrompt: false,
            canOpenSettings: false
        });
    });

    it('maps unsupported web browsers to unsupported state', async () => {
        capacitorState.isNativePlatform.mockReturnValue(false);
        capacitorState.getPlatform.mockReturnValue('web');
        clearWebPushSupport();
        const { getPushNotificationPermissionStatus } = await loadPushService();

        await expect(getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'unsupported',
            isNative: false,
            platform: 'web',
            canPrompt: false,
            canOpenSettings: false
        });
    });

    it('maps Firebase Messaging unsupported web browsers to unsupported state before prompting', async () => {
        capacitorState.isNativePlatform.mockReturnValue(false);
        capacitorState.getPlatform.mockReturnValue('web');
        setWebPushSupport('default');
        legacyPushMocks.canUsePushNotifications.mockResolvedValue(false);
        const { enablePushNotificationsForUser, getPushNotificationPermissionStatus } = await loadPushService();

        await expect(getPushNotificationPermissionStatus()).resolves.toEqual({
            state: 'unsupported',
            isNative: false,
            platform: 'web',
            canPrompt: false,
            canOpenSettings: false
        });
        await expect(enablePushNotificationsForUser('user-1')).rejects.toMatchObject({
            code: 'push-unsupported',
            permissionStatus: {
                state: 'unsupported',
                platform: 'web'
            }
        });
        expect(legacyPushMocks.registerPushNotifications).not.toHaveBeenCalled();
    });

    it('registers web push with the configured VAPID key', async () => {
        capacitorState.isNativePlatform.mockReturnValue(false);
        capacitorState.getPlatform.mockReturnValue('web');
        setWebPushSupport('default');
        const { enablePushNotificationsForUser } = await loadPushService();

        await expect(enablePushNotificationsForUser('user-1')).resolves.toEqual({
            token: 'web-token',
            platform: 'web'
        });

        expect(legacyPushMocks.registerPushNotifications).toHaveBeenCalledWith({ vapidKey: 'test-vapid-key' });
        expect(profileServiceMocks.saveNotificationDeviceToken).toHaveBeenCalledWith('user-1', {
            token: 'web-token',
            platform: 'web',
            userAgent: navigator.userAgent || ''
        });
    });

    it('throws a blocked permission error when the browser prompt is denied', async () => {
        capacitorState.isNativePlatform.mockReturnValue(false);
        capacitorState.getPlatform.mockReturnValue('web');
        setWebPushSupport('default');
        legacyPushMocks.registerPushNotifications.mockImplementation(async () => {
            setWebPushSupport('denied');
            throw new Error('Notification permission was not granted.');
        });
        const { enablePushNotificationsForUser } = await loadPushService();

        await expect(enablePushNotificationsForUser('user-1')).rejects.toMatchObject({
            code: 'push-permission-blocked',
            permissionStatus: {
                state: 'blocked',
                platform: 'web',
                canOpenSettings: false
            }
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

    it('registers the native token after the OS prompt is granted', async () => {
        firebaseMessagingMocks.checkPermissions.mockResolvedValue({ receive: 'prompt' });
        firebaseMessagingMocks.requestPermissions.mockResolvedValue({ receive: 'granted' });
        const { enablePushNotificationsForUser } = await loadPushService();

        await expect(enablePushNotificationsForUser('user-1')).resolves.toEqual({
            token: 'native-token',
            platform: 'ios'
        });

        expect(firebaseMessagingMocks.requestPermissions).toHaveBeenCalledTimes(1);
        expect(profileServiceMocks.saveNotificationDeviceToken).toHaveBeenCalledWith('user-1', {
            token: 'native-token',
            platform: 'ios',
            userAgent: navigator.userAgent || ''
        });
    });

    it('tracks notification primer decline while allowing the app to ask again later', async () => {
        const {
            getPushNotificationPrimerState,
            runPushNotificationPrimer
        } = await loadPushService();

        expect(getPushNotificationPrimerState('messages')).toMatchObject({
            hasResponded: false,
            accepted: false,
            declined: false,
            canAskAgain: true
        });

        const declinePrimer = vi.fn(() => false);
        await expect(runPushNotificationPrimer('messages', { confirm: declinePrimer })).resolves.toBe(false);
        expect(declinePrimer).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Turn on message notifications?'
        }), expect.objectContaining({
            context: 'messages'
        }));
        expect(getPushNotificationPrimerState('messages')).toMatchObject({
            hasResponded: true,
            accepted: false,
            declined: true,
            canAskAgain: true
        });

        const acceptPrimer = vi.fn(() => true);
        await expect(runPushNotificationPrimer('messages', { confirm: acceptPrimer })).resolves.toBe(true);
        expect(getPushNotificationPrimerState('messages')).toMatchObject({
            hasResponded: true,
            accepted: true,
            declined: false,
            canAskAgain: false
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
