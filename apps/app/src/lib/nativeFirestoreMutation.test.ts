// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getNativeAuthIdToken: vi.fn()
}));
const appCheckMocks = vi.hoisted(() => ({
  getPrimaryAppCheckHeaders: vi.fn(async (headers) => ({
    ...headers,
    'X-Firebase-AppCheck': 'app-check-token'
  }))
}));

vi.mock('./authService', () => ({
  firebaseAuth: { app: { options: { projectId: 'primary-project' } } },
  ...authMocks
}));
vi.mock('./adapters/legacyFirebaseAppCheck', () => appCheckMocks);

import {
  commitNativeFirestoreWrites,
  createNativeFirestoreDocumentId,
  NativeFirestoreCommitUncertainError
} from './nativeFirestoreMutation';

const neverResolves = <T>() => new Promise<T>(() => {});

describe('native Firestore mutations', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ writeResults: [] })
    })));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits merge and create-only documents atomically with native auth and App Check', async () => {
    await commitNativeFirestoreWrites([
      {
        pathSegments: ['teams', 'team-1'],
        data: { photoUrl: 'https://primary.example/team.jpg', updatedAt: new Date('2026-08-01T12:00:00Z') }
      },
      {
        pathSegments: ['teams', 'team-1', 'players', 'player-1'],
        data: { name: 'Sam Player', active: true },
        createOnly: true
      }
    ]);

    const requestUrl = 'https://firestore.googleapis.com/v1/projects/primary-project/databases/(default)/documents:commit';
    expect(authMocks.getNativeAuthIdToken).toHaveBeenCalledWith(true);
    expect(appCheckMocks.getPrimaryAppCheckHeaders).toHaveBeenCalledWith({
      Authorization: 'Bearer native-id-token',
      'Content-Type': 'application/json'
    }, requestUrl);
    expect(fetch).toHaveBeenCalledWith(requestUrl, expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Firebase-AppCheck': 'app-check-token' })
    }));
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.writes[0]).toMatchObject({
      update: {
        name: 'projects/primary-project/databases/(default)/documents/teams/team-1',
        fields: {
          photoUrl: { stringValue: 'https://primary.example/team.jpg' },
          updatedAt: { timestampValue: '2026-08-01T12:00:00.000Z' }
        }
      },
      updateMask: { fieldPaths: ['photoUrl', 'updatedAt'] }
    });
    expect(payload.writes[1]).toMatchObject({
      currentDocument: { exists: false },
      update: { fields: { name: { stringValue: 'Sam Player' }, active: { booleanValue: true } } }
    });
  });

  it('creates bounded non-path document IDs', () => {
    const id = createNativeFirestoreDocumentId();
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  it('rejects path injection before making a request', async () => {
    await expect(commitNativeFirestoreWrites([{
      pathSegments: ['teams', 'team-1/players/player-1'],
      data: { name: 'Unsafe' }
    }])).rejects.toThrow('path is invalid');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks an aborted commit as uncertain so callers do not delete committed media', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    const error = await commitNativeFirestoreWrites([{
      pathSegments: ['teams', 'team-1'],
      data: { photoUrl: 'https://primary.example/team.jpg' }
    }]).catch((caught) => caught);

    expect(error).toBeInstanceOf(NativeFirestoreCommitUncertainError);
    expect(error).toMatchObject({ commitStateUnknown: true });
    expect(error.message).toContain('may have completed');
  });

  it('marks a transport rejection as uncertain after dispatch', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await commitNativeFirestoreWrites([{
      pathSegments: ['teams', 'team-1'],
      data: { photoUrl: 'https://primary.example/team.jpg' }
    }]).catch((caught) => caught);

    expect(error).toBeInstanceOf(NativeFirestoreCommitUncertainError);
    expect(error).toMatchObject({ commitStateUnknown: true });
  });

  it('keeps an HTTP rejection definite after Firestore responds', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'permission denied' } })
    } as Response);

    const error = await commitNativeFirestoreWrites([{
      pathSegments: ['teams', 'team-1'],
      data: { photoUrl: 'https://primary.example/team.jpg' }
    }]).catch((caught) => caught);

    expect(error).not.toBeInstanceOf(NativeFirestoreCommitUncertainError);
    expect(error).toMatchObject({ message: 'permission denied' });
  });

  it.each([
    ['native auth', () => authMocks.getNativeAuthIdToken.mockReturnValueOnce(neverResolves())],
    ['App Check', () => appCheckMocks.getPrimaryAppCheckHeaders.mockReturnValueOnce(neverResolves())]
  ])('times out a commit stalled during %s before dispatch', async (_stage, stall) => {
    vi.useFakeTimers();
    stall();
    const commit = commitNativeFirestoreWrites([{
      pathSegments: ['teams', 'team-1'],
      data: { photoUrl: 'https://primary.example/team.jpg' }
    }], 10);
    const assertion = expect(commit).rejects.toThrow('timed out before it was sent');

    await vi.advanceTimersByTimeAsync(10);

    await assertion;
    expect(fetch).not.toHaveBeenCalled();
  });

  it('times out stalled response parsing as an uncertain dispatched commit', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => neverResolves()
    } as Response);
    const commit = commitNativeFirestoreWrites([{
      pathSegments: ['teams', 'team-1'],
      data: { photoUrl: 'https://primary.example/team.jpg' }
    }], 10);
    const assertion = expect(commit).rejects.toBeInstanceOf(NativeFirestoreCommitUncertainError);

    await vi.advanceTimersByTimeAsync(10);

    await assertion;
  });
});
