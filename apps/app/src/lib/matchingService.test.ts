import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './types';
import type { MatchingPost } from './matchingLogic';

const adapterMocks = vi.hoisted(() => {
  const addDoc = vi.fn();
  const setDoc = vi.fn();
  const updateDoc = vi.fn();
  const deleteDoc = vi.fn();
  const getDoc = vi.fn();
  const getDocs = vi.fn();
  return {
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    getDoc,
    getDocs,
    db: {},
    collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ kind: 'doc', path: segments.join('/') })),
    query: vi.fn((source: any, ...constraints: any[]) => ({ kind: 'query', source, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
    limit: vi.fn((value: number) => ({ kind: 'limit', value })),
    serverTimestamp: vi.fn(() => 'server-timestamp'),
    Timestamp: {
      now: vi.fn(() => ({ seconds: 1780000000 })),
      fromDate: vi.fn((date: Date) => ({ toDate: () => date, seconds: Math.floor(date.getTime() / 1000) }))
    }
  };
});

vi.mock('./adapters/legacySocialDb', () => adapterMocks);

import {
  createMatchingPost,
  dismissMatchingResponse,
  loadOpenMatchingPosts,
  loadRelevantMatchingFeedItems,
  respondToMatchingPost,
  setMatchingPostStatus
} from './matchingService';

const user: AuthUser = {
  uid: 'parent-1',
  email: 'parent@example.com',
  displayName: 'Parent One'
} as AuthUser;

function openPost(overrides: Partial<MatchingPost> = {}): MatchingPost {
  return {
    id: 'post-1',
    kind: 'player_seeking_team',
    status: 'open',
    authorId: 'author-1',
    authorName: 'Author',
    authorPhotoUrl: null,
    teamId: null,
    teamName: null,
    title: 'Ethan (U12 Soccer) is looking for a team',
    description: '',
    matching: {
      kind: 'player_seeking_team',
      sport: 'Soccer',
      ageGroup: 'U12',
      city: 'Columbus',
      state: 'OH',
      zip: '',
      positions: '',
      level: '',
      timeframe: '',
      openSpots: null,
      playerFirstName: 'Ethan',
      signupUrl: ''
    },
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    hidden: false,
    ...overrides
  };
}

function snapshotOf(docs: Array<Record<string, any>>) {
  return {
    docs: docs.map(({ id, ...data }) => ({ id, data: () => data }))
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createMatchingPost', () => {
  it('writes a community post without contact fields or roster ids', async () => {
    adapterMocks.addDoc.mockResolvedValue({ id: 'new-post' });
    const postId = await createMatchingPost({ ...user, photoUrl: 'javascript:alert(1)' }, {
      kind: 'player_seeking_team',
      sport: 'Soccer',
      ageGroup: 'U12',
      city: 'Columbus',
      state: 'OH',
      playerFirstName: 'Ethan',
      description: 'Loves midfield.'
    });
    expect(postId).toBe('new-post');
    const payload = adapterMocks.addDoc.mock.calls[0][1];
    expect(payload.visibility).toBe('community');
    expect(payload.type).toBe('player_seeking_team');
    expect(payload.status).toBe('open');
    expect(payload.hidden).toBe(false);
    expect(payload.media).toEqual([]);
    expect(payload.playerIds).toEqual([]);
    expect(payload.playerNames).toEqual(['Ethan']);
    expect(payload.authorPhotoUrl).toBeNull();
    expect(payload.matching.sport).toBe('Soccer');
    expect(payload.expiresAt).toBeTruthy();
    expect('authorEmail' in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('parent@example.com');
  });

  it('uses a privacy-safe author name when the profile has no display name', async () => {
    adapterMocks.addDoc.mockResolvedValue({ id: 'new-post' });
    await createMatchingPost({ ...user, displayName: null }, {
      kind: 'player_seeking_team',
      sport: 'Soccer',
      ageGroup: 'U12',
      city: 'Columbus',
      state: 'OH',
      playerFirstName: 'Ethan'
    });

    const payload = adapterMocks.addDoc.mock.calls[0][1];
    expect(payload.authorName).toBe('ALL PLAYS user');
    expect(JSON.stringify(payload)).not.toContain('parent@example.com');
  });

  it('links team posts to the team feed via teamIds', async () => {
    adapterMocks.addDoc.mockResolvedValue({ id: 'team-post' });
    await createMatchingPost(user, {
      kind: 'team_seeking_players',
      sport: 'Basketball',
      ageGroup: 'U14',
      zip: '43004',
      teamId: 'team-9',
      teamName: 'Rockets',
      openSpots: 2
    });
    const payload = adapterMocks.addDoc.mock.calls[0][1];
    expect(payload.teamId).toBe('team-9');
    expect(payload.teamIds).toEqual(['team-9']);
    expect(payload.title).toContain('Rockets');
    expect(payload.matching.openSpots).toBe(2);
  });

  it('rejects invalid drafts before any write', async () => {
    await expect(createMatchingPost(user, {
      kind: 'player_seeking_team',
      sport: '',
      ageGroup: 'U12',
      zip: '43004',
      playerFirstName: 'Ethan'
    })).rejects.toThrow(/sport/i);
    expect(adapterMocks.addDoc).not.toHaveBeenCalled();
  });
});

describe('loadOpenMatchingPosts', () => {
  it('queries community open posts and drops expired ones client-side', async () => {
    adapterMocks.getDocs.mockResolvedValue(snapshotOf([
      {
        id: 'fresh',
        type: 'player_seeking_team',
        status: 'open',
        authorId: 'a1',
        matching: { sport: 'Soccer', ageGroup: 'U12', zip: '43004' },
        createdAt: { seconds: 1780000000 },
        expiresAt: { seconds: 4102444800 },
        hidden: false
      },
      {
        id: 'expired',
        type: 'player_seeking_team',
        status: 'open',
        authorId: 'a2',
        matching: { sport: 'Soccer', ageGroup: 'U12', zip: '43004' },
        createdAt: { seconds: 1700000000 },
        expiresAt: { seconds: 1700000001 },
        hidden: false
      },
      { id: 'not-matching', type: 'manual_post', createdAt: { seconds: 1780000000 } }
    ]));

    const posts = await loadOpenMatchingPosts();
    expect(posts.map((post) => post.id)).toEqual(['fresh']);
    const constraints = adapterMocks.query.mock.calls[0].slice(1).flat();
    const whereFields = constraints.filter((entry: any) => entry?.kind === 'where').map((entry: any) => `${entry.field}==${entry.value}`);
    expect(whereFields).toContain('visibility==community');
    expect(whereFields).toContain('status==open');
    expect(whereFields).toContain('hidden==false');
  });
});

describe('loadRelevantMatchingFeedItems', () => {
  it('returns feed items and never throws on query failure', async () => {
    adapterMocks.getDocs.mockRejectedValue(new Error('permission denied'));
    const items = await loadRelevantMatchingFeedItems(user, { teams: [], players: [], upcomingEvents: [] } as any);
    expect(items).toEqual([]);
  });
});

describe('respondToMatchingPost', () => {
  it('upserts one response per user and notifies the author', async () => {
    adapterMocks.setDoc.mockResolvedValue(undefined);
    adapterMocks.addDoc.mockResolvedValue({ id: 'note-1' });
    await respondToMatchingPost({ ...user, photoUrl: 'https://lh3.googleusercontent.com/a/photo.png' }, openPost(), {
      message: 'We would love to have Ethan try out.',
      teamId: 'team-1',
      teamName: 'Rockets'
    });

    const [ref, payload, options] = adapterMocks.setDoc.mock.calls[0];
    expect(ref.path).toBe('socialPosts/post-1/responses/parent-1');
    expect(options).toEqual({ merge: true });
    expect(payload.responderId).toBe('parent-1');
    expect(payload.responderPhotoUrl).toBe('https://lh3.googleusercontent.com/a/photo.png');
    expect(payload.teamId).toBe('team-1');
    expect(payload.teamName).toBe('Rockets');
    expect(payload.message).toContain('try out');

    const [collectionRef, notification] = adapterMocks.addDoc.mock.calls[0];
    expect(collectionRef.path).toBe('users/author-1/notificationInbox');
    expect(notification.category).toBe('matching_response');
    expect(notification.appRoute).toBe('/opportunities?view=mine');
    expect(notification.fromUserId).toBe('parent-1');
    expect(notification.readAt).toBeNull();
  });

  it('still succeeds when the notification write fails', async () => {
    adapterMocks.setDoc.mockResolvedValue(undefined);
    adapterMocks.addDoc.mockRejectedValue(new Error('rules rejected'));
    await expect(respondToMatchingPost(user, openPost({ kind: 'team_seeking_players' }), { message: 'Interested!' })).resolves.toBeUndefined();
    expect(adapterMocks.setDoc).toHaveBeenCalledTimes(1);
  });

  it('does not expose email in a response or notification when the profile has no display name', async () => {
    adapterMocks.setDoc.mockResolvedValue(undefined);
    adapterMocks.addDoc.mockResolvedValue({ id: 'note-1' });
    await respondToMatchingPost({ ...user, displayName: null }, openPost(), {
      message: 'Interested!',
      teamId: 'team-1',
      teamName: 'Rockets'
    });

    const response = adapterMocks.setDoc.mock.calls[0][1];
    const notification = adapterMocks.addDoc.mock.calls[0][1];
    expect(response.responderName).toBe('ALL PLAYS user');
    expect(notification.body).toBe('ALL PLAYS user responded to "Ethan (U12 Soccer) is looking for a team".');
    expect(JSON.stringify({ response, notification })).not.toContain('parent@example.com');
  });

  it('blocks responding to your own or non-open posts, contact info in messages, and player posts without a managed team', async () => {
    await expect(respondToMatchingPost(user, openPost({ authorId: user.uid }), { message: 'hi' }))
      .rejects.toThrow(/your own post/i);
    await expect(respondToMatchingPost(user, openPost({ status: 'filled' }), { message: 'hi' }))
      .rejects.toThrow(/no longer open/i);
    await expect(respondToMatchingPost(user, openPost(), { message: 'call me 614-555-0142' }))
      .rejects.toThrow(/emails and phone/i);
    await expect(respondToMatchingPost(user, openPost(), { message: '   ' }))
      .rejects.toThrow(/message/i);
    await expect(respondToMatchingPost(user, openPost(), { message: 'Interested!' }))
      .rejects.toThrow(/team you manage/i);
    expect(adapterMocks.setDoc).not.toHaveBeenCalled();
  });
});

describe('post lifecycle and responses', () => {
  it('updates only status and updatedAt when closing a post', async () => {
    adapterMocks.updateDoc.mockResolvedValue(undefined);
    await setMatchingPostStatus('post-1', 'filled');
    const [ref, payload] = adapterMocks.updateDoc.mock.calls[0];
    expect(ref.path).toBe('socialPosts/post-1');
    expect(Object.keys(payload).sort()).toEqual(['status', 'updatedAt']);
    expect(payload.status).toBe('filled');
  });

  it('deletes a response doc when the author dismisses it', async () => {
    adapterMocks.deleteDoc.mockResolvedValue(undefined);
    await dismissMatchingResponse('post-1', 'responder-9');
    expect(adapterMocks.deleteDoc.mock.calls[0][0].path).toBe('socialPosts/post-1/responses/responder-9');
  });
});
