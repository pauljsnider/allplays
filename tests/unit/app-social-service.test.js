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
    limit: vi.fn((count) => ({ count })),
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

        const id = await createSocialPost(user, {
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

        expect(id).toBe('post-new');
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

    it('loads visible posts, friendships, suggestions, and derived prompts into the social home model', async () => {
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
            if (whereClause?.field === 'memberIds') {
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

        expect(model.feedItems.map((item) => item.id)).toEqual(expect.arrayContaining(['post-1', 'derived:player:team-1:player-1']));
        expect(model.incomingRequests).toEqual([expect.objectContaining({ userId: 'friend-1', name: 'Jamie Friend' })]);
        expect(model.suggestions).toEqual([expect.objectContaining({ userId: 'friend-2', name: 'Morgan Parent' })]);
        expect(model.friendshipsError).toBeNull();
        expect(model.metrics.feedItems).toBeGreaterThanOrEqual(2);
    });

    it('surfaces friendship load failures on the social home model', async () => {
        const { loadSocialHome } = await import('../../apps/app/src/lib/socialService.ts');
        const home = {
            players: [],
            teams: [{ teamId: 'team-1', teamName: 'Bears', role: 'Parent', sport: 'Basketball', players: [], nextEvent: null, eventCount: 0, unreadCount: 0, openActions: 0 }],
            upcomingEvents: [],
            actionItems: [],
            fees: [],
            metrics: { players: 0, teams: 1, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        };

        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const whereClause = queryRef.clauses.find((clause) => clause.field);
            if (whereClause?.field === 'memberIds') {
                throw new Error('Missing index for friendships.');
            }
            return snapshot([]);
        });

        const model = await loadSocialHome(user, home);

        expect(model.friendshipsError).toBe('Missing index for friendships.');
        expect(model.incomingRequests).toEqual([]);
        expect(model.metrics.incomingRequests).toBe(0);
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

    it('hides social posts with moderation fields only', async () => {
        const { hideSocialPost } = await import('../../apps/app/src/lib/socialService.ts');

        await hideSocialPost('post-1', user);

        expect(firebaseMocks.updateDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['socialPosts', 'post-1'] }),
            {
                hidden: true,
                hiddenBy: 'user-1',
                hiddenAt: { __serverTimestamp: true },
                updatedAt: { __serverTimestamp: true }
            }
        );
        expect(firebaseMocks.updateDoc.mock.calls[0][1]).not.toHaveProperty('teamId');
        expect(firebaseMocks.updateDoc.mock.calls[0][1]).not.toHaveProperty('teamIds');
        expect(firebaseMocks.updateDoc.mock.calls[0][1]).not.toHaveProperty('visibility');
        expect(firebaseMocks.updateDoc.mock.calls[0][1]).not.toHaveProperty('visibleUserIds');
    });
});
