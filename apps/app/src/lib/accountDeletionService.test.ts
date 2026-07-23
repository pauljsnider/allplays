import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  getNativeAuthIdToken: vi.fn(),
  getPrimaryAppCheckHeaders: vi.fn(async (headers) => headers),
  httpsCallable: vi.fn(),
  isNativeRuntime: vi.fn()
}));

vi.mock('./adapters/legacyAccountDb', () => ({
  functions: { name: 'functions' },
  httpsCallable: mocks.httpsCallable
}));

vi.mock('./adapters/legacyFirebaseAppCheck', () => ({
  getPrimaryAppCheckHeaders: mocks.getPrimaryAppCheckHeaders
}));

vi.mock('./authService', () => ({
  firebaseAuth: {
    app: {
      options: {
        projectId: 'all-plays-test'
      }
    }
  },
  getNativeAuthIdToken: mocks.getNativeAuthIdToken
}));

vi.mock('./nativeRuntime', () => ({
  isNativeRuntime: mocks.isNativeRuntime
}));

import { requestAccountDeletion } from './accountDeletionService';

describe('accountDeletionService', () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.getNativeAuthIdToken.mockReset();
    mocks.getPrimaryAppCheckHeaders.mockClear();
    mocks.httpsCallable.mockReset();
    mocks.isNativeRuntime.mockReset();
    mocks.isNativeRuntime.mockReturnValue(false);
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    vi.unstubAllGlobals();
  });

  it('sends an explicit permanent deletion confirmation', async () => {
    mocks.callable.mockResolvedValue({ data: { success: true, status: 'queued', completionTargetDays: 30 } });
    await expect(requestAccountDeletion('ios')).resolves.toEqual({
      success: true,
      status: 'queued',
      completionTargetDays: 30
    });
    expect(mocks.httpsCallable).toHaveBeenCalledWith({ name: 'functions' }, 'requestAccountDeletion');
    expect(mocks.callable).toHaveBeenCalledWith({ confirmation: 'DELETE', source: 'ios' });
  });

  it('authenticates native REST sessions when requesting deletion', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: { success: true, status: 'queued', completionTargetDays: 30 }
      })
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAccountDeletion('android')).resolves.toEqual({
      success: true,
      status: 'queued',
      completionTargetDays: 30
    });
    expect(mocks.getNativeAuthIdToken).toHaveBeenCalledWith(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://us-central1-all-plays-test.cloudfunctions.net/requestAccountDeletion',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer native-id-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          data: {
            confirmation: 'DELETE',
            source: 'android'
          }
        })
      })
    );
    expect(mocks.httpsCallable).not.toHaveBeenCalled();
  });

  it('rejects native deletion when no authenticated token is available', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue(null);

    await expect(requestAccountDeletion('ios')).rejects.toThrow('Native auth token is unavailable.');
  });

  it('surfaces callable errors from the native authenticated endpoint', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({
        error: { message: 'Transfer owned teams before deleting your account.' }
      })
    })));

    await expect(requestAccountDeletion('ios')).rejects.toThrow(
      'Transfer owned teams before deleting your account.'
    );
  });
});
