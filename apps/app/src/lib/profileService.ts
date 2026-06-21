import {
  createAccessCode,
  createAccountMergeRequest,
  generateAccessCode,
  getNotificationPreferencesForTeam,
  getParentTeams,
  getUserAccessCodes,
  getUserAccessCodesPage,
  getUserProfile,
  getUserTeamsWithAccess,
  saveNotificationPreferencesForTeam,
  updateUserProfile,
  upsertNotificationDeviceToken
} from '../../../../js/db.js';
import { normalizeTeamNotificationPreferences } from '../../../../js/notification-preferences.js';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { createLogger } from './logger';
import { getNativeRestDedupKey, loadDedupedNativeRestRequest, shouldDedupNativeRestRequest } from './nativeRestDedup';
import { isTeamActive } from '../../../../js/team-visibility.js';

export {
  acquireProfilePhoto,
  normalizeProfilePhoto,
  uploadProfilePhoto,
  type ProfilePhotoSource
} from './profilePhotoService';

const profileTimeoutMs = 8000;
const primaryDataTimeoutMs = 3000;
const logger = createLogger('profile-service');

function logProfileWarning(message: string, operation: string, error: unknown, context: Record<string, unknown> = {}) {
    logger.warn(message, {
        operation,
        fallback: 'rest',
        ...context,
        error
    });
}

export type ProfileDocument = {
  email?: string;
  fullName?: string;
  displayName?: string;
  phone?: string;
  photoUrl?: string | null;
  signInMethod?: string;
  hasPassword?: boolean;
  updatedAt?: unknown;
};

export type NotificationCategory =
  | 'liveChat'
  | 'mentions'
  | 'liveScore'
  | 'gameDay'
  | 'schedule'
  | 'rsvp'
  | 'fees'
  | 'practice'
  | 'access'
  | 'rideshare'
  | 'media'
  | 'awards'
  | 'officiating';

export type NotificationPreferences = Record<NotificationCategory, boolean>;

export type NotificationTeam = {
  id: string;
  name?: string;
};

export type AccessCodeRecord = {
  id: string;
  code: string;
  email?: string | null;
  phone?: string | null;
  type?: string | null;
  used?: boolean;
  createdAt?: unknown;
  usedAt?: unknown;
};

export type AccessCodePage = {
  codes: AccessCodeRecord[];
  nextCursor: unknown | null;
};

export type NotificationDeviceTokenInput = {
  token: string;
  platform?: string;
  userAgent?: string;
};

export function normalizeNotificationPreferences(preferences?: Partial<NotificationPreferences> | null): NotificationPreferences {
  return normalizeTeamNotificationPreferences(preferences) as NotificationPreferences;
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = profileTimeoutMs): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  });
}

function getProjectId() {
  const projectId = firebaseAuth.app?.options?.projectId;
  if (!projectId) {
    throw new Error('Firebase project ID is missing.');
  }
  return projectId;
}

function getFirestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(getProjectId())}/databases/(default)/documents`;
}

async function getNativeHeaders() {
  const token = await getNativeAuthIdToken();
  if (!token) {
    throw new Error('Native auth token is unavailable.');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function nativeFirestoreRequest(path: string, init: RequestInit = {}) {
  const url = `${getFirestoreBaseUrl()}${path}`;
  const runRequest = async () => {
    const headers = await getNativeHeaders();
    const response = await withTimeout(fetch(url, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers || {})
      }
    }), 'Firestore REST request');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `Firestore request failed (${response.status}).`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return payload;
  };
  return shouldDedupNativeRestRequest(path, init)
    ? loadDedupedNativeRestRequest(getNativeRestDedupKey(url, init), runRequest)
    : runRequest();
}

function encodeFirestoreValue(value: any): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { nullValue: 'NULL_VALUE' };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((entry) => encodeFirestoreValue(entry)) } };
  }
  if (typeof value === 'object') {
    const fields = Object.keys(value).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
      acc[key] = encodeFirestoreValue(value[key]);
      return acc;
    }, {});
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function decodeFirestoreValue(value: any): any {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue || 0);
  if ('doubleValue' in value) return Number(value.doubleValue || 0);
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map((entry: any) => decodeFirestoreValue(entry));
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields || {});
  return null;
}

function decodeFirestoreFields(fields: Record<string, any> = {}) {
  return Object.keys(fields).reduce<Record<string, any>>((acc, key) => {
    acc[key] = decodeFirestoreValue(fields[key]);
    return acc;
  }, {});
}

function decodeFirestoreDocument(document: any) {
  if (!document?.name) {
    return null;
  }
  const id = String(document.name).split('/').pop() || '';
  return {
    id,
    ...decodeFirestoreFields(document.fields || {})
  };
}

async function nativeGetDocument(path: string) {
  try {
    return decodeFirestoreDocument(await nativeFirestoreRequest(`/${path}`));
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (error?.status === 404 || message.includes('not_found') || message.includes('not found')) {
      return null;
    }
    throw error;
  }
}

async function nativePatchDocument(path: string, data: Record<string, unknown>) {
  const fields = Object.keys(data).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
    acc[key] = encodeFirestoreValue(data[key]);
    return acc;
  }, {});
  const params = new URLSearchParams();
  Object.keys(data).forEach((key) => params.append('updateMask.fieldPaths', key));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  await nativeFirestoreRequest(`/${path}${suffix}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });
}

async function nativeRunQuery(collectionId: string, fieldPath: string, op: 'EQUAL' | 'ARRAY_CONTAINS', value: string) {
  const payload = await nativeFirestoreRequest(':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op,
            value: encodeFirestoreValue(value)
          }
        }
      }
    })
  });

  return Array.isArray(payload)
    ? payload.map((entry) => decodeFirestoreDocument(entry.document)).filter(Boolean)
    : [];
}

function filterActiveTeams(teams: any[]) {
  return teams.filter(isTeamActive);
}

async function nativeLoadProfileDocument(userId: string): Promise<ProfileDocument> {
  return (await nativeGetDocument(`users/${encodeURIComponent(userId)}`) || {}) as ProfileDocument;
}

async function nativeSaveProfileDocument(userId: string, profile: ProfileDocument) {
  await nativePatchDocument(`users/${encodeURIComponent(userId)}`, {
    ...profile,
    updatedAt: new Date()
  });
}

async function nativeLoadNotificationTeams(userId: string, email?: string | null): Promise<NotificationTeam[]> {
  const [profile, ownedTeams, adminTeams] = await Promise.all([
    nativeLoadProfileDocument(userId).catch(() => ({})),
    nativeRunQuery('teams', 'ownerId', 'EQUAL', userId).catch(() => []),
    email ? nativeRunQuery('teams', 'adminEmails', 'ARRAY_CONTAINS', email.toLowerCase()).catch(() => []) : Promise.resolve([])
  ]);
  const parentTeamIds = [...new Set((Array.isArray((profile as any).parentOf) ? (profile as any).parentOf : [])
    .map((link: any) => link?.teamId)
    .filter(Boolean))] as string[];
  const parentTeams = await Promise.all(parentTeamIds.map((teamId) => nativeGetDocument(`teams/${encodeURIComponent(teamId)}`).catch(() => null)));
  const map = new Map<string, NotificationTeam>();
  filterActiveTeams([...ownedTeams, ...adminTeams, ...parentTeams]).forEach((team: any) => {
    if (team?.id) {
      map.set(team.id, { id: team.id, name: team.name || team.id });
    }
  });
  return [...map.values()].sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

async function nativeLoadParentTeams(userId: string): Promise<NotificationTeam[]> {
  const profile = await nativeLoadProfileDocument(userId).catch(() => ({}));
  const parentTeamIds = [...new Set((Array.isArray((profile as any).parentOf) ? (profile as any).parentOf : [])
    .map((link: any) => link?.teamId)
    .filter(Boolean))] as string[];
  const parentTeams = await Promise.all(parentTeamIds.map((teamId) => nativeGetDocument(`teams/${encodeURIComponent(teamId)}`).catch(() => null)));

  return filterActiveTeams(parentTeams)
    .filter((team: any) => team?.id)
    .map((team: any) => ({ id: team.id, name: team.name || team.id }))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

async function nativeLoadNotificationPreferences(userId: string, teamId: string) {
  return normalizeNotificationPreferences(await nativeGetDocument(`users/${encodeURIComponent(userId)}/notificationPreferences/${encodeURIComponent(teamId)}`) as Partial<NotificationPreferences> | null);
}

async function nativeSaveNotificationPreferences(userId: string, teamId: string, preferences: NotificationPreferences) {
  const normalized = normalizeNotificationPreferences(preferences);
  await nativePatchDocument(`users/${encodeURIComponent(userId)}/notificationPreferences/${encodeURIComponent(teamId)}`, {
    ...normalized,
    updatedAt: new Date()
  });
  return normalized;
}

function getNotificationDeviceId(token: string) {
  const normalized = String(token || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (normalized) {
    return normalized.slice(0, 180);
  }
  return `device_${Date.now()}`;
}

async function nativeSaveNotificationDeviceToken(userId: string, input: NotificationDeviceTokenInput) {
  const token = String(input.token || '').trim();
  if (!token) {
    throw new Error('Missing device token.');
  }

  const deviceId = getNotificationDeviceId(token);
  await nativePatchDocument(`users/${encodeURIComponent(userId)}/notificationDevices/${encodeURIComponent(deviceId)}`, {
    token,
    platform: input.platform || 'web',
    userAgent: input.userAgent || '',
    updatedAt: new Date(),
    createdAt: new Date()
  });
  return deviceId;
}

async function nativeCreateAccessCode(userId: string, email: string, phone: string, code: string) {
  await nativeFirestoreRequest('/accessCodes', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        code: encodeFirestoreValue(code),
        generatedBy: encodeFirestoreValue(userId),
        email: encodeFirestoreValue(email || null),
        phone: encodeFirestoreValue(phone || null),
        createdAt: encodeFirestoreValue(new Date()),
        used: encodeFirestoreValue(false),
        usedBy: encodeFirestoreValue(null),
        usedAt: encodeFirestoreValue(null)
      }
    })
  });
}

async function nativeCreateAccountMergeRequest(userId: string, primaryEmail: string, secondaryEmail: string) {
  const payload = {
    requestedBy: userId,
    primaryEmail,
    secondaryEmail,
    status: 'pending_verification',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const response = await nativeFirestoreRequest(`/users/${encodeURIComponent(userId)}/accountMergeRequests`, {
    method: 'POST',
    body: JSON.stringify({
      fields: Object.keys(payload).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
        acc[key] = encodeFirestoreValue((payload as Record<string, unknown>)[key]);
        return acc;
      }, {})
    })
  });

  return String(response?.name || '').split('/').pop() || '';
}

async function nativeLoadAccessCodes(userId: string): Promise<AccessCodeRecord[]> {
  const codes = await nativeRunQuery('accessCodes', 'generatedBy', 'EQUAL', userId) as AccessCodeRecord[];
  return codes.sort((a, b) => {
    const aDate = getMillis(a.createdAt);
    const bDate = getMillis(b.createdAt);
    return bDate - aDate;
  });
}

async function nativeLoadAccessCodesPage(userId: string, { cursor = null, pageSize = 10 }: { cursor?: unknown | null; pageSize?: number } = {}): Promise<AccessCodePage> {
  const codes = await nativeLoadAccessCodes(userId);
  const offset = typeof cursor === 'number' && Number.isFinite(cursor) ? Math.max(0, cursor) : 0;
  const nextCodes = codes.slice(offset, offset + pageSize);
  const nextOffset = offset + nextCodes.length;
  return {
    codes: nextCodes,
    nextCursor: nextOffset < codes.length ? nextOffset : null
  };
}

function getMillis(value: any) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

export async function loadProfileDocument(userId: string): Promise<ProfileDocument> {
  try {
    return await withTimeout(Promise.resolve(getUserProfile(userId)), 'Profile load', primaryDataTimeoutMs) || {};
  } catch (error) {
    logProfileWarning('Falling back to REST profile load.', 'profile-load', error, { userId });
    return nativeLoadProfileDocument(userId);
  }
}

export async function saveProfileDocument(userId: string, profile: ProfileDocument) {
  try {
    await withTimeout(Promise.resolve(updateUserProfile(userId, profile)), 'Profile save', primaryDataTimeoutMs);
  } catch (error) {
    logProfileWarning('Falling back to REST profile save.', 'profile-save', error, { userId });
    await nativeSaveProfileDocument(userId, profile);
  }
}

export async function loadNotificationTeams(userId: string, email?: string | null): Promise<NotificationTeam[]> {
  let memberTeams: NotificationTeam[] = [];
  let parentTeams: NotificationTeam[] = [];

  try {
    [memberTeams, parentTeams] = await withTimeout(Promise.all([
      getUserTeamsWithAccess(userId, email || ''),
      getParentTeams(userId)
    ]), 'Notification team load', primaryDataTimeoutMs);
  } catch (error) {
    logProfileWarning('Falling back to REST notification team load.', 'notification-team-load', error, { userId });
    return nativeLoadNotificationTeams(userId, email);
  }

  const map = new Map<string, NotificationTeam>();
  [...memberTeams, ...parentTeams].forEach((team: NotificationTeam) => {
    if (team?.id) {
      map.set(team.id, team);
    }
  });

  return [...map.values()].sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

export async function loadParentTeams(userId: string): Promise<NotificationTeam[]> {
  try {
    const teams = await withTimeout(Promise.resolve(getParentTeams(userId)), 'Parent team load', primaryDataTimeoutMs);
    return (teams || []).filter((team: NotificationTeam | null | undefined) => Boolean(team?.id));
  } catch (error) {
    logProfileWarning('Falling back to REST parent team load.', 'parent-team-load', error, { userId });
    return nativeLoadParentTeams(userId);
  }
}

export async function loadNotificationPreferences(userId: string, teamId: string) {
  try {
    return normalizeNotificationPreferences(await withTimeout(
      Promise.resolve(getNotificationPreferencesForTeam(userId, teamId)),
      'Notification preference load',
      primaryDataTimeoutMs
    ));
  } catch (error) {
    logProfileWarning('Falling back to REST notification preference load.', 'notification-preference-load', error, { userId, teamId });
    return nativeLoadNotificationPreferences(userId, teamId);
  }
}

export async function saveNotificationPreferences(userId: string, teamId: string, preferences: NotificationPreferences) {
  try {
    return normalizeNotificationPreferences(await withTimeout(
      Promise.resolve(saveNotificationPreferencesForTeam(userId, teamId, preferences)),
      'Notification preference save',
      primaryDataTimeoutMs
    ));
  } catch (error) {
    logProfileWarning('Falling back to REST notification preference save.', 'notification-preference-save', error, { userId, teamId });
    return nativeSaveNotificationPreferences(userId, teamId, preferences);
  }
}

export async function saveNotificationDeviceToken(userId: string, input: NotificationDeviceTokenInput) {
  try {
    return await withTimeout(
      Promise.resolve(upsertNotificationDeviceToken(userId, input)),
      'Notification device save',
      primaryDataTimeoutMs
    );
  } catch (error) {
    logProfileWarning('Falling back to REST notification device save.', 'notification-device-save', error, { userId });
    return nativeSaveNotificationDeviceToken(userId, input);
  }
}

export async function createProfileAccessCode(userId: string, email: string, phone: string) {
  const code = generateAccessCode();
  try {
    await withTimeout(Promise.resolve(createAccessCode(userId, email, phone, code)), 'Invite code create', primaryDataTimeoutMs);
  } catch (error) {
    logProfileWarning('Falling back to REST invite code create.', 'invite-code-create', error, { userId });
    await nativeCreateAccessCode(userId, email, phone, code);
  }
  return code;
}

export async function requestAccountMerge(userId: string, primaryEmail: string, secondaryEmail: string) {
  const normalizedPrimaryEmail = String(primaryEmail || '').trim().toLowerCase();
  const normalizedSecondaryEmail = String(secondaryEmail || '').trim().toLowerCase();

  if (!normalizedPrimaryEmail || !normalizedSecondaryEmail) {
    throw new Error('Both account emails are required');
  }

  try {
    return await withTimeout(
      Promise.resolve(createAccountMergeRequest(userId, {
        primaryEmail: normalizedPrimaryEmail,
        secondaryEmail: normalizedSecondaryEmail
      })),
      'Account merge request',
      primaryDataTimeoutMs
    );
  } catch (error) {
    logProfileWarning('Falling back to REST account merge request.', 'account-merge-request', error, { userId });
    return nativeCreateAccountMergeRequest(userId, normalizedPrimaryEmail, normalizedSecondaryEmail);
  }
}

export async function loadProfileAccessCodes(userId: string): Promise<AccessCodeRecord[]> {
  try {
    return await withTimeout(getUserAccessCodes(userId) as Promise<AccessCodeRecord[]>, 'Invite history load', primaryDataTimeoutMs);
  } catch (error) {
    logProfileWarning('Falling back to REST invite history load.', 'invite-history-load', error, { userId });
    return nativeLoadAccessCodes(userId);
  }
}

export async function loadProfileAccessCodesPage(userId: string, { cursor = null, pageSize = 10 }: { cursor?: unknown | null; pageSize?: number } = {}): Promise<AccessCodePage> {
  try {
    const page = await withTimeout(
      Promise.resolve(getUserAccessCodesPage(userId, { cursor, pageSize })) as Promise<AccessCodePage>,
      'Invite history load',
      primaryDataTimeoutMs
    );

    return {
      codes: Array.isArray(page?.codes) ? page.codes : [],
      nextCursor: page?.nextCursor ?? null
    };
  } catch (error) {
    logProfileWarning('Falling back to REST invite history load.', 'invite-history-load', error, { userId });
    return nativeLoadAccessCodesPage(userId, { cursor, pageSize });
  }
}
