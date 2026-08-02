// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  deleteNativePrimaryStorageFile,
  uploadNativePlayerPhoto,
  uploadNativePrimaryStorageFile,
  uploadNativeTeamPhotoFile,
  uploadNativeUserProfilePhoto
} from './nativeStorageUpload';

const neverResolves = <T>() => new Promise<T>(() => {});

async function expectTimeout(promise: Promise<unknown>, message: string) {
  const assertion = expect(promise).rejects.toThrow(message);
  await vi.advanceTimersByTimeAsync(10);
  await assertion;
}

describe('native primary Storage profile uploads', () => {
  beforeEach(() => {
    vi.useRealTimers();
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uploads the signed-in user photo to primary Storage with native auth and App Check', async () => {
    const file = new File(['photo'], 'My photo.jpg', { type: 'image/jpeg' });

    const upload = await uploadNativeUserProfilePhoto(file, 'user-1');

    const expectedPath = 'profile-photos/users/user-1/12345_profile-photo.jpg';
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
      }),
      signal: expect.any(AbortSignal)
    }));
    expect(upload).toMatchObject({
      path: 'stored-path',
      userId: 'user-1',
      mimeType: 'image/jpeg',
      sizeBytes: file.size
    });
    expect(upload.url).toContain('/b/primary-bucket.example/o/stored-path?alt=media&token=download-token');
  });

  it('rejects an own-profile upload when the requested user differs from native auth', async () => {
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });

    await expect(uploadNativeUserProfilePhoto(file, 'other-user'))
      .rejects.toThrow('signed-in account does not match');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('attempts cleanup at the reserved profile path when a native upload response fails', async () => {
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: 'backend unavailable' } })
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({})
      } as Response);

    await expect(uploadNativeUserProfilePhoto(file, 'user-1')).rejects.toThrow('backend unavailable');

    const expectedPath = 'profile-photos/users/user-1/12345_profile-photo.jpg';
    const cleanupUrl = `https://firebasestorage.googleapis.com/v0/b/primary-bucket.example/o/${encodeURIComponent(expectedPath)}`;
    expect(fetch).toHaveBeenNthCalledWith(2, cleanupUrl, expect.objectContaining({
      method: 'DELETE',
      signal: expect.any(AbortSignal)
    }));
  });

  it('scopes a player photo to its team and player without exposing the uploader ID', async () => {
    const file = new File(['photo'], 'kid photo.png', { type: 'image/png' });

    const upload = await uploadNativePlayerPhoto(file, 'team-1', 'player-7');

    const expectedPath = 'profile-photos/teams/team-1/players/player-7/12345_profile-photo.png';
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`name=${encodeURIComponent(expectedPath)}`),
      expect.objectContaining({ body: file })
    );
    expect(upload).toMatchObject({ url: expect.any(String), path: 'stored-path' });
  });

  it('scopes a team photo to its team without exposing the manager ID', async () => {
    const file = new File(['photo'], 'team logo.png', { type: 'image/png' });

    await uploadNativeTeamPhotoFile(file, 'team-1');

    const expectedPath = 'profile-photos/teams/team-1/team/12345_profile-photo.png';
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`name=${encodeURIComponent(expectedPath)}`),
      expect.objectContaining({ body: file })
    );
  });

  it.each([
    [
      'player',
      (file: File) => uploadNativePlayerPhoto(file, 'team-1', 'player-7'),
      'profile-photos/teams/team-1/players/player-7/12345_profile-photo.png'
    ],
    [
      'team',
      (file: File) => uploadNativeTeamPhotoFile(file, 'team-1'),
      'profile-photos/teams/team-1/team/12345_profile-photo.png'
    ]
  ])('cleans the reserved %s path when the upload response is unsuccessful', async (_kind, upload, expectedPath) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: 'backend unavailable' } })
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    await expect(upload(new File(['photo'], 'photo.png', { type: 'image/png' })))
      .rejects.toThrow('backend unavailable');

    const cleanupUrl = `https://firebasestorage.googleapis.com/v0/b/primary-bucket.example/o/${encodeURIComponent(expectedPath)}`;
    expect(fetch).toHaveBeenNthCalledWith(2, cleanupUrl, expect.objectContaining({
      method: 'DELETE',
      signal: expect.any(AbortSignal)
    }));
  });

  it('deletes a failed native upload with the same auth and App Check boundary', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 204 } as Response);
    const path = 'profile-photos/teams/team-1/players/player-1/photo.jpg';

    await deleteNativePrimaryStorageFile(path);

    const expectedUrl = `https://firebasestorage.googleapis.com/v0/b/primary-bucket.example/o/${encodeURIComponent(path)}`;
    expect(fetch).toHaveBeenCalledWith(expectedUrl, expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({
        Authorization: 'Bearer native-id-token',
        'X-Firebase-AppCheck': 'app-check-token'
      })
    }));
  });

  it.each([
    ['native auth', () => authMocks.getNativeAuthIdToken.mockReturnValueOnce(neverResolves())],
    ['App Check', () => appCheckMocks.getPrimaryAppCheckHeaders.mockReturnValueOnce(neverResolves())],
    ['response parsing', () => vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => neverResolves()
    } as Response)]
  ])('times out an upload stalled during %s', async (_stage, stall) => {
    vi.useFakeTimers();
    stall();
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });

    const upload = uploadNativePrimaryStorageFile({
      file,
      label: 'Photo',
      timeoutMs: 10,
      buildPath: (userId, fileName) => `profile-photos/users/${userId}/${fileName}`
    });

    await expectTimeout(upload, 'Photo upload timed out');
  });

  it('cleans the reserved path when response parsing times out after the upload request', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => neverResolves()
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    const expectedPath = 'profile-photos/teams/team-1/team/photo.jpg';

    const upload = uploadNativePrimaryStorageFile({
      file,
      label: 'Team photo',
      timeoutMs: 10,
      buildPath: () => expectedPath
    });
    const assertion = expect(upload).rejects.toThrow('Team photo upload timed out');
    await vi.advanceTimersByTimeAsync(10);
    await assertion;

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `https://firebasestorage.googleapis.com/v0/b/primary-bucket.example/o/${encodeURIComponent(expectedPath)}`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it.each([
    ['native auth', () => authMocks.getNativeAuthIdToken.mockReturnValueOnce(neverResolves())],
    ['App Check', () => appCheckMocks.getPrimaryAppCheckHeaders.mockReturnValueOnce(neverResolves())],
    ['response parsing', () => vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => neverResolves()
    } as Response)]
  ])('times out cleanup stalled during %s', async (_stage, stall) => {
    vi.useFakeTimers();
    stall();

    const cleanup = deleteNativePrimaryStorageFile(
      'profile-photos/users/user-1/photo.jpg',
      10
    );

    await expectTimeout(cleanup, 'Storage cleanup timed out');
  });
});
