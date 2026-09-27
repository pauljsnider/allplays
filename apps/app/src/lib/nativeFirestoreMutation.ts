import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import { firebaseAuth, getNativeAuthIdToken } from './authService';

const nativeFirestoreWriteTimeoutMs = 12000;

export class NativeFirestoreCommitUncertainError extends Error {
  readonly commitStateUnknown = true;

  constructor() {
    super('The save timed out and may have completed. Refresh before trying again.');
    this.name = 'NativeFirestoreCommitUncertainError';
  }
}

export type NativeFirestoreWrite = {
  pathSegments: string[];
  data: Record<string, unknown>;
  createOnly?: boolean;
};

function getProjectId() {
  const projectId = firebaseAuth.app?.options?.projectId;
  if (!projectId) throw new Error('Firebase project ID is missing.');
  return projectId;
}

function normalizePathSegments(pathSegments: string[]) {
  const normalized = (Array.isArray(pathSegments) ? pathSegments : []).map((segment) => String(segment || '').trim());
  if (!normalized.length || normalized.some((segment) => !segment || segment.includes('/'))) {
    throw new Error('Firestore document path is invalid.');
  }
  if (normalized.length % 2 !== 0) {
    throw new Error('Firestore document path must identify a document.');
  }
  return normalized;
}

function encodeFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((entry) => encodeFirestoreValue(entry)) } };
  }
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Firestore numbers must be finite.');
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'object' && value) {
    return { mapValue: { fields: encodeFirestoreFields(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value ?? '') };
}

function encodeFirestoreFields(data: Record<string, unknown>) {
  return Object.entries(data).reduce<Record<string, Record<string, unknown>>>((fields, [key, value]) => {
    if (typeof value !== 'undefined') fields[key] = encodeFirestoreValue(value);
    return fields;
  }, {});
}

export function createNativeFirestoreDocumentId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export async function commitNativeFirestoreWrites(
  writes: NativeFirestoreWrite[],
  timeoutMs = nativeFirestoreWriteTimeoutMs
) {
  if (!Array.isArray(writes) || writes.length === 0) return;
  if (writes.length > 200) throw new Error('Native Firestore commit is too large.');

  const projectId = getProjectId();
  const requestUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`;
  const body = {
    writes: writes.map((write) => {
      const pathSegments = normalizePathSegments(write.pathSegments);
      const fields = encodeFirestoreFields(write.data || {});
      const fieldPaths = Object.keys(fields);
      if (!fieldPaths.length) throw new Error('Native Firestore write has no fields.');
      return {
        update: {
          name: `projects/${projectId}/databases/(default)/documents/${pathSegments.join('/')}`,
          fields
        },
        ...(write.createOnly
          ? { currentDocument: { exists: false } }
          : { updateMask: { fieldPaths } })
      };
    })
  };

  const abortController = new AbortController();
  let timeoutId: number | undefined;
  let requestDispatched = false;
  let responseReceived = false;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      abortController.abort();
      reject(requestDispatched
        ? new NativeFirestoreCommitUncertainError()
        : new Error('The save timed out before it was sent. Check your connection and try again.'));
    }, timeoutMs);
  });
  try {
    await Promise.race([timeout, (async () => {
      const idToken = await getNativeAuthIdToken(true);
      if (!idToken) throw new Error('Native auth token is unavailable.');
      const headers = await getPrimaryAppCheckHeaders({
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      }, requestUrl);
      requestDispatched = true;
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal
      });
      responseReceived = true;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message || `Firestore write failed (${response.status}).`);
      }
    })()]);
  } catch (error) {
    if (requestDispatched && !responseReceived && !(error instanceof NativeFirestoreCommitUncertainError)) {
      throw new NativeFirestoreCommitUncertainError();
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}
