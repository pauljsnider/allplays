import { functions, httpsCallable } from './adapters/legacyAccountDb';
import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import {
  firebaseAuth,
  getNativeAuthIdToken,
  revokeCurrentAppleAuthorizationForDeletion
} from './authService';
import { isNativeRuntime } from './nativeRuntime';

export type AccountDeletionResult = {
  success: boolean;
  status: 'queued';
  completionTargetDays: number;
};

type AccountDeletionResponse = AccountDeletionResult | {
  success: false;
  status: 'requires-apple-reauth';
  completionTargetDays: number;
};

async function postNativeAccountDeletion(
  source: string,
  appleAuthorizationRevoked = false
): Promise<AccountDeletionResponse> {
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
        source,
        ...(appleAuthorizationRevoked ? { appleAuthorizationRevoked: true } : {})
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || 'Unable to request account deletion.');
  }
  const result = payload?.result ?? payload?.data;
  if (!result) {
    throw new Error('Account deletion returned an invalid response.');
  }
  return result as AccountDeletionResponse;
}

async function requestNativeAccountDeletion(source: string): Promise<AccountDeletionResult> {
  let result = await postNativeAccountDeletion(source);
  if (result.status === 'requires-apple-reauth') {
    await revokeCurrentAppleAuthorizationForDeletion();
    result = await postNativeAccountDeletion(source, true);
  }
  if (result.status !== 'queued') {
    throw new Error('Account deletion could not be queued.');
  }
  return result;
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
  const result = response.data as AccountDeletionResponse;
  if (result.status === 'requires-apple-reauth') {
    throw new Error('Open the ALL PLAYS iOS app to reauthenticate with Apple before deleting this account.');
  }
  return result;
}
