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

function decodeCallableValue(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(decodeCallableValue);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(record, key);
  const keys = Object.keys(record);
  const hasPrivateTimestamp = keys.length === 2 && hasOwn('_seconds') && hasOwn('_nanoseconds');
  const hasPublicTimestamp = keys.length === 2 && hasOwn('seconds') && hasOwn('nanoseconds');
  if (hasPrivateTimestamp || hasPublicTimestamp) {
    const seconds = Number(hasPrivateTimestamp ? record._seconds : record.seconds);
    const nanoseconds = Number(hasPrivateTimestamp ? record._nanoseconds : record.nanoseconds);
    if (Number.isSafeInteger(seconds) && Number.isInteger(nanoseconds) && nanoseconds >= 0 && nanoseconds < 1_000_000_000) {
      const decoded = new Date((seconds * 1000) + Math.floor(nanoseconds / 1_000_000));
      if (!Number.isNaN(decoded.getTime())) return decoded;
    }
  }

  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, decodeCallableValue(nested)]));
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
  return result.items
    .filter((fee: unknown) => fee && typeof fee === 'object' && !Array.isArray(fee))
    .map((fee: unknown) => decodeCallableValue(fee));
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
