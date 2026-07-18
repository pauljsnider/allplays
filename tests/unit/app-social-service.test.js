// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    db: { app: 'test' },
    collection: vi.fn((db, ...path) => ({ kind: 'collection', path })),
    doc: vi.fn((db, ...path) => ({ kind: 'doc', path })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    query: vi.fn((collectionRef, ...clauses) => ({ collectionRef, clauses })),
    where: vi.fn((field, op, value) => ({ field, op, value })),
    orderBy: vi.fn((field, direction) => ({ field, direction })),
    limit: vi.fn((count) => ({ count })),
    startAfter: vi.fn((cursor) => ({ cursor })),
    runTransaction: vi.fn(),
    Timestamp: { now: vi.fn(() => ({ seconds: 4102444800, toDate: () => new Date('2100-01-01T00:00:00Z') })) },
    serverTimestamp: vi.fn(() => ({ __serverTimestamp: true }))
}));

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn()
}));

const chatMocks = vi.hoisted(() => ({
    uploadTeamChatAttachment: vi.fn()
}));

vi.mock('../../js/firebase.js', () => firebaseMocks);
vi.mock(import('../../apps/app/src/lib/homeService.ts'), () => homeMocks);
vi.mock(import('../../apps/app/src/lib/chatService.ts'), () => chatMocks);

const user = {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    photoUrl: 'https://img.example.test/user.png'
};

function snapshot(docs) {
    return {
        docs: docs.map((entry) => ({
            id: entry.id,
            data: () => ({ ...entry })
        }))
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'crypto', {
        value: {
            subtle: {
                digest: vi.fn(async () => new Uint8Array([0xaa, 0xbb]).buffer)
            }
        },
        configurable: true
    });
    firebaseMocks.addDoc.mockResolvedValue({ id: 'post-new' });
    firebaseMocks.setDoc.mockResolvedValue();
    firebaseMocks.updateDoc.mockResolvedValue();
    firebaseMocks.getDoc.mockResolvedValue({ exists: () => false });
    firebaseMocks.getDocs.mockResolvedValue(snapshot([]));
    homeMocks.loadParentHome.mockResolvedValue({
        players: [],
        teams: [{ teamId: 'team-1', teamName: 'Bears' }],
        upcomingEvents: [],
        actionItems: [],
        fees: [],
        metrics: { players: 0, teams: 1, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
    });
    chatMocks.uploadTeamChatAttachment.mockResolvedValue({
        type: 'image',
        url: 'https://img.example.test/upload.png',
        name: 'upload.png',
        thumbnailUrl: null
    });
});

describe('React app social service', () => {
    it('creates user-authored social posts with team, player, media, and visibility metadata', async () => {
        const { createSocialPost } = await import('../../apps/app/src/lib/socialService.ts');

        const post = await createSocialPost(user, {
            type: 'player_moment',
            visibility: 'friends_and_team',
            title: 'Pat Star highlight',
            detail: 'Player moment · Pat Star',
            caption: 'Great hustle.',
            teamId: 'team-1',
            teamName: 'Bears',
            playerIds: ['player-1'],
            playerNames: ['Pat Star'],
            route: '/players/team-1/player-1',
            media: [{ type: 'image', url: 'https://img.example.test/post.png', name: 'post.png' }],
            visibleUserIds: ['friend-1']
        });

        expect(post).toMatchObject({
            id: 'post-new',
            authorId: 'user-1',
            title: 'Pat Star highlight',
            viewerHasLiked: false
        });
        expect(firebaseMocks.addDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['socialPosts'] }),
            expect.objectContaining({
                type: 'player_moment',
                visibility: 'friends_and_team',
                authorId: 'user-1',
                authorName: 'Pat Parent',
                authorPhotoUrl: 'https://img.example.test/user.png',
                teamId: 'team-1',
                teamIds: ['team-1'],
                playerIds: ['player-1'],
                playerNames: ['Pat Star'],
                title: 'Pat Star highlight',
                caption: 'Great hustle.',
                route: '/players/team-1/player-1',
                visibleUserIds: ['user-1', 'friend-1'],
                media: [expect.objectContaining({ url: 'https://img.example.test/post.png' })],
                reactionCounts: {},
                commentCount: 0,
                hidden: false
            })
        );
    });

    it('writes deterministic friendship records and request decisions', async () => {
        const {
            sendFriendRequest,
            respondToFriendRequest,
            removeFriend,
            blockFriend
        } = await import('../../apps/app/src/lib/socialService.ts');

        await sendFriendRequest(user, {
            id: 'friendship-1',
            userId: 'friend-1',
            name: 'Jamie Friend',
            email: 'jamie@example.com',
            photoUrl: null,
            sharedTeamIds: ['team-1'],
            sharedTeamNames: ['Bears'],
            status: 'none',
            requesterId: null,
            recipientId: 'friend-1'
        });
        await respondToFriendRequest('friend-1__user-1', 'accepted');
        await removeFriend('friend-1__user-1');
        await blockFriend('friend-1__user-1', 'user-1');

        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'friendships', 'friend-1__user-1');
        expect(firebaseMocks.setDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['friendships', 'friend-1__user-1'] }),
            expect.objectContaining({
                requesterId: 'user-1',
                recipientId: 'friend-1',
                memberIds: ['friend-1', 'user-1'],
                status: 'pending',
                sharedTeamIds: ['team-1']
            }),
            { merge: true }
        );
        expect(firebaseMocks.updateDoc).toHaveBeenCalledWith(expect.objectContaining({ path: ['friendships', 'friend-1__user-1'] }), expect.objectContaining({ status: 'accepted' }));
        expect(firebaseMocks.updateDoc).toHaveBeenCalledWith(expect.objectContaining({ path: ['friendships', 'friend-1__user-1'] }), expect.objectContaining({ status: 'removed' }));
        expect(firebaseMocks.updateDoc).toHaveBeenCalledWith(expect.objectContaining({ path: ['friendships', 'friend-1__user-1'] }), expect.objectContaining({ status: 'blocked', blockedBy: ['user-1'] }));
    });

    it('loads only persisted visible posts, friendships, and suggestions into the social home model', async () => {
        const { loadSocialHome } = await import('../../apps/app/src/lib/socialService.ts');
        const home = {
            players: [{
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Pat Star',
                nextEvent: null,
                rsvpNeeded: 1,
                packetsReady: 0,
                openAssignments: 0,
                unreadCount: 0
            }],
            teams: [{ teamId: 'team-1', teamName: 'Bears', role: 'Parent', sport: 'Basketball', players: [], nextEvent: null, eventCount: 0, unreadCount: 0, openActions: 0 }],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: { players: 1, teams: 1, rsvpNeeded: 1, unreadMessages: 0, packetsReady: 0 }
        };
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const whereClause = queryRef.clauses.find((clause) => clause.field);
            if (whereClause?.field === 'visibleUserIds') {
                return snapshot([{
                    id: 'post-1',
                    type: 'team_media',
                    visibility: 'team',
                    authorId: 'friend-1',
                    authorName: 'Jamie Friend',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    title: 'Team photo',
                    detail: 'Bears update',
                    createdAt: { seconds: 4102444800 },
                    playerIds: [],
                    playerNames: [],
                    media: []
                }]);
            }
            if (whereClause?.field === 'recipientId') {
                return snapshot([{
                    id: 'friend-1__user-1',
                    memberIds: ['friend-1', 'user-1'],
                    requesterId: 'friend-1',
                    recipientId: 'user-1',
                    status: 'pending',
                    sharedTeamIds: ['team-1'],
                    sharedTeamNames: ['Bears']
                }]);
            }
            if (whereClause?.field === 'discoveryTeamIds') {
                return snapshot([{ id: 'friend-2', displayName: 'Morgan Parent', discoveryTeamIds: ['team-1'] }]);
            }
            return snapshot([]);
        });
        firebaseMocks.getDoc.mockResolvedValue({
            id: 'friend-1',
            exists: () => true,
            data: () => ({ displayName: 'Jamie Friend', email: 'jamie@example.com' })
        });

        const model = await loadSocialHome(user, home);

        expect(model.feedItems.map((item) => item.id)).toEqual(['post-1']);
        expect(model.feedItems.some((item) => item.id.startsWith('derived:'))).toBe(false);
        expect(model.incomingRequests).toEqual([expect.objectContaining({ userId: 'friend-1', name: 'Jamie Friend' })]);
        expect(model.suggestions).toEqual([expect.objectContaining({ userId: 'friend-2', name: 'Morgan Parent' })]);
        expect(model.metrics.feedItems).toBe(1);
        expect(firebaseMocks.where).toHaveBeenCalledWith('requesterId', '==', 'user-1');
        expect(firebaseMocks.where).toHaveBeenCalledWith('recipientId', '==', 'user-1');
        expect(firebaseMocks.where).not.toHaveBeenCalledWith('memberIds', 'array-contains', 'user-1');
    });

    it('merges query results newest-first and applies viewer-local hide and reaction state', async () => {
        const { loadVisibleSocialPosts } = await import('../../apps/app/src/lib/socialService.ts');
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const path = queryRef.collectionRef?.path || [];
            if (path.join('/') === 'users/user-1/hiddenSocialPosts') {
                return snapshot([{ id: 'post-hidden', postId: 'post-hidden' }]);
            }
            if (path.join('/') === 'socialPosts') {
                const whereClause = queryRef.clauses.find((clause) => clause.field);
                if (whereClause?.field === 'teamIds') {
                    return snapshot([
                        { id: 'post-newest', authorId: 'friend-2', title: 'Newest', createdAt: { seconds: 4102444900 }, playerIds: [], playerNames: [], media: [] }
                    ]);
                }
                return snapshot([
                    { id: 'post-hidden', authorId: 'friend-1', title: 'Hidden', createdAt: { seconds: 4102444700 }, playerIds: [], playerNames: [], media: [] },
                    { id: 'post-visible', authorId: 'friend-1', title: 'Visible', createdAt: { seconds: 4102444800 }, playerIds: [], playerNames: [], media: [] }
                ]);
            }
            return snapshot([]);
        });
        firebaseMocks.getDoc.mockImplementation(async (ref) => ({
            exists: () => ref.path.includes('reactions') && ref.path.includes('post-visible')
        }));

        const posts = await loadVisibleSocialPosts(user, {
            players: [], teams: [{ teamId: 'team-1', teamName: 'Bears' }], upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: 1, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        expect(posts).toEqual([
            expect.objectContaining({ id: 'post-newest', viewerHasLiked: false }),
            expect.objectContaining({ id: 'post-visible', viewerHasLiked: true })
        ]);
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    });

    it('pages past a full hidden post window to return older visible feed items', async () => {
        const { loadVisibleSocialPosts } = await import('../../apps/app/src/lib/socialService.ts');
        const hiddenPosts = Array.from({ length: 30 }, (_, index) => ({
            id: `hidden-${index}`,
            authorId: 'friend-1',
            title: `Hidden ${index}`,
            createdAt: { seconds: 4102444900 - index },
            playerIds: [],
            playerNames: [],
            media: []
        }));
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const path = queryRef.collectionRef?.path || [];
            if (path.join('/') === 'users/user-1/hiddenSocialPosts') {
                return snapshot(hiddenPosts.map(({ id }) => ({ id, postId: id })));
            }
            if (path.join('/') === 'socialPosts') {
                const cursorClause = queryRef.clauses.find((clause) => clause.cursor);
                return cursorClause
                    ? snapshot([{
                        id: 'older-visible',
                        authorId: 'friend-1',
                        title: 'Older visible post',
                        createdAt: { seconds: 4102444700 },
                        playerIds: [],
                        playerNames: [],
                        media: []
                    }])
                    : snapshot(hiddenPosts);
            }
            return snapshot([]);
        });

        const posts = await loadVisibleSocialPosts(user, {
            players: [], teams: [], upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: 0, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        expect(posts.map((post) => post.id)).toEqual(['older-visible']);
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(expect.objectContaining({ id: 'hidden-29' }));
    });

    it('loads every hidden-post page so hides beyond the first 200 stay durable', async () => {
        const { loadVisibleSocialPosts } = await import('../../apps/app/src/lib/socialService.ts');
        const firstHiddenPage = Array.from({ length: 200 }, (_, index) => ({ id: `hidden-${index}` }));
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const path = queryRef.collectionRef?.path || [];
            if (path.join('/') === 'users/user-1/hiddenSocialPosts') {
                const cursorClause = queryRef.clauses.find((clause) => clause.cursor);
                return cursorClause ? snapshot([{ id: 'hidden-200' }]) : snapshot(firstHiddenPage);
            }
            if (path.join('/') === 'socialPosts') {
                return snapshot([
                    { id: 'hidden-200', authorId: 'friend-1', title: 'Still hidden', createdAt: { seconds: 4102444900 }, playerIds: [], playerNames: [], media: [] },
                    { id: 'visible-post', authorId: 'friend-1', title: 'Visible', createdAt: { seconds: 4102444800 }, playerIds: [], playerNames: [], media: [] }
                ]);
            }
            return snapshot([]);
        });

        const posts = await loadVisibleSocialPosts(user, {
            players: [], teams: [], upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: 0, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        expect(posts.map((post) => post.id)).toEqual(['visible-post']);
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(expect.objectContaining({ id: 'hidden-199' }));
    });

    it('merges requested and received friendship queries without duplicate friends', async () => {
        const { loadFriendships } = await import('../../apps/app/src/lib/socialService.ts');
        const friendship = {
            id: 'friend-1__user-1',
            memberIds: ['friend-1', 'user-1'],
            requesterId: 'user-1',
            recipientId: 'friend-1',
            status: 'accepted',
            sharedTeamIds: [],
            sharedTeamNames: []
        };
        firebaseMocks.getDocs.mockResolvedValue(snapshot([friendship]));
        firebaseMocks.getDoc.mockResolvedValue({
            id: 'friend-1',
            exists: () => true,
            data: () => ({ displayName: 'Jamie Friend' })
        });

        const friends = await loadFriendships(user);

        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(2);
        expect(friends).toEqual([expect.objectContaining({ userId: 'friend-1', name: 'Jamie Friend' })]);
        expect(firebaseMocks.getDoc).toHaveBeenCalledTimes(1);
    });

    it('loads an accepted friend profile with only viewer-visible posts in newest-first order', async () => {
        const { loadFriendProfile } = await import('../../apps/app/src/lib/socialService.ts');
        firebaseMocks.getDoc.mockImplementation(async (ref) => {
            if (ref.path[0] === 'friendships') {
                return {
                    id: 'friend-1__user-1',
                    exists: () => true,
                    data: () => ({
                        status: 'accepted',
                        memberIds: ['friend-1', 'user-1'],
                        sharedTeamNames: ['Bears']
                    })
                };
            }
            if (ref.path[0] === 'publicUserProfiles') {
                return {
                    id: 'friend-1',
                    exists: () => true,
                    data: () => ({ displayName: 'Jamie Friend', photoUrl: 'https://img.example.test/friend.png' })
                };
            }
            return {
                exists: () => ref.path.includes('post-new') && ref.path.includes('reactions')
            };
        });
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const authorClause = queryRef.clauses?.find((clause) => clause.field === 'authorId');
            if (authorClause) {
                return snapshot([
                    { id: 'post-old', authorId: 'friend-1', authorName: 'Jamie Friend', title: 'Old', createdAt: { seconds: 100 }, visibleUserIds: ['user-1'] },
                    { id: 'post-new', authorId: 'friend-1', authorName: 'Jamie Friend', title: 'New', createdAt: { seconds: 200 }, visibleUserIds: ['user-1'] }
                ]);
            }
            return snapshot([]);
        });

        const profile = await loadFriendProfile(user, 'friend-1');

        expect(profile).toMatchObject({
            userId: 'friend-1',
            name: 'Jamie Friend',
            photoUrl: 'https://img.example.test/friend.png',
            sharedTeamNames: ['Bears'],
            isSelf: false
        });
        expect(profile.posts).toEqual([
            expect.objectContaining({ id: 'post-new', viewerHasLiked: true }),
            expect.objectContaining({ id: 'post-old', viewerHasLiked: false })
        ]);
        expect(firebaseMocks.where).toHaveBeenCalledWith('visibleUserIds', 'array-contains', 'user-1');
        expect(firebaseMocks.where).toHaveBeenCalledWith('authorId', '==', 'friend-1');
        expect(firebaseMocks.where).toHaveBeenCalledWith('hidden', '==', false);
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    });

    it('rejects non-friends before reading a profile or its posts', async () => {
        const { loadFriendProfile } = await import('../../apps/app/src/lib/socialService.ts');
        firebaseMocks.getDoc.mockResolvedValueOnce({
            id: 'friend-1__user-1',
            exists: () => true,
            data: () => ({ status: 'pending', memberIds: ['friend-1', 'user-1'] })
        });

        await expect(loadFriendProfile(user, 'friend-1')).rejects.toThrow('accepted friends only');

        expect(firebaseMocks.getDoc).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.getDoc).toHaveBeenCalledWith(expect.objectContaining({ path: ['friendships', 'friend-1__user-1'] }));
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
    });

    it('allows a user to load their own profile without a friendship lookup', async () => {
        const { loadFriendProfile } = await import('../../apps/app/src/lib/socialService.ts');
        firebaseMocks.getDoc.mockImplementation(async (ref) => ({
            id: ref.path[1],
            exists: () => ref.path[0] === 'publicUserProfiles',
            data: () => ({ displayName: 'Pat Parent' })
        }));

        const profile = await loadFriendProfile(user, 'user-1');

        expect(profile).toMatchObject({ userId: 'user-1', name: 'Pat Parent', isSelf: true });
        expect(firebaseMocks.doc).not.toHaveBeenCalledWith(firebaseMocks.db, 'friendships', expect.anything());
    });

    it('does not drop received requests when the requested query reaches its limit', async () => {
        const { loadFriendships } = await import('../../apps/app/src/lib/socialService.ts');
        const requested = Array.from({ length: 50 }, (_, index) => ({
            id: `friend-${index}__user-1`,
            memberIds: [`friend-${index}`, 'user-1'],
            requesterId: 'user-1',
            recipientId: `friend-${index}`,
            status: 'pending'
        }));
        const received = {
            id: 'friend-incoming__user-1',
            memberIds: ['friend-incoming', 'user-1'],
            requesterId: 'friend-incoming',
            recipientId: 'user-1',
            status: 'pending'
        };
        firebaseMocks.getDocs
            .mockResolvedValueOnce(snapshot(requested))
            .mockResolvedValueOnce(snapshot([received]));
        firebaseMocks.getDoc.mockImplementation(async (ref) => ({
            id: ref.path[1],
            exists: () => true,
            data: () => ({ displayName: ref.path[1] })
        }));

        const friends = await loadFriendships(user);

        expect(friends).toHaveLength(51);
        expect(friends).toContainEqual(expect.objectContaining({
            userId: 'friend-incoming',
            status: 'pending',
            requesterId: 'friend-incoming',
            recipientId: 'user-1'
        }));
    });

    it('searches public profiles by hashed email and shared discovery teams', async () => {
        const { searchSocialUsers } = await import('../../apps/app/src/lib/socialService.ts');
        const home = {
            players: [],
            teams: [{ teamId: 'team-1', teamName: 'Bears' }],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: { players: 0, teams: 1, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        };

        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const whereClause = queryRef.clauses.find((clause) => clause.field);
            if (whereClause?.field === 'emailHash') {
                return snapshot([{ id: 'friend-3', displayName: 'Taylor Parent', discoveryTeamIds: ['team-1'] }]);
            }
            if (whereClause?.field === 'discoveryTeamIds') {
                return snapshot([{ id: 'friend-4', displayName: 'Casey Parent', discoveryTeamIds: ['team-1'] }]);
            }
            return snapshot([]);
        });

        const results = await searchSocialUsers(user, 'taylor@example.com', home);

        expect(firebaseMocks.collection).toHaveBeenCalledWith(firebaseMocks.db, 'publicUserProfiles');
        expect(firebaseMocks.where).toHaveBeenCalledWith('emailHash', '==', 'aabb');
        expect(firebaseMocks.where).toHaveBeenCalledWith('discoveryTeamIds', 'array-contains', 'team-1');
        expect(results).toEqual([expect.objectContaining({ userId: 'friend-3', name: 'Taylor Parent' })]);
    });

    it('reuses chat media upload hardening for social post media', async () => {
        const { uploadSocialPostMedia } = await import('../../apps/app/src/lib/socialService.ts');
        const file = new File(['image'], 'upload.png', { type: 'image/png' });

        const media = await uploadSocialPostMedia('team-1', file);

        expect(chatMocks.uploadTeamChatAttachment).toHaveBeenCalledWith('team-1', file);
        expect(media).toEqual({
            type: 'image',
            url: 'https://img.example.test/upload.png',
            name: 'upload.png',
            thumbnailUrl: null
        });
    });

    it('hides social posts only for the current viewer', async () => {
        const { hideSocialPost } = await import('../../apps/app/src/lib/socialService.ts');

        await hideSocialPost('post-1', user);

        expect(firebaseMocks.setDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['users', 'user-1', 'hiddenSocialPosts', 'post-1'] }),
            {
                postId: 'post-1',
                hiddenAt: { __serverTimestamp: true }
            }
        );
        expect(firebaseMocks.updateDoc).not.toHaveBeenCalled();
    });

    it('atomically toggles the viewer reaction and parent like count', async () => {
        const transaction = {
            get: vi.fn()
                .mockResolvedValueOnce({ exists: () => true, data: () => ({ reactionCounts: { like: 2 } }) })
                .mockResolvedValueOnce({ exists: () => false }),
            set: vi.fn(),
            delete: vi.fn(),
            update: vi.fn()
        };
        firebaseMocks.runTransaction.mockImplementationOnce(async (_db, callback) => callback(transaction));
        const { reactToSocialPost } = await import('../../apps/app/src/lib/socialService.ts');

        const result = await reactToSocialPost('post-1', user);

        expect(result).toEqual({ liked: true, count: 3 });
        expect(transaction.set).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['socialPosts', 'post-1', 'reactions', 'user-1'] }),
            expect.objectContaining({ userId: 'user-1', reactionKey: 'like' })
        );
        expect(transaction.update).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['socialPosts', 'post-1'] }),
            expect.objectContaining({ 'reactionCounts.like': 3 })
        );
    });

    it('atomically removes an existing viewer reaction', async () => {
        const transaction = {
            get: vi.fn()
                .mockResolvedValueOnce({ exists: () => true, data: () => ({ reactionCounts: { like: 2 } }) })
                .mockResolvedValueOnce({ exists: () => true }),
            set: vi.fn(),
            delete: vi.fn(),
            update: vi.fn()
        };
        firebaseMocks.runTransaction.mockImplementationOnce(async (_db, callback) => callback(transaction));
        const { reactToSocialPost } = await import('../../apps/app/src/lib/socialService.ts');

        const result = await reactToSocialPost('post-1', user);

        expect(result).toEqual({ liked: false, count: 1 });
        expect(transaction.delete).toHaveBeenCalledWith(expect.objectContaining({ path: ['socialPosts', 'post-1', 'reactions', 'user-1'] }));
        expect(transaction.set).not.toHaveBeenCalled();
    });
});
