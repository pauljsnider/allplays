import { CapacitorHttp } from '@capacitor/core';

import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';

const defaultNativeCallableTimeoutMs = 8000;

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

export async function callNativeFirebaseFunction<T = unknown>(
  functionName: string,
  data: Record<string, unknown>,
  options: NativeCallableOptions = {}
): Promise<T> {
  // Keep the authenticated transport reusable during auth bootstrap without a
  // static authService cycle. Normal callers still use the current native token.
  const { firebaseAuth, getNativeAuthIdToken } = await import('./authService');
  const idToken = await getNativeAuthIdToken(true);
  return callNativeFirebaseFunctionWithAuth<T>(functionName, data, {
    projectId: String(firebaseAuth.app?.options?.projectId || ''),
    idToken: String(idToken || '')
  }, options);
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
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Math.floor(Number(options.timeoutMs))
    : defaultNativeCallableTimeoutMs;
  const response = await CapacitorHttp.post({
    url: requestUrl,
    headers: await getPrimaryAppCheckHeaders({
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    }, requestUrl) as Record<string, string>,
    data: { data },
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs
  });
  const payload = getCallablePayload(response.data);
  if (response.status < 200 || response.status >= 300) {
    const label = String(options.errorLabel || 'Native request').trim() || 'Native request';
    const error = payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
      ? payload.error as Record<string, unknown>
      : {};
    const message = typeof error.message === 'string' ? error.message : '';
    throw new Error(message || `${label} failed (${response.status}).`);
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'result') && !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(`${String(options.errorLabel || 'Native request').trim() || 'Native request'} response is invalid.`);
  }
  return (Object.prototype.hasOwnProperty.call(payload, 'result') ? payload.result : payload.data) as T;
}
