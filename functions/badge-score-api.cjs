'use strict';
const crypto = require('node:crypto');
const { hasTeamAdminAccess } = require('./team-admin-access-core.cjs');
const core = require('./badge-score-core.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const unavailable = game => ['completed','cancelled','canceled','final','deleted'].includes(game.status) || ['completed','cancelled','canceled','final','deleted'].includes(game.liveStatus);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function check(ok, message, status = 403) { if (!ok) { const e = new Error(message); e.status = status; throw e; } }
function createBadgeApi({ db, auth, HttpsError, verifySensitive, timestamp }) {
    async function manager(uid, teamId, tx) {
        check(safeId(teamId), 'Invalid team.', 400);
        const account = await auth.getUser(uid);
        check(!account.disabled && account.emailVerified, 'Verified account required.');
        const read = ref => tx ? tx.get(ref) : ref.get();
        const [team, user] = await Promise.all([read(db.doc(`teams/${teamId}`)), read(db.doc(`users/${uid}`))]);
        check(team.exists && hasTeamAdminAccess({ team: team.data(), user: user.data() || {}, uid, email: account.email }), 'Team manager access required.');
        return team.data();
    }
    async function configure(data, context) {
        try {
            check(context.auth?.uid, 'Sign in first.', 401);
            await verifySensitive(context, 'badge-score-controller');
            const team = await manager(context.auth.uid, data.teamId);
            if (data.action === 'release') {
                check(safeId(data.gameId), 'Invalid game.', 400);
                await db.runTransaction(async tx => {
                    const ref = db.doc(`teams/${data.teamId}/games/${data.gameId}`);
                    const game = await tx.get(ref);
                    check(game.exists, 'Game not found.', 404);
                    await manager(context.auth.uid, data.teamId, tx);
                    const current = game.data();
                    if (!current.badgeScoreControl) return;
                    const next = core.snapshot(current, Date.now(), team.sport);
                    next.liveClockRunning = false;
                    tx.update(ref, { ...next, badgeScoreControl: false });
                    tx.delete(db.doc(`badgeScoreLocks/${hash(data.teamId + '/' + data.gameId)}`));
                    tx.set(ref.collection('liveEvents').doc(), { type: 'clock_pause', description: 'Badge control released', homeScore: next.homeScore, awayScore: next.awayScore, gameClockMs: next.liveClockMs, period: next.liveClockPeriod, source: 'badge-score-controller', scoreOrientation: 'venue', liveClockRunning: next.liveClockRunning, timestamp: timestamp(), createdAt: timestamp() });
                });
                return { released: true };
            }
            check(typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token), 'Invalid device token.', 400);
            const id = hash(data.token);
            const ref = db.doc(`badgeScoreDevices/${id}`);
            if (data.action === 'revoke') {
                await db.runTransaction(async tx => {
                    const old = await tx.get(ref);
                    check(old.exists && old.data().uid === context.auth.uid, 'Device not owned by caller.');
                    tx.update(ref, { revoked: true });
                });
                return { revoked: true };
            }
            check(data.action === 'create', 'Invalid action.', 400);
            await db.runTransaction(async tx => {
                const old = await tx.get(ref);
                if (old.exists) { check(old.data().uid === context.auth.uid && old.data().teamId === data.teamId && !old.data().revoked, 'Device token already used.'); return; }
                tx.create(ref, { uid: context.auth.uid, teamId: data.teamId, expires: Date.now() + 30 * 86400000, revoked: false });
            });
            return { teamName: team.name || 'Team', expiresDays: 30 };
        } catch (error) {
            if (error instanceof HttpsError) throw error;
            throw new HttpsError(error.status === 400 ? 'invalid-argument' : error.status === 401 ? 'unauthenticated' : 'permission-denied', error.status ? error.message : 'Device setup failed.');
        }
    }
    async function handler(req, res) {
        res.set('Cache-Control', 'no-store');
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required.' });
        try {
            check(Number(req.get('content-length') || 0) <= 4096 && (req.rawBody?.length || 0) <= 4096, 'Request too large.', 400);
            const token = String(req.get('authorization') || '').replace(/^Bearer /, '');
            check(/^[a-f0-9]{64}$/.test(token), 'Pair this badge first.', 401);
            const id = hash(token);
            const deviceRef = db.doc(`badgeScoreDevices/${id}`);
            const deviceSnap = await deviceRef.get();
            check(deviceSnap.exists, 'Pair this badge first.', 401);
            const device = deviceSnap.data();
            check(!device.revoked && device.expires > Date.now(), 'Pairing expired or revoked.', 401);
            const team = await manager(device.uid, device.teamId);
            const body = req.body || {};
            if (body.action === 'games') {
                // A bounded date query avoids scanning unrelated public teams.
                const now = Date.now();
                const games = await db.collection(`teams/${device.teamId}/games`).where('date', '>=', new Date(now - 86400000)).where('date', '<=', new Date(now + 14 * 86400000)).orderBy('date').limit(60).get();
                return res.json({ team: team.name || 'Team', games: games.docs.filter(d => !['practice'].includes(d.data().type) && !unavailable(d.data()) && d.data().trackingEngine !== 'diamond-v2' && !d.data().sharedScheduleId && !d.data().sharedGameId && !d.data().sharedScheduleSourceTeamId).map(d => ({ id: d.id, opponent: String(d.data().opponent || d.data().opponentTeamName || 'Opponent').slice(0,48), date: d.data().date.toDate().toISOString(), live: d.data().liveStatus === 'live' })) });
            }
            check(safeId(body.gameId), 'Invalid game.', 400);
            const gameRef = db.doc(`teams/${device.teamId}/games/${body.gameId}`);
            const lockRef = db.doc(`badgeScoreLocks/${hash(device.teamId + '/' + body.gameId)}`);
            const result = await db.runTransaction(async tx => {
                const [gameSnap, lockSnap, grant] = await Promise.all([tx.get(gameRef), tx.get(lockRef), tx.get(deviceRef)]);
                check(grant.exists && !grant.data().revoked && grant.data().expires > Date.now(), 'Pairing expired or revoked.', 401);
                const currentTeam = await manager(device.uid, device.teamId, tx);
                check(gameSnap.exists, 'Game not found.', 404);
                const game = gameSnap.data();
                check(game.trackingEngine !== 'diamond-v2' && !game.sharedScheduleId && !game.sharedGameId && !game.sharedScheduleSourceTeamId && game.type !== 'practice', 'This game uses another tracker.', 409);
                check(!unavailable(game), 'Game is no longer available.', 409);
                const now = Date.now();
                let control = lockSnap.exists ? lockSnap.data() : null;
                const sport = game.sport || currentTeam.sport;
                let state = core.snapshot(game, now, sport);
                if (body.action === 'release' && !game.badgeScoreControl && !control) return { released: true };
                if (body.action === 'claim') {
                    check(!control || control.deviceId === id, 'Another badge controls this game.', 409);
                    if (!control) {
                        check(!game.liveClockRunning, 'Pause the existing tracker before taking control.', 409);
                        control = { deviceId: id, sessionId: crypto.randomBytes(16).toString('hex'), revision: 0, history: [] };
                        tx.set(lockRef, control);
                        tx.update(gameRef, { homeScore: state.homeScore, awayScore: state.awayScore, scoreOrientation: 'venue', badgeScoreControl: true });
                        tx.set(gameRef.collection('liveEvents').doc(), { type: 'clock_sync', description: 'Badge control acquired', homeScore: state.homeScore, awayScore: state.awayScore, gameClockMs: state.liveClockMs, period: state.liveClockPeriod, source: 'badge-score-controller', scoreOrientation: 'venue', liveClockRunning: state.liveClockRunning, timestamp: timestamp(), createdAt: timestamp() });
                    }
                } else {
                    check(game.badgeScoreControl === true && control?.deviceId === id, 'Choose the game and take control again.', 409);
                    if (body.action === 'release') {
                        check(body.sessionId === control.sessionId, 'Control session changed. Refresh first.', 409);
                        state.liveClockRunning = false;
                        tx.update(gameRef, { ...state, badgeScoreControl: false });
                        tx.delete(lockRef);
                        tx.set(gameRef.collection('liveEvents').doc(), { type: 'clock_pause', description: 'Badge control released', homeScore: state.homeScore, awayScore: state.awayScore, gameClockMs: state.liveClockMs, period: state.liveClockPeriod, source: 'badge-score-controller', scoreOrientation: 'venue', liveClockRunning: state.liveClockRunning, timestamp: timestamp(), createdAt: timestamp() });
                    } else if (body.action !== 'state') {
                        check(typeof body.requestId === 'string' && /^[a-f0-9]{32}$/.test(body.requestId), 'Invalid request ID.', 400);
                        const receiptRef = lockRef.collection('receipts').doc(body.requestId);
                        const receipt = await tx.get(receiptRef);
                        const fingerprint = hash(JSON.stringify([body.action, body.side || '', body.delta || 0, body.running, body.period || '', body.revision, body.sessionId]));
                        if (receipt.exists) {
                            check(receipt.data().fingerprint === fingerprint, 'Request ID was reused.', 409);
                        } else {
                            check(body.sessionId === control.sessionId, 'Control session changed. Choose the game again.', 409);
                            // Badge sides are team/opponent; stored scores use venue home/away.
                            const command = game.isHome === false && body.action === 'score'
                                ? { ...body, side: body.side === 'homeScore' ? 'awayScore' : body.side === 'awayScore' ? 'homeScore' : body.side }
                                : body;
                            const applied = core.apply(game, control, command, now, sport);
                            state = applied.next; control = applied.control;
                            tx.update(gameRef, { ...state, liveHasData: true, scoreUpdatedAt: timestamp(), scoreUpdatedBy: device.uid });
                            tx.set(lockRef, control);
                            tx.create(receiptRef, { fingerprint, at: now });
                            tx.set(gameRef.collection('liveEvents').doc(), { type: applied.type, description: `Badge: ${body.action}`, homeScore: state.homeScore, awayScore: state.awayScore, gameClockMs: state.liveClockMs, period: state.liveClockPeriod, source: 'badge-score-controller', scoreOrientation: 'venue', liveClockRunning: state.liveClockRunning, timestamp: timestamp(), createdAt: timestamp() });
                        }
                    }
                }
                return { ...state, homeScore: game.isHome === false ? state.awayScore : state.homeScore, awayScore: game.isHome === false ? state.homeScore : state.awayScore, sessionId: control?.sessionId, revision: control?.revision || 0, canUndo: !!control?.history?.length, serverTime: now, periods: core.periods(sport), team: String(currentTeam.name || 'Team').slice(0,48), opponent: String(game.opponent || game.opponentTeamName || 'Opponent').slice(0,48) };
            });
            return res.json(result);
        } catch (error) {
            return res.status(error.status || 503).json({ error: error.status ? error.message : 'Service unavailable. Retry the same command.' });
        }
    }
    return { configure, handler };
}
module.exports = { createBadgeApi };
