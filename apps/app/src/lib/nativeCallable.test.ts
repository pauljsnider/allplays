import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpMocks = vi.hoisted(() => ({ post: vi.fn() }));
const authMocks = vi.hoisted(() => ({
  getNativeAuthIdToken: vi.fn(),
  firebaseAuth: { app: { options: { projectId: 'demo-project' } } }
}));
const appCheckMocks = vi.hoisted(() => ({
  getPrimaryAppCheckHeaders: vi.fn(async (headers: Record<string, string>) => ({
    ...headers,
    'X-Firebase-AppCheck': 'debug-app-check'
  }))
}));

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { post: httpMocks.post } }));
vi.mock('./authService', () => authMocks);
vi.mock('./adapters/legacyFirebaseAppCheck', () => appCheckMocks);

import { callNativeFirebaseFunction, callNativeFirebaseFunctionWithAuth } from './nativeCallable';

describe('native callable transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
  });

  it('attaches native auth and App Check with bounded timeouts', async () => {
    httpMocks.post.mockResolvedValue({ status: 200, data: { result: { ok: true } } });

    await expect(callNativeFirebaseFunction('exampleCallable', { itemId: 'item-1' })).resolves.toEqual({ ok: true });
    expect(httpMocks.post).toHaveBeenCalledWith({
      url: 'https://us-central1-demo-project.cloudfunctions.net/exampleCallable',
      headers: expect.objectContaining({
        Authorization: 'Bearer native-id-token',
        'X-Firebase-AppCheck': 'debug-app-check'
      }),
      data: { data: { itemId: 'item-1' } },
      connectTimeout: 8000,
      readTimeout: 8000
    });
  });

  it('reuses the same transport during native auth bootstrap without importing auth recursively', async () => {
    httpMocks.post.mockResolvedValue({ status: 200, data: { result: { customToken: 'web-custom-token' } } });

    await expect(
      callNativeFirebaseFunctionWithAuth(
        'createNativeWebAuthToken',
        {},
        { projectId: 'demo-project', idToken: 'bootstrap-native-token' },
        { timeoutMs: 3500, errorLabel: 'Native WebView authentication' }
      )
    ).resolves.toEqual({ customToken: 'web-custom-token' });

    expect(authMocks.getNativeAuthIdToken).not.toHaveBeenCalled();
    expect(httpMocks.post).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer bootstrap-native-token' }),
        connectTimeout: 3500,
        readTimeout: 3500
      })
    );
  });

  it('fails closed for invalid names, missing tokens, and malformed responses', async () => {
    await expect(callNativeFirebaseFunction('../unsafe', {})).rejects.toThrow('function name is invalid');
    expect(httpMocks.post).not.toHaveBeenCalled();

    authMocks.getNativeAuthIdToken.mockResolvedValueOnce('');
    await expect(callNativeFirebaseFunction('exampleCallable', {})).rejects.toThrow('auth token');

    httpMocks.post.mockResolvedValueOnce({ status: 200, data: {} });
    await expect(callNativeFirebaseFunction('exampleCallable', {}, { errorLabel: 'Example' })).rejects.toThrow(
      'Example response is invalid'
    );
  });

  it.each([
    {
      label: 'object',
      data: {
        error: {
          status: 'RESOURCE_EXHAUSTED',
          message: 'Candidate lookup is active.',
          details: {
            reason: 'scorer-candidate-duplicate-active',
            retryable: true,
            retryAfterSeconds: 2,
            privatePayload: { email: 'private@example.test' }
          }
        }
      }
    },
    {
      label: 'JSON string',
      data: JSON.stringify({
        error: {
          status: 'RESOURCE_EXHAUSTED',
          message: 'Candidate lookup is active.',
          details: {
            reason: 'scorer-candidate-duplicate-active',
            retryable: true,
            retryAfterSeconds: 2,
            privatePayload: { email: 'private@example.test' }
          }
        }
      })
    }
  ])('preserves bounded callable code and safe details from a $label error', async ({ data }) => {
    httpMocks.post.mockResolvedValue({ status: 429, data });

    const error = (await callNativeFirebaseFunction('exampleCallable', {}).catch((caught) => caught)) as Error & {
      code?: string;
      details?: Record<string, unknown>;
    };
    expect(error).toMatchObject({
      message: 'Candidate lookup is active.',
      code: 'functions/resource-exhausted',
      details: {
        reason: 'scorer-candidate-duplicate-active',
        retryable: true,
        retryAfterSeconds: 2
      }
    });
    expect(error.details).not.toHaveProperty('privatePayload');
    expect(error).not.toHaveProperty('response');
  });

  it('uses a canonical HTTP fallback without attaching malformed callable details', async () => {
    httpMocks.post.mockResolvedValue({
      status: 403,
      data: JSON.stringify({
        error: {
          status: 'not a callable code',
          message: 'Access denied.',
          details: { reason: 'x'.repeat(129), retryable: 'yes' }
        }
      })
    });

    const error = (await callNativeFirebaseFunction('exampleCallable', {}).catch((caught) => caught)) as Error & {
      code?: string;
      details?: Record<string, unknown>;
    };
    expect(error).toMatchObject({ message: 'Access denied.', code: 'functions/permission-denied' });
    expect(error).not.toHaveProperty('details');
  });
});
