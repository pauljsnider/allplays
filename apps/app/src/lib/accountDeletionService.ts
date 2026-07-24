import { functions, httpsCallable } from './adapters/legacyAccountDb';
import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import {
  firebaseAuth,
  getNativeAuthIdToken,
  reauthenticateCurrentUserForDeletion,
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
} | {
  success: false;
  status: 'requires-recent-auth';
  provider: 'apple' | 'google' | 'password' | 'unknown';
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

async function postWebAccountDeletion(source: string): Promise<AccountDeletionResponse> {
  const callable = httpsCallable(functions, 'requestAccountDeletion');
  const response = await callable({
    confirmation: 'DELETE',
    source
  });
  return response.data as AccountDeletionResponse;
}

async function requestAccountDeletionWithReauthentication(
  source: string,
  password = ''
): Promise<AccountDeletionResult> {
  const native = isNativeRuntime();
  let appleAuthorizationRevoked = false;
  const postRequest = () => native
    ? postNativeAccountDeletion(source, appleAuthorizationRevoked)
    : postWebAccountDeletion(source);
  let result = await postRequest();

  if (result.status === 'requires-recent-auth') {
    const reauthentication = await reauthenticateCurrentUserForDeletion(result.provider, password);
    appleAuthorizationRevoked = reauthentication.appleAuthorizationRevoked;
    result = await postRequest();
  }
  if (result.status === 'requires-apple-reauth') {
    if (!native) {
      throw new Error('Open the ALL PLAYS iOS app to reauthenticate with Apple before deleting this account.');
    }
    await revokeCurrentAppleAuthorizationForDeletion();
    appleAuthorizationRevoked = true;
    result = await postRequest();
  }
  if (result.status !== 'queued') {
    throw new Error('Account deletion could not be queued.');
  }
  return result;
}

export async function requestAccountDeletion(source = 'app', password = ''): Promise<AccountDeletionResult> {
  return requestAccountDeletionWithReauthentication(source, password);
}
