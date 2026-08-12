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
    documentId: vi.fn(() => '__name__'),
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
    uploadTeamChatAttachment: vi.fn(),
    deleteTeamChatAttachments: vi.fn()
}));

const publicTeamMocks = vi.hoisted(() => ({
    getPublicTeamDetail: vi.fn()
}));

const athleteProfileMocks = vi.hoisted(() => ({
    buildAthleteProfileShareUrl: vi.fn((origin, profileId) => `${origin}/athlete-profile.html?profileId=${encodeURIComponent(profileId)}`)
}));

const profileMocks = vi.hoisted(() => ({
    loadProfileDocument: vi.fn()
}));
const nativeCallableMocks = vi.hoisted(() => ({ callNativeFirebaseFunction: vi.fn() }));
const nativeRuntimeMocks = vi.hoisted(() => ({ isNativeRuntime: vi.fn() }));
const nativeAuthMocks = vi.hoisted(() => ({
    firebaseAuth: { app: { options: { projectId: 'demo-project' } } },
    getNativeAuthIdToken: vi.fn()
}));
const appCheckMocks = vi.hoisted(() => ({
    getPrimaryAppCheckHeaders: vi.fn(async (headers) => ({ ...headers, 'X-Firebase-AppCheck': 'debug-app-check' }))
}));

vi.mock('../../js/firebase.js', () => firebaseMocks);
vi.mock(import('../../apps/app/src/lib/homeService.ts'), () => homeMocks);
vi.mock(import('../../apps/app/src/lib/chatService.ts'), () => chatMocks);
vi.mock(import('../../apps/app/src/lib/publicTeamsService.ts'), () => publicTeamMocks);
vi.mock(import('../../apps/app/src/lib/adapters/legacyPlayerProfile.ts'), () => athleteProfileMocks);
vi.mock(import('../../apps/app/src/lib/profileService.ts'), () => profileMocks);
vi.mock(import('../../apps/app/src/lib/nativeCallable.ts'), () => nativeCallableMocks);
vi.mock(import('../../apps/app/src/lib/nativeRuntime.ts'), () => nativeRuntimeMocks);
vi.mock(import('../../apps/app/src/lib/authService.ts'), () => nativeAuthMocks);
vi.mock(import('../../apps/app/src/lib/adapters/legacyFirebaseAppCheck.ts'), () => appCheckMocks);

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

function nativeJsonResponse(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data
    };
}

function nativeFirestoreDocument(path, fields) {
    return {
        name: `projects/demo-project/databases/(default)/documents/${path}`,
        fields
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    nativeRuntimeMocks.isNativeRuntime.mockReturnValue(false);
    nativeAuthMocks.getNativeAuthIdToken.mockResolvedValue('native-token');
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
        thumbnailUrl: null,
        path: 'chat-attachments/team-1/social/upload.png'
    });
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue(null);
    profileMocks.loadProfileDocument.mockResolvedValue({
        displayName: 'Pat Parent',
        photoUrl: 'https://img.example.test/user.png',
        discoveryTeamIds: []
    });
});

describe('React app social service', () => {
    it('loads only public teams and public athlete profiles for an accepted friend', async () => {
        publicTeamMocks.getPublicTeamDetail.mockImplementation(async (teamId) => {
            if (teamId !== 'team-1') throw new Error('Not public');
            return { id: 'team-1', name: 'Bears', sport: 'Basketball', photoUrl: null };
        });
        firebaseMocks.getDoc.mockImplementation(async (ref) => {
            const path = ref.path.join('/');
            if (path === 'friendships/friend-2__user-1') {
                return {
                    id: 'friend-2__user-1',
                    exists: () => true,
                    data: () => ({
                        status: 'accepted',
                        memberIds: ['friend-2', 'user-1'],
                        sharedTeamIds: ['team-1'],
                        sharedTeamNames: ['Bears']
                    })
                };
            }
            if (path === 'publicUserProfiles/friend-2') {
                return {
                    id: 'friend-2',
                    exists: () => true,
                    data: () => ({ displayName: 'Jamie Friend', discoveryTeamIds: ['team-1', 'private-team'] })
                };
            }
            return { id: ref.path.at(-1), exists: () => false, data: () => ({}) };
        });
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const path = queryRef.collectionRef?.path?.join('/') || '';
            if (path === 'athleteProfiles') {
                return snapshot([{
                    id: 'athlete-1',
                    parentUserId: 'friend-2',
                    privacy: 'public',
                    athlete: { name: 'Jamie Jr.', headline: 'Goalkeeper' },
                    profilePhoto: { url: 'https://img.example.test/athlete.png' }
                }]);
            }
            return snapshot([]);
        });

        const { loadFriendProfile } = await import('../../apps/app/src/lib/socialService.ts');
        const profile = await loadFriendProfile(user, 'friend-2');

        expect(profile.publicTeams).toEqual([{ id: 'team-1', name: 'Bears', sport: 'Basketball', photoUrl: null }]);
        expect(profile.publicChildren).toEqual([expect.objectContaining({
            id: 'athlete-1',
            name: 'Jamie Jr.',
            shareUrl: `${window.location.origin}/athlete-profile.html?profileId=athlete-1`
        })]);
        expect(athleteProfileMocks.buildAthleteProfileShareUrl).toHaveBeenCalledWith(window.location.origin, 'athlete-1');
        expect(profile.messageRoute).toBe('/messages/team-1?compose=user%3Afriend-2&recipientName=Jamie+Friend');
        const athleteQuery = firebaseMocks.getDocs.mock.calls.map(([queryRef]) => queryRef).find((queryRef) => queryRef.collectionRef?.path?.join('/') === 'athleteProfiles');
        expect(athleteQuery.clauses).toEqual(expect.arrayContaining([
            { field: 'parentUserId', op: '==', value: 'friend-2' },
            { field: 'privacy', op: '==', value: 'public' }
        ]));
    });

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
                href: null,
                snapshot: expect.objectContaining({
                    route: '/players/team-1/player-1',
                    href: null
                }),
                visibleUserIds: ['user-1', 'friend-1'],
                media: [expect.objectContaining({ url: 'https://img.example.test/post.png' })],
                reactionCounts: {},
                commentCount: 0,
                hidden: false
            })
        );
    });

    it.each([
        ['an external route', { route: 'https://example.invalid/source' }],
        ['a protocol-relative route', { route: '//example.invalid/source' }],
        ['a backslash route', { route: '/\\example.invalid/source' }],
        ['a control-character route', { route: '/teams/team-1\nnext' }],
        ['an external href', { route: '/teams/team-1', href: 'https://example.invalid/source' }],
        ['a non-web href', { route: '/teams/team-1', href: 'mailto:team@example.invalid' }]
    ])('rejects %s before writing a social post', async (_label, navigation) => {
        const { createSocialPost } = await import('../../apps/app/src/lib/socialService.ts');

        await expect(createSocialPost(user, {
            type: 'team_media',
            visibility: 'team',
            title: 'Team update',
            teamId: 'team-1',
            ...navigation
        })).rejects.toThrow('navigation');
        expect(firebaseMocks.addDoc).not.toHaveBeenCalled();
    });

    it('fails legacy stored navigation closed while preserving the social post', async () => {
        const { loadVisibleSocialPosts } = await import('../../apps/app/src/lib/socialService.ts');
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const path = queryRef.collectionRef?.path?.join('/') || '';
            if (path === 'socialPosts') {
                return snapshot([{
                    id: 'legacy-post',
                    authorId: 'friend-1',
                    title: 'Legacy team update',
                    route: '//example.invalid/source',
                    href: 'mailto:team@example.invalid',
                    createdAt: { seconds: 4102444800 },
                    playerIds: [],
                    playerNames: [],
                    media: []
                }]);
            }
            return snapshot([]);
        });

        const posts = await loadVisibleSocialPosts(user, {
            players: [], teams: [], upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: 0, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        expect(posts).toEqual([
            expect.objectContaining({ id: 'legacy-post', title: 'Legacy team update', route: null, href: null })
        ]);
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

    it('surfaces a failed native team-post query without treating the known feed as complete', async () => {
        nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true);
        const fetchMock = vi.fn(async (url, request) => {
            const requestUrl = String(url);
            if (requestUrl.endsWith('/users/user-1:runQuery')) {
                const body = JSON.parse(String(request?.body || '{}'));
                expect(body.structuredQuery).toMatchObject({
                    from: [{ collectionId: 'hiddenSocialPosts' }],
                    where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'IN' } },
                    limit: 10
                });
                return nativeJsonResponse([]);
            }
            if (requestUrl.endsWith('/documents:runQuery')) {
                const body = JSON.parse(String(request?.body || '{}'));
                const filters = body?.structuredQuery?.where?.compositeFilter?.filters || [];
                const hasTeamFilter = filters.some((filter) => filter?.fieldFilter?.field?.fieldPath === 'teamId');
                if (hasTeamFilter) {
                    return nativeJsonResponse({ error: { message: 'Team feed unavailable.' } }, 503);
                }
                return nativeJsonResponse([{ document: nativeFirestoreDocument('socialPosts/known-post', {
                    authorId: { stringValue: 'friend-1' },
                    authorName: { stringValue: 'Jamie Friend' },
                    title: { stringValue: 'Known update' },
                    hidden: { booleanValue: false },
                    createdAt: { timestampValue: '2026-08-11T12:00:00.000Z' }
                }) }]);
            }
            if (requestUrl.includes('/socialPosts/known-post/reactions/user-1')) {
                return nativeJsonResponse({ error: { message: 'Not found.' } }, 404);
            }
            throw new Error(`Unexpected native request: ${requestUrl}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        const { loadSocialHome } = await import('../../apps/app/src/lib/socialService.ts');

        const model = await loadSocialHome(user, {
            players: [], teams: [{ teamId: 'team-1', teamName: 'Bears' }], upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: 1, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        expect(model.feedItems).toEqual([expect.objectContaining({ id: 'known-post', viewerHasLiked: false })]);
        expect(model.feedError).toContain('Some feed details could not load');
    });

    it('marks team-post discovery partial when the bounded team fan-out is truncated', async () => {
        const { loadSocialHome } = await import('../../apps/app/src/lib/socialService.ts');
        const teams = Array.from({ length: 9 }, (_, index) => ({
            teamId: `team-${index + 1}`,
            teamName: `Team ${index + 1}`
        }));

        const model = await loadSocialHome(user, {
            players: [], teams, upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: teams.length, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        expect(model.feedItems).toEqual([]);
        expect(model.feedError).toContain('Some feed details could not load');
        const queriedTeamIds = firebaseMocks.getDocs.mock.calls
            .map(([queryRef]) => queryRef)
            .filter((queryRef) => queryRef.collectionRef?.path?.join('/') === 'socialPosts')
            .flatMap((queryRef) => queryRef.clauses
                .filter((clause) => clause.field === 'teamId')
                .map((clause) => clause.value));
        expect(queriedTeamIds).toEqual(teams.slice(0, 8).map((team) => team.teamId));
        expect(queriedTeamIds).not.toContain('team-9');
    });

    it('keeps failed native reaction reads unknown so Like cannot invert an existing reaction', async () => {
        nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true);
        vi.stubGlobal('fetch', vi.fn(async (url, request) => {
            const requestUrl = String(url);
            if (requestUrl.endsWith('/users/user-1:runQuery')) {
                const body = JSON.parse(String(request?.body || '{}'));
                expect(body.structuredQuery.where.fieldFilter.value.arrayValue.values).toEqual([
                    { referenceValue: 'projects/demo-project/databases/(default)/documents/users/user-1/hiddenSocialPosts/unknown-reaction-post' }
                ]);
                return nativeJsonResponse([]);
            }
            if (requestUrl.endsWith('/documents:runQuery')) {
                return nativeJsonResponse([{ document: nativeFirestoreDocument('socialPosts/unknown-reaction-post', {
                    authorId: { stringValue: 'friend-1' },
                    title: { stringValue: 'Reaction state pending' },
                    hidden: { booleanValue: false },
                    createdAt: { timestampValue: '2026-08-11T12:00:00.000Z' },
                    reactionCounts: { mapValue: { fields: { like: { integerValue: '2' } } } }
                }) }]);
            }
            if (requestUrl.includes('/socialPosts/unknown-reaction-post/reactions/user-1')) {
                return nativeJsonResponse({ error: { message: 'Reaction read unavailable.' } }, 503);
            }
            throw new Error(`Unexpected native request: ${requestUrl}`);
        }));
        const { loadSocialHome } = await import('../../apps/app/src/lib/socialService.ts');

        const model = await loadSocialHome(user, {
            players: [], teams: [], upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: 0, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        expect(model.feedItems).toEqual([expect.objectContaining({
            id: 'unknown-reaction-post',
            viewerHasLiked: undefined,
            viewerReactionError: true
        })]);
        expect(model.feedError).toContain('Like state');
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
                if (whereClause?.field === 'teamId') {
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
        const socialPostQueries = firebaseMocks.getDocs.mock.calls
            .map(([queryRef]) => queryRef)
            .filter((queryRef) => queryRef.collectionRef?.path?.join('/') === 'socialPosts');
        expect(socialPostQueries).toHaveLength(2);
        socialPostQueries.forEach((queryRef) => {
            expect(queryRef.clauses).toContainEqual({ field: 'hidden', op: '==', value: false });
        });
        expect(socialPostQueries).toContainEqual(expect.objectContaining({
            clauses: expect.arrayContaining([{ field: 'teamId', op: '==', value: 'team-1' }])
        }));
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(firebaseMocks.where).toHaveBeenCalledWith('teamId', '==', 'team-1');
        expect(firebaseMocks.where).toHaveBeenCalledWith('hidden', '==', false);
        const hideCandidateIds = firebaseMocks.getDocs.mock.calls
            .map(([queryRef]) => queryRef)
            .filter((queryRef) => queryRef.collectionRef?.path?.join('/') === 'users/user-1/hiddenSocialPosts')
            .flatMap((queryRef) => queryRef.clauses.find((clause) => clause.field === '__name__')?.value || []);
        expect(hideCandidateIds).toHaveLength(new Set(hideCandidateIds).size);
        expect(new Set(hideCandidateIds)).toEqual(new Set(['post-hidden', 'post-visible', 'post-newest']));
    });

    it('checks every all-visible candidate in the eight-team Home first-page fan-out', async () => {
        const { loadSocialHome } = await import('../../apps/app/src/lib/socialService.ts');
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const path = queryRef.collectionRef?.path?.join('/') || '';
            if (path === 'users/user-1/hiddenSocialPosts') return snapshot([]);
            if (path === 'socialPosts') {
                const teamId = queryRef.clauses.find((clause) => clause.field === 'teamId')?.value || 'main';
                const pageSize = queryRef.clauses.find((clause) => clause.count)?.count || 30;
                return snapshot(Array.from({ length: pageSize }, (_, index) => ({
                    id: `${teamId}-post-${index}`,
                    authorId: 'friend-1',
                    title: 'Visible candidate',
                    createdAt: { seconds: 4102444900 - index },
                    playerIds: [],
                    playerNames: [],
                    media: []
                })));
            }
            return snapshot([]);
        });
        const teams = Array.from({ length: 8 }, (_, index) => ({
            teamId: `team-${index}`,
            teamName: `Team ${index}`
        }));

        const model = await loadSocialHome(user, {
            players: [], teams, upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: teams.length, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        const checkedIds = firebaseMocks.getDocs.mock.calls
            .map(([queryRef]) => queryRef)
            .filter((queryRef) => queryRef.collectionRef?.path?.join('/') === 'users/user-1/hiddenSocialPosts')
            .flatMap((queryRef) => queryRef.clauses.find((clause) => clause.field === '__name__')?.value || []);
        expect(checkedIds).toHaveLength(126);
        expect(new Set(checkedIds).size).toBe(126);
        expect(model.feedItems).toHaveLength(30);
        expect(model.feedError).toBeNull();
    });

    it('shares one 126-candidate Home hide budget across all feed branches', async () => {
        const { loadSocialHome } = await import('../../apps/app/src/lib/socialService.ts');
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const path = queryRef.collectionRef?.path?.join('/') || '';
            if (path === 'users/user-1/hiddenSocialPosts') {
                const ids = queryRef.clauses.find((clause) => clause.field === '__name__')?.value || [];
                return snapshot(ids.map((id) => ({ id })));
            }
            if (path === 'socialPosts') {
                const teamId = queryRef.clauses.find((clause) => clause.field === 'teamId')?.value || 'main';
                const pageSize = queryRef.clauses.find((clause) => clause.count)?.count || 30;
                const page = queryRef.clauses.some((clause) => clause.cursor) ? 2 : 1;
                return snapshot(Array.from({ length: pageSize }, (_, index) => ({
                    id: `${teamId}-page-${page}-post-${index}`,
                    authorId: 'friend-1',
                    title: 'Hidden candidate',
                    createdAt: { seconds: 4102444900 - index },
                    playerIds: [],
                    playerNames: [],
                    media: []
                })));
            }
            return snapshot([]);
        });
        const teams = Array.from({ length: 8 }, (_, index) => ({
            teamId: `team-${index}`,
            teamName: `Team ${index}`
        }));

        const model = await loadSocialHome(user, {
            players: [], teams, upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: teams.length, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        const checkedIds = firebaseMocks.getDocs.mock.calls
            .map(([queryRef]) => queryRef)
            .filter((queryRef) => queryRef.collectionRef?.path?.join('/') === 'users/user-1/hiddenSocialPosts')
            .flatMap((queryRef) => queryRef.clauses.find((clause) => clause.field === '__name__')?.value || []);
        expect(checkedIds).toHaveLength(126);
        expect(new Set(checkedIds).size).toBe(126);
        expect(model.feedItems).toEqual([]);
        expect(model.feedError).toContain('Some feed details could not load');
    });

    it('fails hidden-candidate lookup closed and surfaces a retryable feed state', async () => {
        const { loadSocialHome } = await import('../../apps/app/src/lib/socialService.ts');
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const path = queryRef.collectionRef?.path?.join('/') || '';
            if (path === 'users/user-1/hiddenSocialPosts') throw new Error('Hide lookup unavailable');
            if (path === 'socialPosts') {
                return snapshot([{
                    id: 'unverified-post',
                    authorId: 'friend-1',
                    title: 'Must not render',
                    createdAt: { seconds: 4102444900 },
                    playerIds: [],
                    playerNames: [],
                    media: []
                }]);
            }
            return snapshot([]);
        });

        const model = await loadSocialHome(user, {
            players: [], teams: [], upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: 0, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        expect(model.feedItems).toEqual([]);
        expect(model.feedError).toContain('Some feed details could not load');
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

    it('checks only bounded candidate IDs so large hide histories do not add reads', async () => {
        const { loadVisibleSocialPosts } = await import('../../apps/app/src/lib/socialService.ts');
        const candidatePosts = Array.from({ length: 12 }, (_, index) => ({
            id: index === 11 ? 'hidden-beyond-history' : `visible-${index}`,
            authorId: 'friend-1',
            title: `Candidate ${index}`,
            createdAt: { seconds: 4102444900 - index },
            playerIds: [],
            playerNames: [],
            media: []
        }));
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const path = queryRef.collectionRef?.path || [];
            if (path.join('/') === 'users/user-1/hiddenSocialPosts') {
                const candidateClause = queryRef.clauses.find((clause) => clause.field === '__name__');
                return snapshot(candidateClause?.value.includes('hidden-beyond-history')
                    ? [{ id: 'hidden-beyond-history' }]
                    : []);
            }
            if (path.join('/') === 'socialPosts') {
                return snapshot(candidatePosts);
            }
            return snapshot([]);
        });

        const posts = await loadVisibleSocialPosts(user, {
            players: [], teams: [], upcomingEvents: [], actionItems: [], fees: [],
            metrics: { players: 0, teams: 0, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
        });

        expect(posts.map((post) => post.id)).toEqual(candidatePosts.slice(0, 11).map((post) => post.id));
        const hideQueries = firebaseMocks.getDocs.mock.calls
            .map(([queryRef]) => queryRef)
            .filter((queryRef) => queryRef.collectionRef?.path?.join('/') === 'users/user-1/hiddenSocialPosts');
        expect(hideQueries).toHaveLength(2);
        const requestedCandidateIds = hideQueries.flatMap((queryRef) => (
            queryRef.clauses.find((clause) => clause.field === '__name__')?.value || []
        ));
        expect(requestedCandidateIds).toEqual(candidatePosts.map((post) => post.id));
        hideQueries.forEach((queryRef) => {
            expect(queryRef.clauses).toContainEqual({ field: '__name__', op: 'in', value: expect.any(Array) });
            expect(queryRef.clauses.find((clause) => clause.field === '__name__').value.length).toBeLessThanOrEqual(10);
            expect(queryRef.clauses).toContainEqual({ count: 10 });
            expect(queryRef.clauses.some((clause) => clause.cursor)).toBe(false);
        });
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

    it('hydrates friend profile teams and post reactions on independent overlapping branches', async () => {
        const publicTeamRequest = deferred();
        const postQueryRequest = deferred();
        const reactionRequest = deferred();
        publicTeamMocks.getPublicTeamDetail.mockReturnValue(publicTeamRequest.promise);
        firebaseMocks.getDoc.mockImplementation((ref) => {
            const path = ref.path.join('/');
            if (path === 'friendships/friend-1__user-1') {
                return Promise.resolve({
                    id: 'friend-1__user-1',
                    exists: () => true,
                    data: () => ({ status: 'accepted', memberIds: ['friend-1', 'user-1'] })
                });
            }
            if (path === 'publicUserProfiles/friend-1') {
                return Promise.resolve({
                    id: 'friend-1',
                    exists: () => true,
                    data: () => ({ displayName: 'Jamie Friend', discoveryTeamIds: ['team-1'] })
                });
            }
            if (path === 'socialPosts/post-1/reactions/user-1') {
                return reactionRequest.promise;
            }
            return Promise.resolve({ id: ref.path.at(-1), exists: () => false, data: () => ({}) });
        });
        firebaseMocks.getDocs.mockImplementation((queryRef) => {
            const path = queryRef.collectionRef?.path?.join('/') || '';
            if (path === 'socialPosts') return postQueryRequest.promise;
            return Promise.resolve(snapshot([]));
        });

        const { loadFriendProfile } = await import('../../apps/app/src/lib/socialService.ts');
        let completed = false;
        const profilePromise = loadFriendProfile(user, 'friend-1').then((profile) => {
            completed = true;
            return profile;
        });

        await vi.waitFor(() => {
            expect(publicTeamMocks.getPublicTeamDetail).toHaveBeenCalledWith('team-1');
            expect(firebaseMocks.getDocs).toHaveBeenCalledWith(expect.objectContaining({
                collectionRef: expect.objectContaining({ path: ['socialPosts'] })
            }));
        });
        expect(completed).toBe(false);

        postQueryRequest.resolve(snapshot([{
            id: 'post-1',
            authorId: 'friend-1',
            authorName: 'Jamie Friend',
            title: 'Newest post',
            createdAt: { seconds: 200 },
            visibleUserIds: ['user-1']
        }]));
        await vi.waitFor(() => expect(firebaseMocks.getDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: ['socialPosts', 'post-1', 'reactions', 'user-1'] })
        ));
        expect(completed).toBe(false);

        reactionRequest.resolve({ exists: () => true });
        await Promise.resolve();
        expect(completed).toBe(false);

        publicTeamRequest.resolve({ id: 'team-1', name: 'Bears', sport: 'Basketball', photoUrl: null });
        const profile = await profilePromise;

        expect(profile.publicTeams).toEqual([{ id: 'team-1', name: 'Bears', sport: 'Basketball', photoUrl: null }]);
        expect(profile.posts).toEqual([expect.objectContaining({ id: 'post-1', viewerHasLiked: true })]);
    });

    it('checks only friend-profile candidates and pages to older visible posts', async () => {
        const { loadFriendProfile } = await import('../../apps/app/src/lib/socialService.ts');
        const unrelatedHistoricalIds = new Set(Array.from({ length: 250 }, (_, index) => `historical-${index}`));
        const hiddenPosts = Array.from({ length: 30 }, (_, index) => ({
            id: `hidden-${index}`,
            authorId: 'friend-1',
            authorName: 'Jamie Friend',
            title: `Hidden ${index}`,
            createdAt: { seconds: 200 - index }
        }));
        const olderVisiblePosts = Array.from({ length: 30 }, (_, index) => ({
            id: `visible-${index}`,
            authorId: 'friend-1',
            authorName: 'Jamie Friend',
            title: `Visible ${index}`,
            createdAt: { seconds: 100 - index }
        }));
        firebaseMocks.getDoc.mockImplementation(async (ref) => {
            if (ref.path[0] === 'friendships') {
                return {
                    id: 'friend-1__user-1',
                    exists: () => true,
                    data: () => ({ status: 'accepted', memberIds: ['friend-1', 'user-1'] })
                };
            }
            if (ref.path[0] === 'publicUserProfiles') {
                return {
                    id: 'friend-1',
                    exists: () => true,
                    data: () => ({ displayName: 'Jamie Friend' })
                };
            }
            return { exists: () => false };
        });
        firebaseMocks.getDocs.mockImplementation(async (queryRef) => {
            const path = queryRef.collectionRef?.path || [];
            if (path.join('/') === 'users/user-1/hiddenSocialPosts') {
                const candidateIds = queryRef.clauses.find((clause) => clause.field === '__name__')?.value || [];
                return snapshot(candidateIds
                    .filter((id) => id.startsWith('hidden-'))
                    .map((id) => ({ id, postId: id })));
            }
            if (path.join('/') === 'socialPosts') {
                const cursorClause = queryRef.clauses.find((clause) => clause.cursor);
                return cursorClause ? snapshot(olderVisiblePosts) : snapshot(hiddenPosts);
            }
            return snapshot([]);
        });

        const profile = await loadFriendProfile(user, 'friend-1');

        expect(profile.posts).toHaveLength(30);
        expect(profile.posts.map((post) => post.id)).toEqual(olderVisiblePosts.map((post) => post.id));
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(expect.objectContaining({ id: 'hidden-29' }));
        const hideQueries = firebaseMocks.getDocs.mock.calls
            .map(([queryRef]) => queryRef)
            .filter((queryRef) => queryRef.collectionRef?.path?.join('/') === 'users/user-1/hiddenSocialPosts');
        const checkedIds = hideQueries.flatMap((queryRef) => (
            queryRef.clauses.find((clause) => clause.field === '__name__')?.value || []
        ));
        expect(checkedIds).toEqual([
            ...hiddenPosts.map((post) => post.id),
            ...olderVisiblePosts.map((post) => post.id)
        ]);
        expect(checkedIds.some((id) => unrelatedHistoricalIds.has(id))).toBe(false);
        expect(hideQueries.every((queryRef) => queryRef.clauses.every((clause) => !clause.cursor))).toBe(true);
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

        const profile = await loadFriendProfile(user, 'user-1');

        expect(profile).toMatchObject({ userId: 'user-1', name: 'Pat Parent', isSelf: true });
        expect(profileMocks.loadProfileDocument).toHaveBeenCalledWith('user-1');
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
            thumbnailUrl: null,
            storagePath: 'chat-attachments/team-1/social/upload.png'
        });
    });

    it('discards an uploaded social attachment when its post is not saved', async () => {
        const { discardSocialPostMediaUpload } = await import('../../apps/app/src/lib/socialService.ts');

        await discardSocialPostMediaUpload({
            type: 'image',
            url: 'https://img.example.test/upload.png',
            name: 'upload.png',
            thumbnailUrl: null,
            storagePath: 'chat-attachments/team-1/social/upload.png'
        });

        expect(chatMocks.deleteTeamChatAttachments).toHaveBeenCalledWith([
            expect.objectContaining({
                url: 'https://img.example.test/upload.png',
                path: 'chat-attachments/team-1/social/upload.png'
            })
        ]);
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

    it('uses the native-authenticated callable to hide posts in Capacitor', async () => {
        nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true);
        nativeCallableMocks.callNativeFirebaseFunction.mockResolvedValue({ hidden: true });
        const { hideSocialPost } = await import('../../apps/app/src/lib/socialService.ts');

        await hideSocialPost('post-1', user);

        expect(nativeCallableMocks.callNativeFirebaseFunction).toHaveBeenCalledWith(
            'hideSocialPostForCaller',
            { postId: 'post-1' },
            { errorLabel: 'Hide social post' }
        );
        expect(firebaseMocks.setDoc).not.toHaveBeenCalled();
    });

    it('uses native-authenticated callables for comments and reports in Capacitor', async () => {
        nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true);
        nativeCallableMocks.callNativeFirebaseFunction
            .mockResolvedValueOnce({ commented: true, commentId: 'comment-1' })
            .mockResolvedValueOnce({ reported: true, reportId: 'report-1' });
        const { commentOnSocialPost, reportSocialPost } = await import('../../apps/app/src/lib/socialService.ts');

        await commentOnSocialPost('post-1', user, '  Great update!  ');
        await reportSocialPost('post-1', user, 'Needs review');

        expect(nativeCallableMocks.callNativeFirebaseFunction).toHaveBeenNthCalledWith(
            1,
            'commentOnSocialPostForCaller',
            { postId: 'post-1', text: 'Great update!' },
            { errorLabel: 'Social comment' }
        );
        expect(nativeCallableMocks.callNativeFirebaseFunction).toHaveBeenNthCalledWith(
            2,
            'reportSocialPostForCaller',
            { postId: 'post-1', reason: 'Needs review' },
            { errorLabel: 'Social report' }
        );
        expect(firebaseMocks.addDoc).not.toHaveBeenCalled();
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

    it('uses the native-authenticated callable to toggle reactions in Capacitor', async () => {
        nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true);
        nativeCallableMocks.callNativeFirebaseFunction.mockResolvedValue({ liked: true, count: 3 });
        const { reactToSocialPost } = await import('../../apps/app/src/lib/socialService.ts');

        await expect(reactToSocialPost('post-1', user)).resolves.toEqual({ liked: true, count: 3 });
        expect(nativeCallableMocks.callNativeFirebaseFunction).toHaveBeenCalledWith(
            'toggleSocialPostReaction',
            { postId: 'post-1', reactionKey: 'like' },
            { errorLabel: 'Social reaction' }
        );
        expect(firebaseMocks.runTransaction).not.toHaveBeenCalled();
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
