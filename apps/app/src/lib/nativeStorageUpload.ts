import { firebaseAuth, getNativeAuthIdToken, getNativeAuthUserId } from './authService';
import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';

const defaultUploadTimeoutMs = 25000;
const defaultCleanupTimeoutMs = 12000;

export type NativeStorageUploadResult = {
  url: string;
  path: string;
  userId: string;
  mimeType: string;
  sizeBytes: number | null;
};

export function sanitizeNativeStorageSegment(value: unknown, fallback: string) {
  return String(value || '')
    .trim()
    .replace(/[^\w.-]+/g, '_') || fallback;
}

export async function uploadNativePrimaryStorageFile({
  file,
  buildPath,
  label = 'Media',
  timeoutMs = defaultUploadTimeoutMs
}: {
  file: File;
  buildPath: (userId: string, safeFileName: string) => string;
  label?: string;
  timeoutMs?: number;
}): Promise<NativeStorageUploadResult> {
  const bucket = firebaseAuth.app?.options?.storageBucket;
  if (!bucket) {
    throw new Error('Primary Firebase Storage configuration is missing.');
  }

  const userId = getNativeAuthUserId();
  if (!userId) {
    throw new Error(`Sign in before uploading ${label.toLowerCase()}.`);
  }
  const idToken = await getNativeAuthIdToken(true);
  if (!idToken) {
    throw new Error('Native auth token is unavailable.');
  }

  const safeFileName = sanitizeNativeStorageSegment(file.name, 'media');
  const path = buildPath(sanitizeNativeStorageSegment(userId, 'unknown-user'), safeFileName);
  if (!path || path.startsWith('/') || path.includes('..')) {
    throw new Error(`${label} upload path is invalid.`);
  }

  const requestUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(path)}`;
  const abortController = new AbortController();
  let uploadTimeoutId: number | undefined;
  const uploadTimeout = new Promise<Response>((_, reject) => {
    uploadTimeoutId = window.setTimeout(() => {
      abortController.abort();
      reject(new Error(`${label} upload timed out. Check your connection and try again.`));
    }, timeoutMs);
  });
  const uploadRequest = fetch(requestUrl, {
    method: 'POST',
    headers: await getPrimaryAppCheckHeaders({
      Authorization: `Bearer ${idToken}`,
      'Content-Type': file.type || 'application/octet-stream'
    }, requestUrl),
    body: file,
    signal: abortController.signal
  });
  const response = await Promise.race([uploadRequest, uploadTimeout]).finally(() => {
    if (uploadTimeoutId) window.clearTimeout(uploadTimeoutId);
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `${label} upload failed (${response.status}).`);
  }

  const storedPath = String(payload.name || path);
  const token = payload.downloadTokens || payload.metadata?.firebaseStorageDownloadTokens;
  const url = token
    ? `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storedPath)}?alt=media&token=${encodeURIComponent(String(token).split(',')[0])}`
    : `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storedPath)}?alt=media`;

  return {
    url,
    path: storedPath,
    userId,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: Number.isFinite(file.size) ? file.size : null
  };
}

export async function uploadNativeUserProfilePhoto(file: File, uid = '') {
  const uploaded = await uploadNativePrimaryStorageFile({
    file,
    label: 'Profile photo',
    timeoutMs: 20000,
    buildPath: (userId, safeFileName) => {
      if (uid && uid !== userId) {
        throw new Error('The signed-in account does not match this profile photo upload.');
      }
      return `profile-photos/users/${userId}/${Date.now()}_${safeFileName}`;
    }
  });
  return uploaded.url;
}

export async function uploadNativePlayerPhotoFile(file: File, teamId: string, playerId: string) {
  const safeTeamId = sanitizeNativeStorageSegment(teamId, '');
  const safePlayerId = sanitizeNativeStorageSegment(playerId, '');
  if (!safeTeamId || !safePlayerId) {
    throw new Error('Team and player are required for a player photo upload.');
  }
  return uploadNativePrimaryStorageFile({
    file,
    label: 'Player photo',
    timeoutMs: 20000,
    buildPath: (userId, safeFileName) => (
      `profile-photos/teams/${safeTeamId}/players/${safePlayerId}/${userId}/${Date.now()}_${safeFileName}`
    )
  });
}

export async function uploadNativePlayerPhoto(file: File, teamId: string, playerId: string) {
  return (await uploadNativePlayerPhotoFile(file, teamId, playerId)).url;
}

export async function uploadNativeTeamPhotoFile(file: File, teamId: string) {
  const safeTeamId = sanitizeNativeStorageSegment(teamId, '');
  if (!safeTeamId) throw new Error('Team is required for a team photo upload.');
  return uploadNativePrimaryStorageFile({
    file,
    label: 'Team photo',
    timeoutMs: 20000,
    buildPath: (userId, safeFileName) => (
      `profile-photos/teams/${safeTeamId}/team/${userId}/${Date.now()}_${safeFileName}`
    )
  });
}

export async function deleteNativePrimaryStorageFile(path: string) {
  const bucket = firebaseAuth.app?.options?.storageBucket;
  const normalizedPath = String(path || '').trim();
  if (!bucket || !normalizedPath || normalizedPath.startsWith('/') || normalizedPath.includes('..')) {
    throw new Error('Storage cleanup path is invalid.');
  }
  const idToken = await getNativeAuthIdToken(true);
  if (!idToken) throw new Error('Native auth token is unavailable.');
  const requestUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(normalizedPath)}`;
  const headers = await getPrimaryAppCheckHeaders({ Authorization: `Bearer ${idToken}` }, requestUrl);
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(() => abortController.abort(), defaultCleanupTimeoutMs);
  try {
    const response = await fetch(requestUrl, {
      method: 'DELETE',
      headers,
      signal: abortController.signal
    });
    if (!response.ok && response.status !== 404) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error?.message || `Storage cleanup failed (${response.status}).`);
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Storage cleanup timed out.');
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
