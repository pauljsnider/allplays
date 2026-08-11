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

import { callNativeFirebaseFunction } from './nativeCallable';

describe('native callable transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
  });

  it('attaches native auth and App Check with bounded timeouts', async () => {
    httpMocks.post.mockResolvedValue({ status: 200, data: { result: { ok: true } } });

    await expect(callNativeFirebaseFunction('exampleCallable', { itemId: 'item-1' }))
      .resolves.toEqual({ ok: true });
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

  it('fails closed for invalid names, missing tokens, and malformed responses', async () => {
    await expect(callNativeFirebaseFunction('../unsafe', {})).rejects.toThrow('function name is invalid');
    expect(httpMocks.post).not.toHaveBeenCalled();

    authMocks.getNativeAuthIdToken.mockResolvedValueOnce('');
    await expect(callNativeFirebaseFunction('exampleCallable', {})).rejects.toThrow('auth token');

    httpMocks.post.mockResolvedValueOnce({ status: 200, data: {} });
    await expect(callNativeFirebaseFunction('exampleCallable', {}, { errorLabel: 'Example' }))
      .rejects.toThrow('Example response is invalid');
  });

  it('surfaces callable errors without returning partial data', async () => {
    httpMocks.post.mockResolvedValue({
      status: 403,
      data: JSON.stringify({ error: { message: 'Access denied.' } })
    });

    await expect(callNativeFirebaseFunction('exampleCallable', {})).rejects.toThrow('Access denied.');
  });
});
