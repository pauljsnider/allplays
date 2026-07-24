import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  getNativeAuthIdToken: vi.fn(),
  getNativeAuthUserId: vi.fn(),
  getPrimaryAppCheckHeaders: vi.fn(async (headers) => headers),
  getWebAuthIdToken: vi.fn(),
  httpsCallable: vi.fn(),
  isNativeRuntime: vi.fn(),
  reauthenticateCurrentUserForDeletion: vi.fn(),
  revokeCurrentAppleAuthorizationForDeletion: vi.fn()
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
    },
    currentUser: null as null | { getIdToken: typeof mocks.getWebAuthIdToken }
  },
  getNativeAuthIdToken: mocks.getNativeAuthIdToken,
  getNativeAuthUserId: mocks.getNativeAuthUserId,
  reauthenticateCurrentUserForDeletion: mocks.reauthenticateCurrentUserForDeletion,
  revokeCurrentAppleAuthorizationForDeletion: mocks.revokeCurrentAppleAuthorizationForDeletion
}));

vi.mock('./nativeRuntime', () => ({
  isNativeRuntime: mocks.isNativeRuntime
}));

import { requestAccountDeletion } from './accountDeletionService';

describe('accountDeletionService', () => {
  beforeEach(async () => {
    mocks.callable.mockReset();
    mocks.getNativeAuthIdToken.mockReset();
    mocks.getNativeAuthUserId.mockReset();
    mocks.getNativeAuthUserId.mockReturnValue('user-1');
    mocks.getPrimaryAppCheckHeaders.mockClear();
    mocks.getWebAuthIdToken.mockReset();
    mocks.httpsCallable.mockReset();
    mocks.isNativeRuntime.mockReset();
    mocks.reauthenticateCurrentUserForDeletion.mockReset();
    mocks.reauthenticateCurrentUserForDeletion.mockResolvedValue({ appleAuthorizationRevoked: false });
    mocks.revokeCurrentAppleAuthorizationForDeletion.mockReset();
    mocks.revokeCurrentAppleAuthorizationForDeletion.mockResolvedValue(undefined);
    const { firebaseAuth } = await import('./authService');
    firebaseAuth.currentUser = null;
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

  it('reauthenticates an ordinary long-lived session before retrying deletion', async () => {
    mocks.callable
      .mockResolvedValueOnce({
        data: {
          success: false,
          status: 'requires-recent-auth',
          provider: 'password',
          completionTargetDays: 30
        }
      })
      .mockResolvedValueOnce({
        data: { success: true, status: 'queued', completionTargetDays: 30 }
      });

    await expect(requestAccountDeletion('web-app', 'correct horse')).resolves.toMatchObject({
      status: 'queued'
    });
    expect(mocks.reauthenticateCurrentUserForDeletion).toHaveBeenCalledWith('password', 'correct horse');
    expect(mocks.callable).toHaveBeenCalledTimes(2);
  });

  it('cancels deletion when provider reauthentication selects a different account', async () => {
    mocks.callable.mockResolvedValueOnce({
      data: {
        success: false,
        status: 'requires-recent-auth',
        provider: 'google',
        completionTargetDays: 30
      }
    });
    mocks.getNativeAuthUserId
      .mockReturnValueOnce('user-1')
      .mockReturnValueOnce('user-2');

    await expect(requestAccountDeletion('web-app')).rejects.toThrow(
      'Account deletion was cancelled because reauthentication selected a different account.'
    );
    expect(mocks.reauthenticateCurrentUserForDeletion).toHaveBeenCalledWith('google', '');
    expect(mocks.callable).toHaveBeenCalledTimes(1);
  });

  it('authenticates native REST sessions when requesting deletion', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: { success: true, status: 'queued', completionTargetDays: 30 }
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

  it('preflights Apple deletion, revokes a fresh authorization code, then queues deletion', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { success: false, status: 'requires-apple-reauth', completionTargetDays: 30 }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { success: true, status: 'queued', completionTargetDays: 30 }
        })
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAccountDeletion('ios')).resolves.toMatchObject({ status: 'queued' });

    expect(mocks.revokeCurrentAppleAuthorizationForDeletion).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      data: {
        confirmation: 'DELETE',
        source: 'ios',
        appleAuthorizationRevoked: true
      }
    });
  });

  it('rejects native deletion when no authenticated token is available', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue(null);

    await expect(requestAccountDeletion('ios')).rejects.toThrow('Native auth token is unavailable.');
  });

  it('falls back to the Web SDK token after native email/password signup', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue(null);
    mocks.getWebAuthIdToken.mockResolvedValue('web-id-token');
    const { firebaseAuth } = await import('./authService');
    firebaseAuth.currentUser = { getIdToken: mocks.getWebAuthIdToken };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: { success: true, status: 'queued', completionTargetDays: 30 }
      })
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAccountDeletion('ios')).resolves.toEqual({
      success: true,
      status: 'queued',
      completionTargetDays: 30
    });
    expect(mocks.getNativeAuthIdToken).toHaveBeenCalledWith(true);
    expect(mocks.getWebAuthIdToken).toHaveBeenCalledWith(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://us-central1-all-plays-test.cloudfunctions.net/requestAccountDeletion',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer web-id-token'
        })
      })
    );
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
