import { CapacitorHttp } from '@capacitor/core';

import { listParentTeamFeeRecipients as legacyListParentTeamFeeRecipients } from './adapters/legacyHomeFees';
import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { isNativeRuntime } from './nativeRuntime';

type ParentFeeChildLink = {
  teamId?: string | null;
  playerId?: string | null;
};

const parentFeeRequestTimeoutMs = 8000;

function compactString(value: unknown) {
  return String(value || '').trim();
}

function getProjectId() {
  const projectId = compactString(firebaseAuth.app?.options?.projectId);
  if (!projectId) throw new Error('Firebase project ID is missing.');
  return projectId;
}

async function listNativeParentTeamFeeRecipients() {
  const token = await getNativeAuthIdToken(true);
  if (!token) throw new Error('Native auth token is unavailable.');
  const requestUrl = `https://us-central1-${getProjectId()}.cloudfunctions.net/listParentTeamFeeRecipients`;
  const response = await CapacitorHttp.post({
    url: requestUrl,
    headers: await getPrimaryAppCheckHeaders({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }, requestUrl) as Record<string, string>,
    data: { data: {} },
    connectTimeout: parentFeeRequestTimeoutMs,
    readTimeout: parentFeeRequestTimeoutMs
  });
  const payload = response.data && typeof response.data === 'object' ? response.data : {};
  const result = payload?.result || payload?.data;
  if (response.status < 200 || response.status >= 300 || !Array.isArray(result?.items)) {
    throw new Error(payload?.error?.message || 'Parent team fees response is invalid.');
  }
  return result.items.filter((fee: unknown) => fee && typeof fee === 'object' && !Array.isArray(fee));
}

export async function listParentTeamFeeRecipientsForApp(
  userId: string,
  children: ParentFeeChildLink[] = []
) {
  if (!userId) return [];
  if (!isNativeRuntime()) {
    return Promise.resolve(legacyListParentTeamFeeRecipients(userId, children));
  }
  return listNativeParentTeamFeeRecipients();
}
