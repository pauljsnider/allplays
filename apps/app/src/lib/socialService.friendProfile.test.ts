// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  collection: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  db: { kind: 'db' },
  doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn((value: number) => ({ kind: 'limit', value })),
  orderBy: vi.fn((field: string, direction: string) => ({ kind: 'orderBy', field, direction })),
  query: vi.fn((base: unknown, ...filters: unknown[]) => ({ base, filters })),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  startAfter: vi.fn(),
  Timestamp: { fromDate: vi.fn((value: Date) => value) },
  updateDoc: vi.fn(),
  where: vi.fn((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }))
}));

const profileMocks = vi.hoisted(() => ({
  loadProfileDocument: vi.fn()
}));

const nativeRuntimeMocks = vi.hoisted(() => ({
  isNativeRuntime: vi.fn()
}));

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

vi.mock('./adapters/legacySocialDb', () => firestoreMocks);
vi.mock('./profileService', () => profileMocks);
vi.mock('./nativeRuntime', () => nativeRuntimeMocks);
vi.mock('./authService', () => authMocks);
vi.mock('./adapters/legacyFirebaseAppCheck', () => appCheckMocks);
vi.mock('./homeService', () => ({ loadParentHome: vi.fn() }));
vi.mock('./chatService', () => ({
  deleteTeamChatAttachments: vi.fn(),
  uploadTeamChatAttachment: vi.fn()
}));
vi.mock('./publicTeamsService', () => ({ getPublicTeamDetail: vi.fn() }));
vi.mock('./adapters/legacyPlayerProfile', () => ({
  buildAthleteProfileShareUrl: vi.fn((_base: string, id: string) => `https://allplays.test/athletes/${id}`)
}));
vi.mock('./inviteUrls', () => ({ getPublicBaseUrl: vi.fn(() => 'https://allplays.test') }));
vi.mock('./logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn() }))
}));

import { loadFriendProfile } from './socialService';

describe('loadFriendProfile self-profile resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeRuntimeMocks.isNativeRuntime.mockReturnValue(false);
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    profileMocks.loadProfileDocument.mockResolvedValue({
      displayName: 'Pat Parent',
      photoUrl: 'https://cdn.example.test/pat.jpg',
      discoveryTeamIds: []
    });
    firestoreMocks.getDoc.mockRejectedValue(new Error('Web Firestore is not authenticated.'));
    firestoreMocks.getDocs.mockImplementation(async (queryValue: any) => {
      const path = queryValue?.base?.path || '';
      if (path === 'socialPosts') {
        throw Object.assign(new Error('Missing or insufficient permissions.'), {
          code: 'permission-denied'
        });
      }
      return { docs: [] };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks denied self-profile posts incomplete instead of reporting an authoritative empty timeline', async () => {
    const user = {
      uid: 'user-1',
      email: 'parent@example.test',
      displayName: 'Pat Parent',
      roles: []
    } as any;

    const profile = await loadFriendProfile(user, 'user-1');

    expect(profile).toMatchObject({
      userId: 'user-1',
      name: 'Pat Parent',
      photoUrl: 'https://cdn.example.test/pat.jpg',
      isSelf: true,
      posts: [],
      postsError: 'Recent posts could not load. Try again.'
    });
    expect(profileMocks.loadProfileDocument).toHaveBeenCalledWith('user-1');
    expect(firestoreMocks.getDoc).not.toHaveBeenCalled();
  });

  it('loads self-profile posts through authenticated REST in native builds', async () => {
    nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/hiddenSocialPosts?')) {
        return { ok: true, status: 200, json: async () => ({ documents: [] }) };
      }
      if (url.endsWith('/documents:runQuery')) {
        const query = JSON.parse(String(init?.body || '{}'));
        expect(query.structuredQuery.where.compositeFilter.filters).toEqual(expect.arrayContaining([
          expect.objectContaining({
            fieldFilter: expect.objectContaining({
              field: { fieldPath: 'visibleUserIds' },
              op: 'ARRAY_CONTAINS',
              value: { stringValue: 'user-1' }
            })
          }),
          expect.objectContaining({
            fieldFilter: expect.objectContaining({
              field: { fieldPath: 'authorId' },
              op: 'EQUAL',
              value: { stringValue: 'user-1' }
            })
          })
        ]));
        return {
          ok: true,
          status: 200,
          json: async () => [{
            document: {
              name: 'projects/demo-project/databases/(default)/documents/socialPosts/post-1',
              fields: {
                authorId: { stringValue: 'user-1' },
                authorName: { stringValue: 'Pat Parent' },
                visibleUserIds: { arrayValue: { values: [{ stringValue: 'user-1' }] } },
                title: { stringValue: 'Tournament update' },
                detail: { stringValue: 'Great weekend.' },
                visibility: { stringValue: 'friends' },
                hidden: { booleanValue: false },
                createdAt: { timestampValue: '2026-08-10T15:00:00.000Z' }
              }
            }
          }]
        };
      }
      if (url.includes('/socialPosts/post-1/reactions/user-1')) {
        return { ok: false, status: 404, json: async () => ({ error: { message: 'Not found' } }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const profile = await loadFriendProfile({
      uid: 'user-1',
      email: 'parent@example.test',
      displayName: 'Pat Parent',
      roles: []
    } as any, 'user-1');

    expect(profile).toMatchObject({
      postsError: null,
      posts: [expect.objectContaining({
        id: 'post-1',
        title: 'Tournament update',
        detail: 'Great weekend.',
        viewerHasLiked: false
      })]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/documents:runQuery'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer native-id-token',
          'X-Firebase-AppCheck': 'debug-app-check'
        })
      })
    );
  });
});
