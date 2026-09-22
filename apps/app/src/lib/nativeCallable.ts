import { CapacitorHttp } from '@capacitor/core';

import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';

const defaultNativeCallableTimeoutMs = 8000;
const maxCallableErrorMessageLength = 500;
const maxCallableErrorReasonLength = 128;
const callableErrorCodes = new Set([
  'aborted',
  'already-exists',
  'cancelled',
  'data-loss',
  'deadline-exceeded',
  'failed-precondition',
  'internal',
  'invalid-argument',
  'not-found',
  'out-of-range',
  'permission-denied',
  'resource-exhausted',
  'unauthenticated',
  'unavailable',
  'unimplemented',
  'unknown'
]);

type NativeCallableOptions = { timeoutMs?: number; errorLabel?: string };

type NativeCallableAuth = {
  projectId: string;
  idToken: string;
};

function getProjectId(value: unknown) {
  const projectId = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
    throw new Error('Firebase project ID is missing or invalid.');
  }
  return projectId;
}

function getFunctionName(value: string) {
  const functionName = String(value || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(functionName)) {
    throw new Error('Firebase function name is invalid.');
  }
  return functionName;
}

function getCallablePayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Invalid callable payloads use the same fail-closed response path below.
    }
  }
  return {};
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
    ? (value as Record<string, unknown>)
    : {};
}

function containsAsciiControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function callableErrorCode(value: unknown, httpStatus: number) {
  const normalized =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/^functions\//, '')
          .replace(/_/g, '-')
      : '';
  if (callableErrorCodes.has(normalized)) return `functions/${normalized}`;
  const byHttpStatus: Record<number, string> = {
    400: 'invalid-argument',
    401: 'unauthenticated',
    403: 'permission-denied',
    404: 'not-found',
    409: 'aborted',
    429: 'resource-exhausted',
    500: 'internal',
    503: 'unavailable',
    504: 'deadline-exceeded'
  };
  return `functions/${byHttpStatus[httpStatus] || 'unknown'}`;
}

function callableErrorDetails(value: unknown) {
  const source = plainRecord(value);
  const details: Record<string, unknown> = {};
  if (typeof source.reason === 'string') {
    const reason = source.reason.replace(/\s+/g, ' ').trim();
    if (reason && reason.length <= maxCallableErrorReasonLength && !containsAsciiControlCharacter(reason)) {
      details.reason = reason;
    }
  }
  if (typeof source.retryable === 'boolean') details.retryable = source.retryable;
  if (
    Number.isSafeInteger(source.retryAfterSeconds) &&
    Number(source.retryAfterSeconds) >= 0 &&
    Number(source.retryAfterSeconds) <= 86_400
  ) {
    details.retryAfterSeconds = source.retryAfterSeconds;
  }
  for (const field of ['authoritativeRevision', 'revision']) {
    if (Number.isSafeInteger(source[field]) && Number(source[field]) >= 0) details[field] = source[field];
  }
  return Object.keys(details).length ? details : undefined;
}

function nativeCallableError(value: unknown, httpStatus: number, label: string) {
  const source = plainRecord(value);
  const message =
    (typeof source.message === 'string' ? source.message.replace(/\s+/g, ' ').trim().slice(0, maxCallableErrorMessageLength) : '') ||
    `${label} failed (${httpStatus}).`;
  const details = callableErrorDetails(source.details);
  return Object.assign(new Error(message), {
    code: callableErrorCode(source.status, httpStatus),
    ...(details ? { details } : {})
  });
}

export async function callNativeFirebaseFunction<T = unknown>(
  functionName: string,
  data: Record<string, unknown>,
  options: NativeCallableOptions = {}
): Promise<T> {
  // Keep the authenticated transport reusable during auth bootstrap without a
  // static authService cycle. Normal callers still use the current native token.
  const { firebaseAuth, getNativeAuthIdToken } = await import('./authService');
  const idToken = await getNativeAuthIdToken(true);
  return callNativeFirebaseFunctionWithAuth<T>(
    functionName,
    data,
    {
      projectId: String(firebaseAuth.app?.options?.projectId || ''),
      idToken: String(idToken || '')
    },
    options
  );
}

export async function callNativeFirebaseFunctionWithAuth<T = unknown>(
  functionName: string,
  data: Record<string, unknown>,
  auth: NativeCallableAuth,
  options: NativeCallableOptions = {}
): Promise<T> {
  const projectId = getProjectId(auth.projectId);
  const normalizedFunctionName = getFunctionName(functionName);
  const idToken = String(auth.idToken || '').trim();
  if (!idToken) throw new Error('Native auth token is unavailable.');
  const requestUrl = `https://us-central1-${projectId}.cloudfunctions.net/${normalizedFunctionName}`;
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
      ? Math.floor(Number(options.timeoutMs))
      : defaultNativeCallableTimeoutMs;
  const response = await CapacitorHttp.post({
    url: requestUrl,
    headers: (await getPrimaryAppCheckHeaders(
      {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      requestUrl
    )) as Record<string, string>,
    data: { data },
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs
  });
  const payload = getCallablePayload(response.data);
  if (response.status < 200 || response.status >= 300) {
    const label = String(options.errorLabel || 'Native request').trim() || 'Native request';
    throw nativeCallableError(payload.error, response.status, label);
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'result') && !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(`${String(options.errorLabel || 'Native request').trim() || 'Native request'} response is invalid.`);
  }
  return (Object.prototype.hasOwnProperty.call(payload, 'result') ? payload.result : payload.data) as T;
}
