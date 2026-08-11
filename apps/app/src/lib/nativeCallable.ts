import { CapacitorHttp } from '@capacitor/core';

import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import { firebaseAuth, getNativeAuthIdToken } from './authService';

const defaultNativeCallableTimeoutMs = 8000;

function getProjectId() {
  const projectId = String(firebaseAuth.app?.options?.projectId || '').trim();
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
  options: { timeoutMs?: number; errorLabel?: string } = {}
): Promise<T> {
  const projectId = getProjectId();
  const normalizedFunctionName = getFunctionName(functionName);
  const token = await getNativeAuthIdToken(true);
  if (!token) throw new Error('Native auth token is unavailable.');
  const requestUrl = `https://us-central1-${projectId}.cloudfunctions.net/${normalizedFunctionName}`;
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Math.floor(Number(options.timeoutMs))
    : defaultNativeCallableTimeoutMs;
  const response = await CapacitorHttp.post({
    url: requestUrl,
    headers: await getPrimaryAppCheckHeaders({
      Authorization: `Bearer ${token}`,
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
