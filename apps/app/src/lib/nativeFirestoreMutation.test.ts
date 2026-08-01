// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('native Firestore mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ writeResults: [] })
    })));
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
});
