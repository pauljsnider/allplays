import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import type { CreateChannelOptions, NotificationActionPerformedEvent } from '@capacitor-firebase/messaging';
import { saveNotificationDeviceToken } from './profileService';
import { rememberPendingPushRoute, resolvePushNotificationRoute } from './pushNotificationRouting';

export type PushNotificationPermissionState = 'enabled' | 'prompt' | 'blocked' | 'unsupported';

export type PushNotificationPermissionStatus = {
  state: PushNotificationPermissionState;
  isNative: boolean;
  platform: string;
  canPrompt: boolean;
  canOpenSettings: boolean;
};

type PushRegistrationResult = {
  token: string;
  platform: string;
};

const nativePushTimeoutMs = 15000;
const iosNotificationSettingsUrl = 'app-settings:';
const androidNotificationSettingsUrl = 'intent:#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;S.extra_app_package=ai.allplays.lite;end';
const androidAppSettingsUrl = 'app-settings:';
export const androidNotificationChannels = [
  {
    id: 'allplays_messages',
    name: 'Messages',
    description: 'Team chat, direct messages, and mentions.',
    importance: 4
  },
  {
    id: 'allplays_game_day',
    name: 'Game day',
    description: 'Live scores, game-day alerts, and practice packets.',
    importance: 4
  },
  {
    id: 'allplays_schedule',
    name: 'Schedule',
    description: 'Schedule changes, RSVP reminders, and officiating updates.',
    importance: 3
  },
  {
    id: 'allplays_money',
    name: 'Money',
    description: 'Team fee assignments, reminders, and payment updates.',
    importance: 3
  },
  {
    id: 'allplays_team',
    name: 'Team',
    description: 'Team access, rideshare, media, and award updates.',
    importance: 3
  }
] as const satisfies readonly CreateChannelOptions[];

export class PushPermissionError extends Error {
  code: 'push-permission-blocked' | 'push-unsupported';
  permissionStatus: PushNotificationPermissionStatus;

  constructor(message: string, code: 'push-permission-blocked' | 'push-unsupported', permissionStatus: PushNotificationPermissionStatus) {
    super(message);
    this.name = 'PushPermissionError';
    this.code = code;
    this.permissionStatus = permissionStatus;
  }
}

export async function addPushNotificationOpenListener(onRouteOpen: (route: string) => void) {
  if (!Capacitor.isNativePlatform()) {
    return async () => {};
  }

  const listener = await FirebaseMessaging.addListener('notificationActionPerformed', (event: NotificationActionPerformedEvent) => {
    const route = resolvePushNotificationRoute(event.notification?.data);
    if (!route) {
      return;
    }
    rememberPendingPushRoute(route);
    onRouteOpen(route);
  });

  return async () => {
    await listener.remove();
  };
}

export async function ensureAndroidNotificationChannels(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return;
  }

  await Promise.all(androidNotificationChannels.map(async (channel) => {
    try {
      await FirebaseMessaging.createChannel({ ...channel });
    } catch (error) {
      console.warn('[push] Unable to create Android notification channel:', channel.id, error);
    }
  }));
}

export async function enablePushNotificationsForUser(userId: string): Promise<PushRegistrationResult> {
  if (!userId) {
    throw new Error('No signed-in user is available for push registration.');
  }

  if (!Capacitor.isNativePlatform()) {
    const { registerPushNotifications } = await import('../../../../js/push-notifications.js');
    const { token } = await registerPushNotifications();
    await saveNotificationDeviceToken(userId, {
      token,
      platform: 'web',
      userAgent: navigator.userAgent || ''
    });

    return {
      token,
      platform: 'web'
    };
  }

  const permissionStatus = await getPushNotificationPermissionStatus();
  if (permissionStatus.state === 'unsupported') {
    throw new PushPermissionError('Push notifications are not supported on this device.', 'push-unsupported', permissionStatus);
  }

  if (permissionStatus.state === 'blocked') {
    throw new PushPermissionError('Notifications are turned off in device settings. Open device settings to allow notifications for ALL PLAYS.', 'push-permission-blocked', permissionStatus);
  }

  let permissions = await FirebaseMessaging.checkPermissions();
  if (permissionStatus.state === 'prompt') {
    permissions = await FirebaseMessaging.requestPermissions();
  }

  if (permissions.receive !== 'granted') {
    throw new PushPermissionError(
      'Notifications are turned off in device settings. Open device settings to allow notifications for ALL PLAYS.',
      'push-permission-blocked',
      buildPushPermissionStatus('blocked', Capacitor.getPlatform())
    );
  }

  const token = await getNativeMessagingToken();
  const platform = Capacitor.getPlatform();
  await saveNotificationDeviceToken(userId, {
    token,
    platform,
    userAgent: navigator.userAgent || ''
  });

  return {
    token,
    platform
  };
}

export async function getPushNotificationPermissionStatus(): Promise<PushNotificationPermissionStatus> {
  if (!Capacitor.isNativePlatform()) {
    return buildPushPermissionStatus('unsupported', 'web');
  }

  const platform = Capacitor.getPlatform();
  const supported = await FirebaseMessaging.isSupported().catch(() => ({ isSupported: true }));
  if (!supported.isSupported) {
    return buildPushPermissionStatus('unsupported', platform);
  }

  const permissions = await FirebaseMessaging.checkPermissions();
  if (permissions.receive === 'granted') {
    return buildPushPermissionStatus('enabled', platform);
  }
  if (permissions.receive === 'prompt' || permissions.receive === 'prompt-with-rationale') {
    return buildPushPermissionStatus('prompt', platform);
  }
  return buildPushPermissionStatus('blocked', platform);
}

export async function openPushNotificationSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  const platform = Capacitor.getPlatform();
  const settingsUrl = platform === 'android' ? androidNotificationSettingsUrl : iosNotificationSettingsUrl;
  const fallbackUrl = platform === 'android' ? androidAppSettingsUrl : iosNotificationSettingsUrl;

  try {
    window.location.assign(settingsUrl);
  } catch {
    window.location.assign(fallbackUrl);
  }
}

function buildPushPermissionStatus(state: PushNotificationPermissionState, platform: string): PushNotificationPermissionStatus {
  return {
    state,
    isNative: platform !== 'web',
    platform,
    canPrompt: state === 'prompt',
    canOpenSettings: state === 'blocked'
  };
}

async function getNativeMessagingToken(): Promise<string> {
  let tokenListener: { remove: () => Promise<void> } | undefined;
  let timeoutId: number | undefined;

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      tokenListener?.remove();
    };

    const settle = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      handler();
    };

    async function setup() {
      tokenListener = await FirebaseMessaging.addListener('tokenReceived', (event) => {
        if (event.token) {
          settle(() => resolve(event.token));
        }
      });

      timeoutId = window.setTimeout(() => {
        settle(() => reject(new Error('Push registration timed out.')));
      }, nativePushTimeoutMs);

      const result = await FirebaseMessaging.getToken();
      if (!result.token) {
        throw new Error('Unable to obtain a push token for this device.');
      }
      settle(() => resolve(result.token));
    }

    setup().catch((error) => {
      settle(() => reject(error));
    });
  });
}
