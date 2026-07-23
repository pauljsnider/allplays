import { functions, httpsCallable } from './adapters/legacyAccountDb';
import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { isNativeRuntime } from './nativeRuntime';

export type AccountDeletionResult = {
  success: boolean;
  status: 'queued';
  completionTargetDays: number;
};

async function requestNativeAccountDeletion(source: string): Promise<AccountDeletionResult> {
  const nativeIdToken = await getNativeAuthIdToken(true).catch(() => null);
  const idToken = nativeIdToken || await firebaseAuth.currentUser?.getIdToken(true);
  if (!idToken) {
    throw new Error('Native auth token is unavailable.');
  }

  const projectId = firebaseAuth.app?.options?.projectId;
  if (!projectId) {
    throw new Error('Firebase project configuration is unavailable.');
  }

  const requestUrl = `https://us-central1-${projectId}.cloudfunctions.net/requestAccountDeletion`;
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: await getPrimaryAppCheckHeaders({
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    }, requestUrl),
    body: JSON.stringify({
      data: {
        confirmation: 'DELETE',
        source
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || 'Unable to request account deletion.');
  }
  return payload.data as AccountDeletionResult;
}

export async function requestAccountDeletion(source = 'app'): Promise<AccountDeletionResult> {
  if (isNativeRuntime()) {
    return requestNativeAccountDeletion(source);
  }

  const callable = httpsCallable(functions, 'requestAccountDeletion');
  const response = await callable({
    confirmation: 'DELETE',
    source
  });
  return response.data as AccountDeletionResult;
}
