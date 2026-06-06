import {
  Camera,
  CameraResultType,
  CameraSource,
  type CameraPhoto
} from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import {
  createAccessCode,
  createAccountMergeRequest,
  generateAccessCode,
  getNotificationPreferencesForTeam,
  getParentTeams,
  getUserAccessCodes,
  getUserProfile,
  getUserTeamsWithAccess,
  saveNotificationPreferencesForTeam,
  updateUserProfile,
  upsertNotificationDeviceToken,
  uploadUserPhoto
} from '../../../../js/db.js';
import { normalizeTeamNotificationPreferences } from '../../../../js/notification-preferences.js';
import { resolveImageFirebaseConfig } from '../../../../js/firebase-runtime-config.js';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { isTeamActive } from '../../../../js/team-visibility.js';

const profileTimeoutMs = 8000;
const primaryDataTimeoutMs = 3000;
const nativeImageUploadTimeoutMs = 20000;
const imageUploadSessionKey = 'allplays-image-upload-session';
const profilePhotoMaxDimensionPx = 1024;
const profilePhotoMaxBytes = 512 * 1024;
const profilePhotoQuality = 0.82;

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

export type NotificationPreferences = {
  liveChat: boolean;
  liveScore: boolean;
  schedule: boolean;
};

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

export type ProfilePhotoSource = 'camera' | 'photos';

export class ProfilePhotoAcquireError extends Error {
  code: 'permission-denied' | 'cancelled' | 'unavailable' | 'failed';

  constructor(code: 'permission-denied' | 'cancelled' | 'unavailable' | 'failed', message: string) {
    super(message);
    this.name = 'ProfilePhotoAcquireError';
    this.code = code;
  }
}

export type NotificationDeviceTokenInput = {
  token: string;
  platform?: string;
  userAgent?: string;
};

type ImageUploadSession = {
  apiKey: string;
  idToken: string;
  refreshToken: string;
  expirationTime: number;
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

function isNativeRuntime() {
  return Capacitor.isNativePlatform() || window.location.protocol === 'capacitor:';
}

function isNativeCameraAvailable() {
  return Capacitor.isNativePlatform() && Boolean((Capacitor as any).isPluginAvailable?.('Camera'));
}

function inferPhotoMimeType(photo: CameraPhoto, fallbackBlob?: Blob) {
  const format = String(photo.format || '').trim().toLowerCase();
  if (format) {
    return format === 'jpg' ? 'image/jpeg' : `image/${format}`;
  }
  if (fallbackBlob?.type) {
    return fallbackBlob.type;
  }
  return 'image/jpeg';
}

function buildPhotoFileName(source: ProfilePhotoSource, photo: CameraPhoto, mimeType: string) {
  const extension = mimeType.split('/')[1] || 'jpg';
  const baseName = source === 'camera' ? 'profile-camera' : 'profile-library';
  return `${baseName}-${Date.now()}.${extension.replace(/[^a-z0-9]+/gi, '') || 'jpg'}`;
}

function isPermissionDeniedError(error: unknown) {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return message.includes('permission') || message.includes('denied') || message.includes('not authorized');
}

function isCancellationError(error: unknown) {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return message.includes('cancel') || message.includes('user denied') || message.includes('no image picked');
}

function shouldNormalizeProfilePhoto(file: File, width: number, height: number) {
  return width > profilePhotoMaxDimensionPx || height > profilePhotoMaxDimensionPx || file.size > profilePhotoMaxBytes;
}

function getNormalizedProfilePhotoType(file: File) {
  return file.type === 'image/png' ? 'image/png' : 'image/jpeg';
}

function loadProfilePhotoImage(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  const imageBitmapFactory = (globalThis as typeof globalThis & { createImageBitmap?: (image: Blob) => Promise<ImageBitmap> }).createImageBitmap;
  if (typeof imageBitmapFactory === 'function') {
    return imageBitmapFactory(file).then((bitmap) => ({
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close()
    }));
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        cleanup: () => URL.revokeObjectURL(objectUrl)
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Profile photo could not be decoded.'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('Profile photo could not be normalized.'));
    }, type, quality);
  });
}

export async function normalizeProfilePhoto(file: File): Promise<File> {
  if (!(file instanceof File) || !file.type.startsWith('image/') || typeof document === 'undefined') {
    return file;
  }

  const { image, width, height, cleanup } = await loadProfilePhotoImage(file);

  try {
    if (!shouldNormalizeProfilePhoto(file, width, height)) {
      return file;
    }

    const scale = Math.min(1, profilePhotoMaxDimensionPx / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const outputType = getNormalizedProfilePhotoType(file);
    const blob = await canvasToBlob(canvas, outputType, outputType === 'image/png' ? undefined : profilePhotoQuality);

    if (blob.size >= file.size && targetWidth === width && targetHeight === height) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'profile-photo';
    const extension = outputType === 'image/png' ? 'png' : 'jpg';
    return new File([blob], `${baseName}.${extension}`, {
      type: outputType,
      lastModified: Date.now()
    });
  } finally {
    cleanup();
  }
}

export async function acquireProfilePhoto(source: ProfilePhotoSource): Promise<File> {
  if (!isNativeRuntime()) {
    throw new ProfilePhotoAcquireError('unavailable', 'Native profile photo capture is only available in the mobile app.');
  }

  if (!isNativeCameraAvailable()) {
    throw new ProfilePhotoAcquireError('unavailable', 'Camera access is not available on this device yet.');
  }

  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      resultType: CameraResultType.Uri,
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      correctOrientation: true,
      width: profilePhotoMaxDimensionPx,
      height: profilePhotoMaxDimensionPx
    });

    if (!photo.webPath) {
      throw new ProfilePhotoAcquireError('failed', 'Photo data was unavailable after selection.');
    }

    const response = await fetch(photo.webPath);
    if (!response.ok) {
      throw new ProfilePhotoAcquireError('failed', `Photo data could not be loaded (${response.status}).`);
    }

    const blob = await response.blob();
    const mimeType = inferPhotoMimeType(photo, blob);
    return normalizeProfilePhoto(new File([blob], buildPhotoFileName(source, photo, mimeType), {
      type: mimeType,
      lastModified: Date.now()
    }));
  } catch (error) {
    if (error instanceof ProfilePhotoAcquireError) {
      throw error;
    }
    if (isCancellationError(error)) {
      throw new ProfilePhotoAcquireError('cancelled', 'Photo selection was cancelled.');
    }
    if (isPermissionDeniedError(error)) {
      throw new ProfilePhotoAcquireError('permission-denied', 'Photo access permission was denied.');
    }
    throw new ProfilePhotoAcquireError('failed', String((error as any)?.message || 'Photo selection failed.'));
  }
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
  const headers = await getNativeHeaders();
  const response = await withTimeout(fetch(`${getFirestoreBaseUrl()}${path}`, {
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
    console.warn('[profile-service] Falling back to REST profile load:', error);
    return nativeLoadProfileDocument(userId);
  }
}

export async function saveProfileDocument(userId: string, profile: ProfileDocument) {
  try {
    await withTimeout(Promise.resolve(updateUserProfile(userId, profile)), 'Profile save', primaryDataTimeoutMs);
  } catch (error) {
    console.warn('[profile-service] Falling back to REST profile save:', error);
    await nativeSaveProfileDocument(userId, profile);
  }
}

export async function uploadProfilePhoto(file: File) {
  if (isNativeRuntime()) {
    try {
      return await nativeUploadProfilePhoto(file);
    } catch (error) {
      console.warn('[profile-service] Native profile photo upload failed, falling back to SDK upload:', error);
    }
  }

  try {
    return await withTimeout(uploadUserPhoto(file) as Promise<string>, 'Profile photo upload', nativeImageUploadTimeoutMs);
  } catch (error) {
    console.warn('[profile-service] Falling back to REST profile photo upload:', error);
    return nativeUploadProfilePhoto(file);
  }
}

function readImageUploadSession(): ImageUploadSession | null {
  try {
    const raw = window.localStorage?.getItem(imageUploadSessionKey);
    return raw ? JSON.parse(raw) as ImageUploadSession : null;
  } catch {
    return null;
  }
}

function writeImageUploadSession(session: ImageUploadSession) {
  try {
    window.localStorage?.setItem(imageUploadSessionKey, JSON.stringify(session));
  } catch (error) {
    console.warn('[profile-service] Unable to persist image upload auth session:', error);
  }
}

// Firebase web API keys are public project identifiers. Security is enforced by Firebase Auth and Storage rules.
async function getImageUploadSession(apiKey: string): Promise<ImageUploadSession> {
  const current = readImageUploadSession();
  if (current?.apiKey === apiKey && current.idToken && current.refreshToken) {
    if (Number(current.expirationTime || 0) > Date.now() + 60000) {
      return current;
    }
    try {
      return await refreshImageUploadSession(current);
    } catch (error) {
      console.warn('[profile-service] Image upload auth refresh failed, creating a new anonymous session:', error);
    }
  }

  return createImageUploadSession(apiKey);
}

async function refreshImageUploadSession(session: ImageUploadSession): Promise<ImageUploadSession> {
  const response = await withTimeout(fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(session.apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken
    })
  }), 'Image upload auth refresh', profileTimeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Image upload auth refresh failed.');
  }

  const nextSession = {
    apiKey: session.apiKey,
    idToken: payload.id_token || session.idToken,
    refreshToken: payload.refresh_token || session.refreshToken,
    expirationTime: Date.now() + Math.max(Number.parseInt(payload.expires_in || '3600', 10) - 30, 60) * 1000
  };
  writeImageUploadSession(nextSession);
  return nextSession;
}

async function createImageUploadSession(apiKey: string): Promise<ImageUploadSession> {
  const response = await withTimeout(fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ returnSecureToken: true })
  }), 'Image upload auth', profileTimeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Image upload auth failed.');
  }

  const session = {
    apiKey,
    idToken: payload.idToken,
    refreshToken: payload.refreshToken,
    expirationTime: Date.now() + Math.max(Number.parseInt(payload.expiresIn || '3600', 10) - 30, 60) * 1000
  };
  if (!session.idToken || !session.refreshToken) {
    throw new Error('Image upload auth did not return a usable token.');
  }
  writeImageUploadSession(session);
  return session;
}

async function nativeUploadProfilePhoto(file: File) {
  const imageConfig = resolveImageFirebaseConfig();
  const bucket = imageConfig.storageBucket;
  if (!imageConfig.apiKey || !bucket) {
    throw new Error('Image upload Firebase config is missing.');
  }

  const session = await getImageUploadSession(imageConfig.apiKey);
  const safeName = String(file.name || 'profile-photo').replace(/[^\w.-]+/g, '_');
  const path = `user-photos/${Date.now()}_${safeName}`;
  const response = await withTimeout(fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: file
  }), 'Profile photo upload', nativeImageUploadTimeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Profile photo upload failed (${response.status}).`);
  }

  const token = payload.downloadTokens || payload.metadata?.firebaseStorageDownloadTokens;
  if (token) {
    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(payload.name || path)}?alt=media&token=${encodeURIComponent(String(token).split(',')[0])}`;
  }

  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(payload.name || path)}?alt=media`;
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
    console.warn('[profile-service] Falling back to REST notification team load:', error);
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
    console.warn('[profile-service] Falling back to REST parent team load:', error);
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
    console.warn('[profile-service] Falling back to REST notification preference load:', error);
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
    console.warn('[profile-service] Falling back to REST notification preference save:', error);
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
    console.warn('[profile-service] Falling back to REST notification device save:', error);
    return nativeSaveNotificationDeviceToken(userId, input);
  }
}

export async function createProfileAccessCode(userId: string, email: string, phone: string) {
  const code = generateAccessCode();
  try {
    await withTimeout(Promise.resolve(createAccessCode(userId, email, phone, code)), 'Invite code create', primaryDataTimeoutMs);
  } catch (error) {
    console.warn('[profile-service] Falling back to REST invite code create:', error);
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
    console.warn('[profile-service] Falling back to REST account merge request:', error);
    return nativeCreateAccountMergeRequest(userId, normalizedPrimaryEmail, normalizedSecondaryEmail);
  }
}

export async function loadProfileAccessCodes(userId: string): Promise<AccessCodeRecord[]> {
  try {
    return await withTimeout(getUserAccessCodes(userId) as Promise<AccessCodeRecord[]>, 'Invite history load', primaryDataTimeoutMs);
  } catch (error) {
    console.warn('[profile-service] Falling back to REST invite history load:', error);
    return nativeLoadAccessCodes(userId);
  }
}
