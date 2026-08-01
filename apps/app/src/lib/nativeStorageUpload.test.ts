// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getNativeAuthIdToken: vi.fn(),
  getNativeAuthUserId: vi.fn()
}));
const appCheckMocks = vi.hoisted(() => ({
  getPrimaryAppCheckHeaders: vi.fn(async (headers) => ({
    ...headers,
    'X-Firebase-AppCheck': 'app-check-token'
  }))
}));

vi.mock('./authService', () => ({
  firebaseAuth: { app: { options: { storageBucket: 'primary-bucket.example' } } },
  ...authMocks
}));
vi.mock('./adapters/legacyFirebaseAppCheck', () => appCheckMocks);

import {
  uploadNativePlayerPhoto,
  uploadNativeUserProfilePhoto
} from './nativeStorageUpload';

describe('native primary Storage profile uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getNativeAuthUserId.mockReturnValue('user-1');
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'stored-path',
        downloadTokens: 'download-token'
      })
    })));
  });

  it('uploads the signed-in user photo to primary Storage with native auth and App Check', async () => {
    const file = new File(['photo'], 'My photo.jpg', { type: 'image/jpeg' });

    const url = await uploadNativeUserProfilePhoto(file, 'user-1');

    const expectedPath = 'profile-photos/users/user-1/12345_My_photo.jpg';
    const expectedRequestUrl = `https://firebasestorage.googleapis.com/v0/b/primary-bucket.example/o?uploadType=media&name=${encodeURIComponent(expectedPath)}`;
    expect(authMocks.getNativeAuthIdToken).toHaveBeenCalledWith(true);
    expect(appCheckMocks.getPrimaryAppCheckHeaders).toHaveBeenCalledWith({
      Authorization: 'Bearer native-id-token',
      'Content-Type': 'image/jpeg'
    }, expectedRequestUrl);
    expect(fetch).toHaveBeenCalledWith(expectedRequestUrl, expect.objectContaining({
      method: 'POST',
      body: file,
      headers: expect.objectContaining({
        Authorization: 'Bearer native-id-token',
        'X-Firebase-AppCheck': 'app-check-token'
      })
    }));
    expect(url).toContain('/b/primary-bucket.example/o/stored-path?alt=media&token=download-token');
  });

  it('rejects an own-profile upload when the requested user differs from native auth', async () => {
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });

    await expect(uploadNativeUserProfilePhoto(file, 'other-user'))
      .rejects.toThrow('signed-in account does not match');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('scopes a player photo to its team, player, and signed-in uploader', async () => {
    const file = new File(['photo'], 'kid photo.png', { type: 'image/png' });

    await uploadNativePlayerPhoto(file, 'team-1', 'player-7');

    const expectedPath = 'profile-photos/teams/team-1/players/player-7/user-1/12345_kid_photo.png';
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`name=${encodeURIComponent(expectedPath)}`),
      expect.objectContaining({ body: file })
    );
  });
});
