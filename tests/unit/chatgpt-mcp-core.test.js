import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    DomainError,
    resolveUserContext,
    listMyTeams,
    getFamilySchedule,
    getGameSummary
} from '../../services/chatgpt-mcp/src/core.js';
import {
    createIdentityResolver,
    extractBearerToken,
    decodeJwtPayload
} from '../../services/chatgpt-mcp/src/identity.js';
import {
    encodeValue,
    decodeValue,
    decodeFields,
    buildStructuredQuery,
    createUserDb
} from '../../services/chatgpt-mcp/src/firestoreRest.js';

// Minimal fake of the db interface core.js uses (same surface as the
// firestoreRest adapter): doc(path).get(), collection(path).where()...get().
// Set docs[path] = DENIED to simulate a Firestore-rules denial.
const DENIED = Symbol('permission-denied');

function fakeDb({ docs = {}, queries = {} } = {}) {
    return {
        doc(path) {
            return {
                async get() {
                    const data = docs[path];
                    if (data === DENIED) throw new DomainError('permission_denied', 'You do not have access to this data.');
                    return {
                        exists: data !== undefined,
                        id: path.split('/').pop(),
                        data: () => data
                    };
                }
            };
        },
        collection(path) {
            const makeQuery = (filters) => ({
                where(field, op, value) {
                    return makeQuery([...filters, { field, op, value }]);
                },
                orderBy() { return makeQuery(filters); },
                limit() { return makeQuery(filters); },
                async get() {
                    const resolver = queries[path];
                    if (resolver === DENIED) throw new DomainError('permission_denied', 'You do not have access to this data.');
                    const rows = resolver ? resolver(filters) : [];
                    return {
                        docs: rows.map(({ id, data }) => ({ id, data: () => data }))
                    };
                }
            });
            return makeQuery([]);
        }
    };
}

const parentIdentity = { uid: 'parent-1', email: 'Parent@Example.com' };

function parentDb(extra = {}) {
    return fakeDb({
        docs: {
            'users/parent-1': {
                email: 'parent@example.com',
                parentOf: [{ teamId: 'team-a', playerId: 'player-1' }]
            },
            'teams/team-a': { name: 'Wildcats', ownerId: 'coach-9', sport: 'Baseball' },
            'teams/team-a/players/player-1': {
                name: 'Sam',
                number: 12,
                birthDate: '2015-01-01',
                medicalNotes: 'private'
            },
            ...extra.docs
        },
        queries: {
            teams: () => [],
            ...extra.queries
        }
    });
}

describe('chatgpt-mcp core: resolveUserContext', () => {
    it('derives parent role and linked players from users/{uid}.parentOf', async () => {
        const context = await resolveUserContext(parentDb(), parentIdentity);
        expect(context.uid).toBe('parent-1');
        expect(context.isGlobalAdmin).toBe(false);
        const entry = context.teams.get('team-a');
        expect([...entry.roles]).toEqual(['parent']);
        expect([...entry.linkedPlayerIds]).toEqual(['player-1']);
    });

    it('derives owner and admin roles from teams queries with lowercased email', async () => {
        let adminEmailQueried = null;
        const db = fakeDb({
            docs: { 'users/coach-1': { email: 'Coach@Example.com' } },
            queries: {
                teams: (filters) => {
                    const byOwner = filters.find((f) => f.field === 'ownerId');
                    if (byOwner) return [{ id: 'team-own', data: { name: 'Owned', ownerId: 'coach-1' } }];
                    adminEmailQueried = filters.find((f) => f.field === 'adminEmails')?.value;
                    return [{ id: 'team-adm', data: { name: 'Helped' } }];
                }
            }
        });
        const context = await resolveUserContext(db, { uid: 'coach-1', email: 'Coach@Example.com' });
        expect(adminEmailQueried).toBe('coach@example.com');
        expect([...context.teams.get('team-own').roles]).toEqual(['owner']);
        expect([...context.teams.get('team-adm').roles]).toEqual(['admin']);
    });

    it('keeps private parent teams when direct team reads are denied by rules', async () => {
        const db = parentDb({
            docs: {
                'users/parent-1': {
                    email: 'parent@example.com',
                    parentOf: [{ teamId: 'team-private', playerId: 'player-x' }],
                    parentTeamIds: ['team-private'],
                    parentPlayerKeys: ['team-private::player-x']
                },
                'teams/team-private': DENIED
            }
        });
        const context = await resolveUserContext(db, parentIdentity);
        const entry = context.teams.get('team-private');
        expect([...entry.roles]).toEqual(['parent']);
        expect([...entry.linkedPlayerIds]).toEqual(['player-x']);
        expect(entry.team).toEqual({});
    });

    it('derives parent scope from normalized access keys when parentOf is empty', async () => {
        const db = parentDb({
            docs: {
                'users/parent-1': {
                    email: 'parent@example.com',
                    parentOf: [],
                    parentTeamIds: ['team-a'],
                    parentPlayerKeys: ['team-a::player-1', 'invalid-key']
                }
            }
        });
        const context = await resolveUserContext(db, parentIdentity);
        expect([...context.teams.get('team-a').roles]).toEqual(['parent']);
        expect([...context.teams.get('team-a').linkedPlayerIds]).toEqual(['player-1']);
    });

    it('rejects a missing uid as unauthenticated', async () => {
        await expect(resolveUserContext(parentDb(), {})).rejects.toMatchObject({ code: 'unauthenticated' });
    });
});

describe('chatgpt-mcp core: listMyTeams', () => {
    it('returns only whitelisted player fields (no birth date or medical notes)', async () => {
        const db = parentDb();
        const context = await resolveUserContext(db, parentIdentity);
        const { teams } = await listMyTeams(db, context);
        expect(teams).toHaveLength(1);
        expect(teams[0].roles).toEqual(['parent']);
        expect(teams[0].linkedPlayers).toEqual([{ playerId: 'player-1', name: 'Sam', number: 12 }]);
        expect(JSON.stringify(teams)).not.toContain('medical');
        expect(JSON.stringify(teams)).not.toContain('birthDate');
    });
});

describe('chatgpt-mcp core: getFamilySchedule', () => {
    function scheduleDb() {
        return parentDb({
            docs: {
                'teams/team-a/games/game-1/rsvps/parent-1': {
                    response: 'going',
                    playerIds: ['player-1', 'player-other-team'],
                    note: 'private rsvp note'
                }
            },
            queries: {
                teams: () => [],
                'teams/team-a/games': (filters) => {
                    const start = filters.find((f) => f.op === '>=').value;
                    const end = filters.find((f) => f.op === '<=').value;
                    const all = [
                        { id: 'game-1', data: { type: 'game', date: new Date('2026-07-25T17:00:00Z'), opponent: 'Hawks', location: 'Field 2', privateNotes: 'secret', rsvpSummary: { going: 5, notResponded: 3, coachOnly: 'x' } } },
                        { id: 'practice-1', data: { type: 'practice', date: new Date('2026-07-27T22:30:00Z') } },
                        { id: 'game-out-of-range', data: { type: 'game', date: new Date('2026-09-01T17:00:00Z') } }
                    ];
                    return all.filter(({ data }) => data.date >= start && data.date <= end);
                }
            }
        });
    }

    it('returns range-filtered, whitelisted events with the caller\'s own RSVP', async () => {
        const db = scheduleDb();
        const context = await resolveUserContext(db, parentIdentity);
        const result = await getFamilySchedule(db, context, { startDate: '2026-07-24', endDate: '2026-07-31' });

        expect(result.events.map((e) => e.gameId)).toEqual(['game-1', 'practice-1']);
        const game = result.events[0];
        expect(game.opponent).toBe('Hawks');
        expect(game.rsvpSummary).toEqual({ going: 5, notResponded: 3 });
        expect(game.myRsvp.response).toBe('going');
        // RSVP player ids are filtered to the caller's linked players.
        expect(game.myRsvp.playerIds).toEqual(['player-1']);
        expect(game.deepLink).toContain('live-game.html?teamId=team-a&gameId=game-1');
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('secret');
        expect(serialized).not.toContain('private rsvp note');
    });

    it('defaults missing RSVPs to not_responded', async () => {
        const db = scheduleDb();
        const context = await resolveUserContext(db, parentIdentity);
        const result = await getFamilySchedule(db, context, { startDate: '2026-07-24', endDate: '2026-07-31' });
        expect(result.events[1].myRsvp).toEqual({ response: 'not_responded', playerIds: [] });
    });

    it('rejects an invalid date range', async () => {
        const db = scheduleDb();
        const context = await resolveUserContext(db, parentIdentity);
        await expect(getFamilySchedule(db, context, { startDate: '2026-07-31', endDate: '2026-07-01' }))
            .rejects.toMatchObject({ code: 'invalid_argument' });
    });
});

describe('chatgpt-mcp core: getGameSummary', () => {
    function summaryDb(extra = {}) {
        return parentDb({
            docs: {
                'teams/team-a/games/game-1': {
                    type: 'game',
                    date: new Date('2026-07-12T17:00:00Z'),
                    opponent: 'Hawks',
                    homeScore: 7,
                    awayScore: 4,
                    summary: 'Close win.',
                    trackerInternalState: { secret: true }
                },
                ...extra.docs
            },
            queries: {
                teams: () => [],
                'teams/team-a/games/game-1/aggregatedStats': () => [
                    { id: 'player-1', data: { playerName: 'Sam', playerNumber: 12, hits: 2, runs: 1 } }
                ],
                ...extra.queries
            }
        });
    }

    it('returns whitelisted game fields and aggregated stats for an authorized team', async () => {
        const db = summaryDb();
        const context = await resolveUserContext(db, parentIdentity);
        const result = await getGameSummary(db, context, { teamId: 'team-a', gameId: 'game-1' });
        expect(result.game.homeScore).toBe(7);
        expect(result.game.summary).toBe('Close win.');
        expect(result.game.trackerInternalState).toBeUndefined();
        expect(result.playerStats).toEqual([
            { playerId: 'player-1', playerName: 'Sam', playerNumber: 12, stats: { hits: 2, runs: 1 } }
        ]);
        expect(result.deepLink).toContain('replay=true');
    });

    it('denies access to a team the user is not a member of (foreign team id from the model)', async () => {
        const db = summaryDb();
        const context = await resolveUserContext(db, parentIdentity);
        await expect(getGameSummary(db, context, { teamId: 'team-other', gameId: 'game-1' }))
            .rejects.toMatchObject({ code: 'permission_denied' });
    });

    it('degrades to empty stats when rules deny the aggregatedStats query', async () => {
        const db = summaryDb({ queries: { 'teams/team-a/games/game-1/aggregatedStats': DENIED } });
        const context = await resolveUserContext(db, parentIdentity);
        const result = await getGameSummary(db, context, { teamId: 'team-a', gameId: 'game-1' });
        expect(result.playerStats).toEqual([]);
    });

    it('returns not_found for a missing game on an authorized team', async () => {
        const db = summaryDb();
        const context = await resolveUserContext(db, parentIdentity);
        await expect(getGameSummary(db, context, { teamId: 'team-a', gameId: 'nope' }))
            .rejects.toMatchObject({ code: 'not_found' });
    });

    it('returns a summary with an empty team name for global-admin-only access', async () => {
        const db = summaryDb({
            docs: {
                'users/admin-1': { email: 'admin@example.com', isAdmin: true },
                'teams/team-other/games/game-1': {
                    type: 'game',
                    date: new Date('2026-07-12T17:00:00Z')
                }
            },
            queries: {
                'teams/team-other/games/game-1/aggregatedStats': () => []
            }
        });
        const context = await resolveUserContext(db, { uid: 'admin-1', email: 'admin@example.com' });
        const result = await getGameSummary(db, context, { teamId: 'team-other', gameId: 'game-1' });
        expect(result.game.teamName).toBe('');
    });
});

function makeJwt(payload) {
    const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    return `${encode({ alg: 'RS256' })}.${encode(payload)}.fakesig`;
}

describe('chatgpt-mcp identity', () => {
    it('extracts bearer tokens case-insensitively', () => {
        expect(extractBearerToken('Bearer abc')).toBe('abc');
        expect(extractBearerToken('bearer abc')).toBe('abc');
        expect(extractBearerToken('Basic abc')).toBeNull();
        expect(extractBearerToken(undefined)).toBeNull();
    });

    it('decodes JWT payloads and rejects non-JWTs', () => {
        expect(decodeJwtPayload(makeJwt({ user_id: 'u1' }))).toMatchObject({ user_id: 'u1' });
        expect(decodeJwtPayload('a-refresh-token')).toBeNull();
    });

    it('accepts an unexpired ID token bearer directly', async () => {
        const resolve = createIdentityResolver({ apiKey: 'k', fetchImpl: () => { throw new Error('no fetch expected'); }, now: () => 1000 });
        const token = makeJwt({ user_id: 'u1', email: 'a@b.c', exp: 2 });
        const identity = await resolve(`Bearer ${token}`);
        expect(identity).toMatchObject({ uid: 'u1', email: 'a@b.c', via: 'id-token', idToken: token });
    });

    it('rejects an expired ID token', async () => {
        const resolve = createIdentityResolver({ apiKey: 'k', fetchImpl: () => { throw new Error('no fetch expected'); }, now: () => 5000 });
        await expect(resolve(`Bearer ${makeJwt({ user_id: 'u1', exp: 2 })}`))
            .rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('exchanges refresh tokens via securetoken and caches until expiry', async () => {
        let calls = 0;
        let time = 0;
        const idToken = makeJwt({ user_id: 'u1', email: 'a@b.c' });
        const fetchImpl = async (url, options) => {
            calls += 1;
            expect(url).toBe('https://securetoken.googleapis.com/v1/token');
            expect(options.headers['X-goog-api-key']).toBe('test-key');
            // The public API key is referrer-restricted to the AllPlays site.
            expect(options.headers.Referer).toBe('https://allplays.ai/');
            expect(options.body).toContain('grant_type=refresh_token');
            return { ok: true, json: async () => ({ user_id: 'u1', id_token: idToken, expires_in: '3600' }) };
        };
        const resolve = createIdentityResolver({ apiKey: 'test-key', fetchImpl, now: () => time });

        const first = await resolve('Bearer my-refresh-token');
        expect(first).toMatchObject({ uid: 'u1', email: 'a@b.c', via: 'refresh-token', idToken });

        time = 30 * 60 * 1000;
        await resolve('Bearer my-refresh-token');
        expect(calls).toBe(1);

        time = 3600 * 1000;
        await resolve('Bearer my-refresh-token');
        expect(calls).toBe(2);
    });

    it('rejects missing and revoked tokens as unauthenticated', async () => {
        const resolve = createIdentityResolver({ apiKey: 'k', fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
        await expect(resolve(undefined)).rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(resolve('Bearer revoked-token')).rejects.toBeInstanceOf(DomainError);
    });

    it('rejects malformed successful token exchange responses as unauthenticated', async () => {
        const resolve = createIdentityResolver({
            apiKey: 'k',
            fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('not json'); } })
        });
        await expect(resolve('Bearer refresh-token')).rejects.toMatchObject({
            code: 'unauthenticated',
            message: 'Invalid token exchange response.'
        });
    });
});

describe('chatgpt-mcp server configuration', () => {
    it('requires Firebase configuration without committed fallback values', () => {
        const source = readFileSync(new URL('../../services/chatgpt-mcp/src/server.js', import.meta.url), 'utf8');
        expect(source).toContain('const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;');
        expect(source).toContain('const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;');
        expect(source).toContain('if (!PROJECT_ID || !WEB_API_KEY)');
        expect(source).not.toMatch(/AIza[0-9A-Za-z_-]+/);
    });
});

describe('chatgpt-mcp firestore REST adapter', () => {
    it('round-trips values through encode/decode', () => {
        const date = new Date('2026-07-25T17:00:00.000Z');
        expect(decodeValue(encodeValue('x'))).toBe('x');
        expect(decodeValue(encodeValue(7))).toBe(7);
        expect(decodeValue(encodeValue(2.5))).toBe(2.5);
        expect(decodeValue(encodeValue(true))).toBe(true);
        expect(decodeValue(encodeValue(null))).toBeNull();
        expect(decodeValue(encodeValue(date))).toEqual(date);
        expect(decodeValue(encodeValue({ a: [1, 'b'] }))).toEqual({ a: [1, 'b'] });
    });

    it('builds structured queries with filters, order, and limit', () => {
        const query = buildStructuredQuery('games', {
            filters: [
                { field: 'date', op: '>=', value: new Date('2026-07-24T00:00:00Z') },
                { field: 'date', op: '<=', value: new Date('2026-07-31T00:00:00Z') }
            ],
            orderBy: { field: 'date', direction: 'asc' },
            limit: 50
        });
        expect(query.from).toEqual([{ collectionId: 'games' }]);
        expect(query.where.compositeFilter.op).toBe('AND');
        expect(query.where.compositeFilter.filters[0].fieldFilter.op).toBe('GREATER_THAN_OR_EQUAL');
        expect(query.orderBy).toEqual([{ field: { fieldPath: 'date' }, direction: 'ASCENDING' }]);
        expect(query.limit).toBe(50);
    });

    it('fetches documents with the user\'s ID token and decodes fields', async () => {
        let captured;
        const db = createUserDb({
            projectId: 'p1',
            idToken: 'user-id-token',
            fetchImpl: async (url, options = {}) => {
                captured = { url, options };
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        name: 'projects/p1/databases/(default)/documents/teams/team-a',
                        fields: { name: { stringValue: 'Wildcats' }, founded: { integerValue: '2020' } }
                    })
                };
            }
        });
        const snap = await db.doc('teams/team-a').get();
        expect(captured.url).toBe('https://firestore.googleapis.com/v1/projects/p1/databases/(default)/documents/teams/team-a');
        expect(captured.options.headers.Authorization).toBe('Bearer user-id-token');
        expect(snap.exists).toBe(true);
        expect(snap.data()).toEqual({ name: 'Wildcats', founded: 2020 });
    });

    it('maps 404 to exists:false and 403 to permission_denied', async () => {
        const dbFor = (status) => createUserDb({
            projectId: 'p1',
            idToken: 't',
            fetchImpl: async () => ({ ok: false, status, json: async () => ({}) })
        });
        const missing = await dbFor(404).doc('teams/none').get();
        expect(missing.exists).toBe(false);
        await expect(dbFor(403).doc('teams/secret').get()).rejects.toMatchObject({ code: 'permission_denied' });
    });

    it('runs subcollection queries against the parent document path', async () => {
        let captured;
        const db = createUserDb({
            projectId: 'p1',
            idToken: 't',
            fetchImpl: async (url, options = {}) => {
                captured = { url, body: JSON.parse(options.body) };
                return {
                    ok: true,
                    status: 200,
                    json: async () => ([
                        { document: { name: '.../games/game-1', fields: { opponent: { stringValue: 'Hawks' } } } },
                        { readTime: 'ignored-partial-result' }
                    ])
                };
            }
        });
        const snap = await db.collection('teams/team-a/games')
            .where('date', '>=', new Date('2026-07-24T00:00:00Z'))
            .orderBy('date')
            .limit(10)
            .get();
        expect(captured.url).toContain('/documents/teams/team-a:runQuery');
        expect(captured.body.structuredQuery.from).toEqual([{ collectionId: 'games' }]);
        expect(snap.docs).toHaveLength(1);
        expect(snap.docs[0].id).toBe('game-1');
        expect(snap.docs[0].data()).toEqual({ opponent: 'Hawks' });
    });
});
