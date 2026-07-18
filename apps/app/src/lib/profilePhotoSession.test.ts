// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const imageSessionMocks = vi.hoisted(() => ({
  clearImageUploadSession: vi.fn(),
  readImageUploadSession: vi.fn(),
  writeImageUploadSession: vi.fn()
}));

const profilePhotoDbMocks = vi.hoisted(() => ({
  resolveImageFirebaseConfig: vi.fn(() => ({
    apiKey: 'secondary-image-project-key',
    storageBucket: 'secondary-image-project.firebasestorage.app'
  })),
  uploadUserPhoto: vi.fn()
}));

vi.mock('./imageUploadSessionStore', () => imageSessionMocks);
vi.mock('./adapters/legacyProfilePhotoDb', () => profilePhotoDbMocks);
vi.mock('./nativeRuntime', () => ({ isNativeRuntime: () => true }));
vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { nativeUploadProfilePhoto } from './profilePhotoService';

const file = new File(['photo-bytes'], 'avatar.jpg', { type: 'image/jpeg' });

function response(ok: boolean, payload: Record<string, unknown>, status = ok ? 200 : 401) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload)
  } as unknown as Response;
}

describe('secondary-project profile photo auth session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageSessionMocks.clearImageUploadSession.mockResolvedValue(undefined);
    imageSessionMocks.writeImageUploadSession.mockResolvedValue(true);
  });

  it('clears an expired session after refresh failure and uploads with a newly issued anonymous token', async () => {
    imageSessionMocks.readImageUploadSession.mockResolvedValue({
      apiKey: 'secondary-image-project-key',
      idToken: 'expired-secondary-id-token',
      refreshToken: 'expired-secondary-refresh-token',
      expirationTime: Date.now() - 1
    });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(response(false, { error: { message: 'TOKEN_EXPIRED' } }))
      .mockResolvedValueOnce(
        response(true, {
          idToken: 'new-secondary-id-token',
          refreshToken: 'new-secondary-refresh-token',
          expiresIn: '3600'
        })
      )
      .mockResolvedValueOnce(
        response(true, {
          name: 'user-photos/avatar.jpg',
          downloadTokens: 'download-token'
        })
      );

    await expect(nativeUploadProfilePhoto(file)).resolves.toContain('download-token');

    expect(imageSessionMocks.clearImageUploadSession).toHaveBeenCalledOnce();
    expect(imageSessionMocks.writeImageUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'secondary-image-project-key',
        idToken: 'new-secondary-id-token',
        refreshToken: 'new-secondary-refresh-token'
      })
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=secondary-image-project-key',
      expect.any(Object)
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('secondary-image-project.firebasestorage.app'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer new-secondary-id-token',
          'Content-Type': 'image/jpeg'
        }
      })
    );
  });

  it('rotates an expired secondary refresh token before upload without creating another anonymous user', async () => {
    imageSessionMocks.readImageUploadSession.mockResolvedValue({
      apiKey: 'secondary-image-project-key',
      idToken: 'expired-secondary-id-token',
      refreshToken: 'old-secondary-refresh-token',
      expirationTime: Date.now() - 1
    });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(true, {
          id_token: 'rotated-secondary-id-token',
          refresh_token: 'rotated-secondary-refresh-token',
          expires_in: '3600'
        })
      )
      .mockResolvedValueOnce(
        response(true, {
          name: 'user-photos/avatar.jpg',
          downloadTokens: 'download-token'
        })
      );

    await nativeUploadProfilePhoto(file);

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://securetoken.googleapis.com/v1/token?key=secondary-image-project-key',
      expect.objectContaining({
        body: expect.any(URLSearchParams)
      })
    );
    expect(imageSessionMocks.writeImageUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        idToken: 'rotated-secondary-id-token',
        refreshToken: 'rotated-secondary-refresh-token'
      })
    );
    expect(imageSessionMocks.clearImageUploadSession).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('reuses a valid secondary session without adding a primary-project App Check token', async () => {
    imageSessionMocks.readImageUploadSession.mockResolvedValue({
      apiKey: 'secondary-image-project-key',
      idToken: 'valid-secondary-id-token',
      refreshToken: 'valid-secondary-refresh-token',
      expirationTime: Date.now() + 3_600_000
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      response(true, {
        name: 'user-photos/avatar.jpg',
        downloadTokens: 'download-token'
      })
    );

    await nativeUploadProfilePhoto(file);

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [, request] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(request?.headers).toEqual({
      Authorization: 'Bearer valid-secondary-id-token',
      'Content-Type': 'image/jpeg'
    });
    expect(request?.headers).not.toHaveProperty('X-Firebase-AppCheck');
    expect(imageSessionMocks.writeImageUploadSession).not.toHaveBeenCalled();
    expect(imageSessionMocks.clearImageUploadSession).not.toHaveBeenCalled();
  });
});
