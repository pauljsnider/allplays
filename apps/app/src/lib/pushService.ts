import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { saveNotificationDeviceToken } from './profileService';

type NativeRegistrationResult = {
  token: string;
  platform: string;
};

const nativePushTimeoutMs = 15000;

export async function enablePushNotificationsForUser(userId: string): Promise<NativeRegistrationResult> {
  if (!userId) {
    throw new Error('No signed-in user is available for push registration.');
  }

  if (!Capacitor.isNativePlatform()) {
    throw new Error('Push registration for the web app still runs through the current website profile page.');
  }

  const supported = await FirebaseMessaging.isSupported().catch(() => ({ isSupported: true }));
  if (!supported.isSupported) {
    throw new Error('Push notifications are not supported on this device.');
  }

  let permissions = await FirebaseMessaging.checkPermissions();
  if (permissions.receive === 'prompt') {
    permissions = await FirebaseMessaging.requestPermissions();
  }

  if (permissions.receive !== 'granted') {
    throw new Error('Notification permission was not granted.');
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
