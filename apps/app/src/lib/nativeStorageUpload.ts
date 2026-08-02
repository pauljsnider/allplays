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

export function buildNativeProfilePhotoFileName(fileName: unknown, timestamp = Date.now()) {
  const safeFileName = sanitizeNativeStorageSegment(fileName, '');
  const extensionMatch = safeFileName.match(/\.([A-Za-z0-9]{1,10})$/);
  const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : '';
  return `${timestamp}_profile-photo${extension}`;
}

async function runNativeStorageOperation<T>({
  timeoutMs,
  timeoutMessage,
  operation
}: {
  timeoutMs: number;
  timeoutMessage: string;
  operation: (signal: AbortSignal) => Promise<T>;
}) {
  const abortController = new AbortController();
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      abortController.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(abortController.signal), timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
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
  return runNativeStorageOperation({
    timeoutMs,
    timeoutMessage: `${label} upload timed out. Check your connection and try again.`,
    operation: async (signal) => {
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
      const headers = await getPrimaryAppCheckHeaders({
        Authorization: `Bearer ${idToken}`,
        'Content-Type': file.type || 'application/octet-stream'
      }, requestUrl);
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body: file,
        signal
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
  });
}

export async function uploadNativeUserProfilePhoto(file: File, uid = '') {
  const privateFileName = buildNativeProfilePhotoFileName(file.name);
  let reservedPath = '';
  try {
    return await uploadNativePrimaryStorageFile({
      file,
      label: 'Profile photo',
      timeoutMs: 20000,
      buildPath: (userId) => {
        if (uid && uid !== userId) {
          throw new Error('The signed-in account does not match this profile photo upload.');
        }
        reservedPath = `profile-photos/users/${userId}/${privateFileName}`;
        return reservedPath;
      }
    });
  } catch (error) {
    if (reservedPath) {
      await deleteNativePrimaryStorageFile(reservedPath).catch(() => undefined);
    }
    throw error;
  }
}

export async function uploadNativePlayerPhotoFile(file: File, teamId: string, playerId: string) {
  const safeTeamId = sanitizeNativeStorageSegment(teamId, '');
  const safePlayerId = sanitizeNativeStorageSegment(playerId, '');
  if (!safeTeamId || !safePlayerId) {
    throw new Error('Team and player are required for a player photo upload.');
  }
  const privateFileName = buildNativeProfilePhotoFileName(file.name);
  return uploadNativePrimaryStorageFile({
    file,
    label: 'Player photo',
    timeoutMs: 20000,
    buildPath: () => (
      `profile-photos/teams/${safeTeamId}/players/${safePlayerId}/${privateFileName}`
    )
  });
}

export async function uploadNativePlayerPhoto(file: File, teamId: string, playerId: string) {
  return uploadNativePlayerPhotoFile(file, teamId, playerId);
}

export async function uploadNativeTeamPhotoFile(file: File, teamId: string) {
  const safeTeamId = sanitizeNativeStorageSegment(teamId, '');
  if (!safeTeamId) throw new Error('Team is required for a team photo upload.');
  const privateFileName = buildNativeProfilePhotoFileName(file.name);
  return uploadNativePrimaryStorageFile({
    file,
    label: 'Team photo',
    timeoutMs: 20000,
    buildPath: () => (
      `profile-photos/teams/${safeTeamId}/team/${privateFileName}`
    )
  });
}

export async function deleteNativePrimaryStorageFile(path: string, timeoutMs = defaultCleanupTimeoutMs) {
  const bucket = firebaseAuth.app?.options?.storageBucket;
  const normalizedPath = String(path || '').trim();
  if (!bucket || !normalizedPath || normalizedPath.startsWith('/') || normalizedPath.includes('..')) {
    throw new Error('Storage cleanup path is invalid.');
  }
  const requestUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(normalizedPath)}`;
  await runNativeStorageOperation({
    timeoutMs,
    timeoutMessage: 'Storage cleanup timed out.',
    operation: async (signal) => {
      const idToken = await getNativeAuthIdToken(true);
      if (!idToken) throw new Error('Native auth token is unavailable.');
      const headers = await getPrimaryAppCheckHeaders({ Authorization: `Bearer ${idToken}` }, requestUrl);
      const response = await fetch(requestUrl, {
        method: 'DELETE',
        headers,
        signal
      });
      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error?.message || `Storage cleanup failed (${response.status}).`);
      }
    }
  });
}
