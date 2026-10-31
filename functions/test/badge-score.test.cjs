'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const core = require('../badge-score-core.cjs');
const { createBadgeApi } = require('../badge-score-api.cjs');
const token = 'a'.repeat(64);
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
function fixture() {
    const rows = new Map(Object.entries({
        'teams/t': { ownerId: 'u', name: 'Falcons', sport: 'basketball' },
        'users/u': {},
        'teams/t/games/g': { homeScore: 0, awayScore: 0, liveClockRunning: false, status: 'scheduled' },
        [`badgeScoreDevices/${hash(token)}`]: { uid: 'u', teamId: 't', expires: Date.now() + 60000 }
    }));
    let sequence = 0;
    const snap = path => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
    const ref = path => ({ path, get: async () => snap(path), collection: name => ({ doc: id => ref(`${path}/${name}/${id || ++sequence}`) }) });
    const db = { doc: ref, runTransaction: async fn => {
        const writes = [];
        const tx = {
            get: async r => { assert.equal(writes.length, 0, 'All reads must precede writes'); return snap(r.path); },
            set: (r, v) => writes.push(() => rows.set(r.path, structuredClone(v))),
            create: (r, v) => { assert.ok(!rows.has(r.path)); tx.set(r, v); },
            update: (r, v) => writes.push(() => rows.set(r.path, { ...rows.get(r.path), ...structuredClone(v) })),
            delete: r => writes.push(() => rows.delete(r.path))
        };
        const result = await fn(tx); writes.forEach(w => w()); return result;
    } };
    const account = { emailVerified: true, email: 'owner@example.com', disabled: false };
    class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const api = createBadgeApi({ db, auth: { getUser: async () => account }, HttpsError, verifySensitive: async () => {}, timestamp: () => 123 });
    async function send(body, bearer = token) {
        const response = { code: 200, set() {}, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } };
        await api.handler({ method: 'POST', body: { gameId: 'g', ...body }, get: h => h === 'authorization' ? 'Bearer ' + bearer : '' }, response);
        return response;
    }
    return { rows, account, send, api };
}
test('score, clock, period and undo preserve elapsed time and bound scores', () => {
    let game = { homeScore: 0, awayScore: 2, liveClockMs: 1000, liveClockUpdatedAt: 100, liveClockRunning: true };
    let control = { revision: 0, history: [] };
    const apply = (command, now = 2100) => { const result = core.apply(game, control, { revision: control.revision, ...command }, now, 'soccer'); game = result.next; control = result.control; };
    apply({ action: 'score', side: 'homeScore', delta: 1 });
    assert.equal(game.homeScore, 1); assert.equal(game.liveClockMs, 3000);
    apply({ action: 'undo' }, 3100); assert.equal(game.homeScore, 0); assert.equal(game.liveClockMs, 4000);
    assert.throws(() => apply({ action: 'score', side: 'homeScore', delta: -1 }), /between/);
    apply({ action: 'period', period: 'H2' }, 4100); assert.equal(game.liveClockRunning, false);
    apply({ action: 'undo' }, 5100); assert.equal(game.liveClockPeriod, 'H1'); assert.equal(game.liveClockRunning, true);
    apply({ action: 'clock', running: false }, 6100); assert.equal(game.liveClockMs, 6000);
    assert.throws(() => apply({ action: 'period', period: 'Q1' }), /Invalid period/);
    assert.throws(() => apply({ action: 'clock', running: 'true' }), /Start or Pause/);
    assert.throws(() => apply({ action: 'undo', revision: -1 }), /Refresh/);
});
test('uncertain response retries once; stale revisions and reused IDs cannot mutate', async () => {
    const f = fixture(); const claim = await f.send({ action: 'claim' }); assert.equal(claim.code, 200);
    const command = { action: 'score', side: 'homeScore', delta: 1, revision: 0, sessionId: claim.data.sessionId, requestId: 'b'.repeat(32) };
    assert.equal((await f.send(command)).data.homeScore, 1);
    assert.equal((await f.send(command)).data.homeScore, 1);
    assert.equal((await f.send({ ...command, delta: 2 })).code, 409);
    assert.equal((await f.send({ ...command, requestId: 'c'.repeat(32) })).code, 409);
    assert.equal(f.rows.get('teams/t/games/g').homeScore, 1);
    const undo = await f.send({ action: 'undo', revision: 1, sessionId: claim.data.sessionId, requestId: 'd'.repeat(32) });
    assert.equal(undo.data.homeScore, 0); assert.equal(undo.data.canUndo, false);
});
test('revocation, lost management, disabled or unverified accounts deny mutation', async () => {
    for (const change of [f => f.account.disabled = true, f => f.account.emailVerified = false, f => f.rows.get('teams/t').ownerId = 'other', f => f.rows.get(`badgeScoreDevices/${hash(token)}`).revoked = true, f => f.rows.get(`badgeScoreDevices/${hash(token)}`).expires = 0]) {
        const f = fixture(); change(f); assert.ok((await f.send({ action: 'claim' })).code >= 400); assert.equal(f.rows.get('teams/t/games/g').badgeScoreControl, undefined);
    }
    assert.equal((await fixture().send({ action: 'claim' }, 'z')).code, 401);
});
test('release is retry safe, pauses clock, and new sessions reject old queued commands', async () => {
    const f = fixture(); const first = await f.send({ action: 'claim' });
    await f.send({ action: 'clock', running: true, revision: 0, sessionId: first.data.sessionId, requestId: 'e'.repeat(32) });
    assert.equal((await f.send({ action: 'release', sessionId: first.data.sessionId })).code, 200);
    assert.equal((await f.send({ action: 'release', sessionId: first.data.sessionId })).code, 200);
    assert.equal(f.rows.get('teams/t/games/g').liveClockRunning, false);
    const second = await f.send({ action: 'claim' }); assert.notEqual(second.data.sessionId, first.data.sessionId);
    assert.equal((await f.send({ action: 'score', side: 'homeScore', delta: 1, revision: 0, sessionId: first.data.sessionId, requestId: 'f'.repeat(32) })).code, 409);
});
test('busy clocks, unsupported trackers and another badge are rejected', async () => {
    for (const patch of [{ liveClockRunning: true }, { trackingEngine: 'diamond-v2' }, { sharedScheduleId: 's' }, { sharedGameId: 's' }, { status: 'completed' }]) {
        const f = fixture(); Object.assign(f.rows.get('teams/t/games/g'), patch); assert.equal((await f.send({ action: 'claim' })).code, 409);
    }
    const f = fixture(); await f.send({ action: 'claim' });
    f.rows.get(`badgeScoreLocks/${hash('t/g')}`).deviceId = 'another';
    assert.equal((await f.send({ action: 'claim' })).code, 409);
    assert.equal((await f.send({ action: 'release' })).code, 409);
});
test('pairing retries preserve grant and only its owner can revoke', async () => {
    const f = fixture(); const context = { auth: { uid: 'u' } }; const fresh = 'b'.repeat(64);
    await f.api.configure({ action: 'create', teamId: 't', token: fresh }, context);
    const original = f.rows.get(`badgeScoreDevices/${hash(fresh)}`);
    await f.api.configure({ action: 'create', teamId: 't', token: fresh }, context);
    assert.deepEqual(f.rows.get(`badgeScoreDevices/${hash(fresh)}`), original);
    await assert.rejects(f.api.configure({ action: 'create', teamId: 't', token: fresh }, {}));
    await f.api.configure({ action: 'revoke', teamId: 't', token: fresh }, context);
    await assert.rejects(f.api.configure({ action: 'create', teamId: 't', token: fresh }, context));
});

test('clock snapshots accept legacy milliseconds and Firestore timestamps', () => {
    for (const updatedAt of [1000, new Date(1000), { toMillis: () => 1000 }]) {
        assert.equal(core.snapshot({ liveClockMs: 500, liveClockRunning: true, liveClockUpdatedAt: updatedAt }, 3000, 'soccer').liveClockMs, 2500);
    }
});

test('period changes publish paused state for event-owned live viewers', async () => {
    const f = fixture(); const claim = await f.send({ action: 'claim' });
    await f.send({ action: 'clock', running: true, revision: 0, sessionId: claim.data.sessionId, requestId: '1'.repeat(32) });
    await f.send({ action: 'period', period: 'Q2', revision: 1, sessionId: claim.data.sessionId, requestId: '2'.repeat(32) });
    const event = [...f.rows.entries()].filter(([key]) => key.includes('/liveEvents/')).at(-1)[1];
    assert.equal(event.type, 'period_change');
    assert.equal(event.liveClockRunning, false);
    assert.equal(event.source, 'badge-score-controller');
});

test('away-game team/opponent controls map to venue scores and undo correctly', async () => {
    const f = fixture(); Object.assign(f.rows.get('teams/t/games/g'), { isHome: false, homeScore: 3, awayScore: 7 });
    const claim = await f.send({ action: 'claim' });
    assert.equal(claim.data.homeScore, 7); assert.equal(claim.data.awayScore, 3);
    const us = await f.send({ action: 'score', side: 'homeScore', delta: 1, revision: 0, sessionId: claim.data.sessionId, requestId: '3'.repeat(32) });
    assert.equal(us.data.homeScore, 8); assert.equal(us.data.awayScore, 3);
    assert.equal(f.rows.get('teams/t/games/g').awayScore, 8);
    assert.equal(f.rows.get('teams/t/games/g').homeScore, 3);
    const them = await f.send({ action: 'score', side: 'awayScore', delta: 1, revision: 1, sessionId: claim.data.sessionId, requestId: '4'.repeat(32) });
    assert.equal(them.data.awayScore, 4); assert.equal(f.rows.get('teams/t/games/g').homeScore, 4);
    await f.send({ action: 'undo', revision: 2, sessionId: claim.data.sessionId, requestId: '5'.repeat(32) });
    assert.equal(f.rows.get('teams/t/games/g').homeScore, 3);
    assert.equal(f.rows.get('teams/t/games/g').awayScore, 8);
});

test('claim normalizes historical away scores once and preserves season result through scoring and release', async () => {
    const f = fixture();
    Object.assign(f.rows.get('teams/t/games/g'), { isHome: false, liveHasData: true, homeScore: 7, awayScore: 3 });
    const claimed = await f.send({ action: 'claim' });
    assert.equal(claimed.data.homeScore, 7);
    assert.equal(claimed.data.awayScore, 3);
    assert.equal(f.rows.get('teams/t/games/g').scoreOrientation, 'venue');
    assert.equal(f.rows.get('teams/t/games/g').homeScore, 3);
    const again = await f.send({ action: 'claim' });
    assert.equal(again.data.homeScore, 7);
    const scored = await f.send({ action: 'score', side: 'homeScore', delta: 1, revision: 0, sessionId: claimed.data.sessionId, requestId: 'f'.repeat(32) });
    assert.equal(scored.data.homeScore, 8);
    await f.send({ action: 'release', sessionId: claimed.data.sessionId });
    const game = f.rows.get('teams/t/games/g');
    assert.equal(game.homeScore, 3);
    assert.equal(game.awayScore, 8);
    assert.equal(game.scoreOrientation, 'venue');
});

test('normalization honors explicit and historical orientation contracts', () => {
    for (const fields of [{ liveHasData: true }, { opponentStats: {} }, { scoreOrientation: 'team-opponent', liveStartedAt: 1 }]) {
        const state = core.snapshot({ isHome: false, homeScore: 7, awayScore: 3, ...fields }, 100, 'basketball');
        assert.equal(state.homeScore, 3);
        assert.equal(state.awayScore, 7);
    }
    for (const fields of [{ scoreOrientation: 'venue', liveHasData: true }, { liveStartedAt: 1, opponentStats: {} }, {}]) {
        const state = core.snapshot({ isHome: false, homeScore: 3, awayScore: 7, ...fields }, 100, 'basketball');
        assert.equal(state.homeScore, 3);
        assert.equal(state.awayScore, 7);
    }
});

test('public projection preserves only recognized score orientation values', () => {
    const { serializePublicGame } = require('../public-team-api-core.cjs');
    const game = { date: new Date('2026-10-31T12:00:00Z'), isHome: false, homeScore: 3, awayScore: 7, liveHasData: true, scoreOrientation: 'venue' };
    const projected = serializePublicGame(game);
    assert.equal(projected.scoreOrientation, 'venue');
    assert.equal(projected.teamScore, 7);
    assert.equal(Object.hasOwn(serializePublicGame({ ...game, scoreOrientation: 'private-unrecognized-value' }), 'scoreOrientation'), false);
});

test('server score orientation remains equivalent to the shared client contract', async () => {
    const server = require('../score-orientation-core.cjs');
    const client = await import('../../js/season-record.js');
    for (const isHome of [true, false, undefined]) {
        for (const fields of [{}, { liveHasData: true }, { opponentStats: {} }, { liveStartedAt: 1, liveHasData: true }, { scoreOrientation: 'venue', liveHasData: true }, { scoreOrientation: 'team-opponent' }, { sharedScheduleSourceTeamId: 'source', scoreOrientation: 'venue' }]) {
            const game = { isHome, homeScore: 9, awayScore: 3, ...fields };
            assert.deepEqual(server.getTeamScorePair(game), client.getTeamScorePair(game));
        }
    }
});

test('public score normalization preserves Diamond venue projections', () => {
    const { serializePublicGame } = require('../public-team-api-core.cjs');
    const projected = serializePublicGame({ date: new Date('2026-10-31T12:00:00Z'), trackingEngine: 'diamond-v2', isHome: false, homeScore: 3, awayScore: 9, opponentStats: {} });
    assert.equal(projected.teamScore, 9);
    assert.equal(projected.opponentScore, 3);
});
