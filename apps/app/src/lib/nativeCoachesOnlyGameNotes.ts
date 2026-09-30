import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import { firebaseAuth, getNativeAuthIdToken, getNativeAuthUserId } from './authService';
import { COACHES_ONLY_GAME_NOTE_MAX_LENGTH } from './coachesOnlyGameNotesContract';

const nativeCoachesOnlyGameNoteTimeoutMs = 12_000;
const firestoreDocumentIdMaximumBytes = 1_500;

export type NativeCoachesOnlyGameNote = {
  exists: boolean;
  text: string;
  updatedAt: Date | null;
  updatedBy: string | null;
};

export class NativeCoachesOnlyGameNoteSaveUncertainError extends Error {
  readonly commitStateUnknown = true;
  readonly mayHaveSaved = true;
  readonly cause: unknown;

  constructor(options: { cause?: unknown } = {}) {
    super('The private note may have saved, but confirmation is unavailable. Reload it before trying again.');
    this.name = 'NativeCoachesOnlyGameNoteSaveUncertainError';
    this.cause = options.cause;
  }
}

type NativeRequestResult = {
  response: Response;
  payload: Record<string, unknown>;
};

class NativeCoachesOnlyGameNoteRequestError extends Error {
  readonly requestDispatched: boolean;
  readonly responseReceived: boolean;
  readonly status: number | null;
  readonly cause: unknown;

  constructor(
    message: string,
    {
      cause,
      requestDispatched,
      responseReceived,
      status
    }: {
      cause?: unknown;
      requestDispatched: boolean;
      responseReceived: boolean;
      status: number | null;
    }
  ) {
    super(message);
    this.name = 'NativeCoachesOnlyGameNoteRequestError';
    this.requestDispatched = requestDispatched;
    this.responseReceived = responseReceived;
    this.status = status;
    this.cause = cause;
  }
}

function getProjectId() {
  const value = firebaseAuth.app?.options?.projectId;
  const projectId = typeof value === 'string' ? value.trim() : '';
  if (!projectId) throw new Error('Firebase project ID is missing.');
  return projectId;
}

function getUtf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function validatePathSegment(value: unknown, label: string) {
  if (typeof value !== 'string' || !value || value.includes('/') || getUtf8ByteLength(value) > firestoreDocumentIdMaximumBytes) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function validateDocumentPath(pathSegments: readonly string[]) {
  if (!Array.isArray(pathSegments) || pathSegments.length !== 6 || pathSegments[4] !== 'coachNotes') {
    throw new Error('Coaches-only note document path is invalid.');
  }

  if (pathSegments[0] === 'teams' && pathSegments[2] === 'games' && pathSegments[5] === 'main') {
    return [
      'teams',
      validatePathSegment(pathSegments[1], 'Team ID'),
      'games',
      validatePathSegment(pathSegments[3], 'Game ID'),
      'coachNotes',
      'main'
    ] as const;
  }

  if ((pathSegments[0] === 'organizations' || pathSegments[0] === 'tournaments') && pathSegments[2] === 'sharedGames') {
    return [
      pathSegments[0],
      validatePathSegment(pathSegments[1], 'Shared game scope ID'),
      'sharedGames',
      validatePathSegment(pathSegments[3], 'Shared game ID'),
      'coachNotes',
      validatePathSegment(pathSegments[5], 'Team ID')
    ] as const;
  }

  throw new Error('Coaches-only note document path is invalid.');
}

function validateUserId(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 128 || value.includes('/')) {
    throw new Error('User ID is invalid.');
  }
  return value;
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error('Coaches-only note text must be a string.');
  }
  const normalized = value.replace(/\r\n?/g, '\n');
  if (normalized.length > Number(COACHES_ONLY_GAME_NOTE_MAX_LENGTH)) {
    throw new Error(`Coaches-only note text cannot exceed ${COACHES_ONLY_GAME_NOTE_MAX_LENGTH} characters.`);
  }
  return normalized;
}

function normalizeTimeoutMs(value: number | undefined) {
  if (value === undefined) return nativeCoachesOnlyGameNoteTimeoutMs;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Native coaches-only note timeout is invalid.');
  }
  return Math.floor(value);
}

function assertCurrentNativeCaller(expectedUserId: string) {
  const currentUserId = getNativeAuthUserId();
  if (!currentUserId) {
    throw new Error('Native auth user is unavailable.');
  }
  if (currentUserId !== expectedUserId) {
    throw new Error('Native auth user does not match the coaches-only note caller.');
  }
}

function buildFirestoreDocumentUrl(projectId: string, pathSegments: readonly string[]) {
  const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodedPath}`;
}

function buildFirestoreCommitUrl(projectId: string) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`;
}

function buildFirestoreDocumentName(projectId: string, pathSegments: readonly string[]) {
  return `projects/${projectId}/databases/(default)/documents/${pathSegments.join('/')}`;
}

async function getNativeHeaders(requestUrl: string, expectedUserId: string, forceRefresh: boolean) {
  assertCurrentNativeCaller(expectedUserId);
  const token = await getNativeAuthIdToken(forceRefresh);
  assertCurrentNativeCaller(expectedUserId);
  if (!token) throw new Error('Native auth token is unavailable.');
  const headers = await getPrimaryAppCheckHeaders(
    {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    requestUrl
  );
  assertCurrentNativeCaller(expectedUserId);
  return headers;
}

async function executeNativeRequest({
  requestUrl,
  expectedUserId,
  forceRefresh,
  init,
  parseSuccessfulResponse,
  timeoutMs
}: {
  requestUrl: string;
  expectedUserId: string;
  forceRefresh: boolean;
  init: RequestInit;
  parseSuccessfulResponse: boolean;
  timeoutMs: number;
}): Promise<NativeRequestResult> {
  const abortController = new AbortController();
  let timeoutId: number | undefined;
  let requestDispatched = false;
  let responseReceived = false;
  let status: number | null = null;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      abortController.abort();
      reject(
        new NativeCoachesOnlyGameNoteRequestError(
          requestDispatched
            ? 'The native coaches-only note request timed out and may have completed.'
            : 'The native coaches-only note request timed out before it was sent.',
          { requestDispatched, responseReceived, status }
        )
      );
    }, timeoutMs);
  });

  const request = (async () => {
    try {
      const headers = await getNativeHeaders(requestUrl, expectedUserId, forceRefresh);
      if (abortController.signal.aborted) {
        throw new Error('The native coaches-only note request was cancelled before it was sent.');
      }
      requestDispatched = true;
      const response = await fetch(requestUrl, {
        ...init,
        headers: {
          ...headers,
          ...(init.headers || {})
        },
        signal: abortController.signal
      });
      responseReceived = true;
      status = response.status;
      const shouldParse = parseSuccessfulResponse || !response.ok;
      const payload = shouldParse && typeof response.json === 'function' ? await response.json().catch(() => ({})) : {};
      assertCurrentNativeCaller(expectedUserId);
      return { response, payload: payload && typeof payload === 'object' ? payload : {} };
    } catch (error) {
      if (error instanceof NativeCoachesOnlyGameNoteRequestError) throw error;
      throw new NativeCoachesOnlyGameNoteRequestError(String((error as Error)?.message || 'Native coaches-only note request failed.'), {
        cause: error,
        requestDispatched,
        responseReceived,
        status
      });
    }
  })();

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function executeWithOneAuthRefresh(options: Omit<Parameters<typeof executeNativeRequest>[0], 'forceRefresh'>) {
  let result = await executeNativeRequest({ ...options, forceRefresh: false });
  if (result.response.status === 401) {
    result = await executeNativeRequest({ ...options, forceRefresh: true });
  }
  return result;
}

function getFirestoreHttpError(result: NativeRequestResult, fallbackMessage: string) {
  const responseError = result.payload.error as { message?: unknown } | undefined;
  const message = typeof responseError?.message === 'string' ? responseError.message : fallbackMessage;
  const error = new Error(message) as Error & { status?: number };
  error.status = result.response.status;
  return error;
}

function decodeNoteDocument(payload: Record<string, unknown>): NativeCoachesOnlyGameNote {
  const fields = payload.fields as Record<string, { stringValue?: unknown; timestampValue?: unknown }> | undefined;
  const textValue = fields?.text?.stringValue;
  const updatedByValue = fields?.updatedBy?.stringValue;
  const updatedAtValue = fields?.updatedAt?.timestampValue;
  const updatedAt = typeof updatedAtValue === 'string' ? new Date(updatedAtValue) : null;

  if (
    typeof payload?.name !== 'string' ||
    typeof textValue !== 'string' ||
    typeof updatedByValue !== 'string' ||
    !updatedAt ||
    Number.isNaN(updatedAt.getTime())
  ) {
    throw new Error('Native coaches-only note response is invalid.');
  }

  return {
    exists: true,
    text: normalizeText(textValue),
    updatedAt,
    updatedBy: validateUserId(updatedByValue)
  };
}

export async function loadNativeCoachesOnlyGameNote(
  pathSegments: readonly string[],
  userId: string,
  timeoutMs?: number
): Promise<NativeCoachesOnlyGameNote> {
  const canonicalPath = validateDocumentPath(pathSegments);
  const expectedUserId = validateUserId(userId);
  const requestTimeoutMs = normalizeTimeoutMs(timeoutMs);
  assertCurrentNativeCaller(expectedUserId);
  const requestUrl = buildFirestoreDocumentUrl(getProjectId(), canonicalPath);
  const result = await executeWithOneAuthRefresh({
    requestUrl,
    expectedUserId,
    init: { method: 'GET' },
    parseSuccessfulResponse: true,
    timeoutMs: requestTimeoutMs
  });

  if (result.response.status === 404) {
    return {
      exists: false,
      text: '',
      updatedAt: null,
      updatedBy: null
    };
  }
  if (!result.response.ok) {
    throw getFirestoreHttpError(result, `Firestore note read failed (${result.response.status}).`);
  }
  return decodeNoteDocument(result.payload);
}

function buildCommitBody(projectId: string, pathSegments: readonly string[], text: string, userId: string) {
  return {
    writes: [
      {
        update: {
          name: buildFirestoreDocumentName(projectId, pathSegments),
          fields: {
            text: { stringValue: text },
            updatedBy: { stringValue: userId }
          }
        },
        updateMask: {
          fieldPaths: ['text', 'updatedBy']
        },
        updateTransforms: [
          {
            fieldPath: 'updatedAt',
            setToServerValue: 'REQUEST_TIME'
          }
        ]
      }
    ]
  };
}

function isAmbiguousWriteFailure(error: unknown) {
  if (!(error instanceof NativeCoachesOnlyGameNoteRequestError)) return false;
  if (!error.requestDispatched) return false;
  if (!error.responseReceived) return true;
  return (
    error.status === null ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500 ||
    (error.status >= 200 && error.status < 300)
  );
}

function isAmbiguousHttpStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function reconcileAmbiguousSave(pathSegments: readonly string[], userId: string, text: string, timeoutMs: number) {
  try {
    const current = await loadNativeCoachesOnlyGameNote(pathSegments, userId, timeoutMs);
    if (current.exists && current.text === text && current.updatedBy === userId) {
      return { text, updatedBy: userId };
    }
    throw new Error('The exact note read did not confirm the ambiguous save.');
  } catch (error) {
    throw new NativeCoachesOnlyGameNoteSaveUncertainError({ cause: error });
  }
}

export async function saveNativeCoachesOnlyGameNote(pathSegments: readonly string[], userId: string, text: string, timeoutMs?: number) {
  const canonicalPath = validateDocumentPath(pathSegments);
  const expectedUserId = validateUserId(userId);
  const normalizedText = normalizeText(text);
  const requestTimeoutMs = normalizeTimeoutMs(timeoutMs);
  assertCurrentNativeCaller(expectedUserId);
  const projectId = getProjectId();
  const requestUrl = buildFirestoreCommitUrl(projectId);
  const body = buildCommitBody(projectId, canonicalPath, normalizedText, expectedUserId);

  let result: NativeRequestResult;
  try {
    result = await executeWithOneAuthRefresh({
      requestUrl,
      expectedUserId,
      init: {
        method: 'POST',
        body: JSON.stringify(body)
      },
      parseSuccessfulResponse: false,
      timeoutMs: requestTimeoutMs
    });
  } catch (error) {
    if (!isAmbiguousWriteFailure(error)) throw error;
    return reconcileAmbiguousSave(canonicalPath, expectedUserId, normalizedText, requestTimeoutMs);
  }

  if (result.response.ok) {
    return { text: normalizedText, updatedBy: expectedUserId };
  }
  if (isAmbiguousHttpStatus(result.response.status)) {
    return reconcileAmbiguousSave(canonicalPath, expectedUserId, normalizedText, requestTimeoutMs);
  }
  throw getFirestoreHttpError(result, `Firestore note save failed (${result.response.status}).`);
}
