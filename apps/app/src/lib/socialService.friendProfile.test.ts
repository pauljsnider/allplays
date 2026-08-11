// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('./adapters/legacySocialDb', () => firestoreMocks);
vi.mock('./profileService', () => profileMocks);
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
});
