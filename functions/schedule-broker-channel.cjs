"use strict";
const { sign, verify, createHash, randomUUID } = require('node:crypto');
const { scheduleDeliveryFingerprint: hash } = require('./schedule-delivery-coordinator.cjs');
const { isBrokerClientId } = require('./schedule-delivery-identity.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const actorKeys = ['uid', 'clientId', 'grantKey', 'sessionId'];
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fail = (code = 'broker_request_denied') => { throw Object.assign(new Error('The authenticated command outcome is unavailable.'), { code }); };
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

// Internal broker composition, not an MCP tool. Private keys are supplied by a
// reviewed host; this module never creates, stores or loads credentials. Tests
// use ephemeral keys. The host must obtain approval from its actual form broker.
function signBrokerCommand({ keyId, privateKey, audience, actor, command, approval, idToken, issuedAt, expiresAt, nonce = randomUUID(), purpose = 'schedule.execute' }) {
    if (privateKey?.asymmetricKeyType !== 'ed25519' || typeof idToken !== 'string') fail();
    const payload = Buffer.from(JSON.stringify({ version: 1, audience, purpose, actor, command, approval, issuedAt, expiresAt, nonce, tokenHash: tokenHash(idToken) })).toString('base64url');
    const signature = sign(null, Buffer.from(`${keyId}.${payload}`), privateKey).toString('base64url');
    return { keyId, payload, signature, idToken };
}

// Unmounted backend protocol core. HTTPS/IAM, parser bounds and rate limits are
// additional host requirements. It verifies a pinned broker signature AND the
// current user token/session. The injected executor is trusted backend code and
// must reconstruct/validate schedule semantics, never accept a client write plan.
function createScheduleBrokerChannel({ audience, publicKeys, store, verifyUserToken, verifyLiveSession, authorizeActor, executeCommand, now = Date.now }) {
    if (typeof audience !== 'string' || !audience || !(publicKeys instanceof Map) || !publicKeys.size || !store?.get || !store?.change
        || [verifyUserToken, verifyLiveSession, authorizeActor, executeCommand].some((fn) => typeof fn !== 'function')) throw new Error('Pinned broker keys, durable state and live authorization interfaces are required.');
    const authenticate = async (envelope) => {
        if (!exact(envelope, ['keyId', 'payload', 'signature', 'idToken']) || !ID.test(envelope.keyId || '')
            || typeof envelope.payload !== 'string' || envelope.payload.length > 32768 || !/^[A-Za-z0-9_-]+$/.test(envelope.payload)
            || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)
            || typeof envelope.idToken !== 'string' || !envelope.idToken || envelope.idToken.length > 8192) fail();
        const key = publicKeys.get(envelope.keyId);
        if (key?.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(`${envelope.keyId}.${envelope.payload}`), key, Buffer.from(envelope.signature, 'base64url'))) fail();
        const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
        if (!exact(payload, ['version', 'audience', 'purpose', 'actor', 'command', 'approval', 'issuedAt', 'expiresAt', 'nonce', 'tokenHash'])
            || payload.version !== 1 || payload.audience !== audience || !['schedule.execute', 'schedule.status'].includes(payload.purpose)
            || !UUID.test(payload.nonce || '') || payload.tokenHash !== tokenHash(envelope.idToken)
            || ![payload.issuedAt, payload.expiresAt].every(Number.isSafeInteger) || payload.issuedAt < 0 || payload.issuedAt > now()
            || payload.expiresAt <= now() || payload.expiresAt - payload.issuedAt > 120000
            || !exact(payload.actor, actorKeys) || !['uid', 'sessionId'].every((key) => ID.test(payload.actor[key] || ''))
            || !isBrokerClientId(payload.actor.clientId) || !HASH.test(payload.actor.grantKey || '')
            || !exact(payload.command, ['proposalId', 'teamId', 'eventId', 'mode', 'eventType', 'changes'])
            || !['proposalId', 'teamId', 'eventId'].every((key) => ID.test(payload.command[key] || ''))
            || !['create', 'update'].includes(payload.command.mode) || !['game', 'practice'].includes(payload.command.eventType)
            || !exact(payload.approval, ['preview', 'approve', 'notifyTeam']) || payload.approval.approve !== true || payload.approval.notifyTeam !== true) fail();
        const assertDispatchReady = () => {
            if (publicKeys.get(envelope.keyId) !== key || now() >= payload.expiresAt) fail();
        };
        const checkCurrent = async () => {
            assertDispatchReady();
            const user = await verifyUserToken(envelope.idToken, { checkRevoked: true });
            const session = await verifyLiveSession({ ...payload.actor, expiresAt: payload.expiresAt, purpose: payload.purpose });
            if (publicKeys.get(envelope.keyId) !== key || user?.uid !== payload.actor.uid || user.disabled !== false || user.emailVerified !== true
                || !Number.isSafeInteger(user.expiresAt) || user.expiresAt < payload.expiresAt || now() >= payload.expiresAt
                || !session || !actorKeys.every((field) => session[field] === payload.actor[field]) || session.reviewRequests !== true || session.connected !== true
                || !Number.isSafeInteger(session.expiresAt) || session.expiresAt < payload.expiresAt) fail();
            if (await authorizeActor(payload.actor, payload.command.teamId) !== true) fail();
            // Authorization can await I/O beyond the approved deadline or a
            // signing-key removal. Its response must not revive either grant.
            assertDispatchReady();
            return assertDispatchReady;
        };
        await checkCurrent();
        return { payload, checkCurrent, assertDispatchReady };
    };
    const checkedRow = (row, binding) => {
        if (row && (row.kind !== 'broker-command-attempt' || row.requestHash !== binding.requestHash || row.actorHash !== binding.actorHash
            || !['reserved', 'committed', 'unverified'].includes(row.state))) fail('broker_command_conflict');
        return row;
    };
    return {
        async handle(envelope) {
            try {
                const { payload, checkCurrent, assertDispatchReady } = await authenticate(envelope);
                assertDispatchReady();
                const { actor, command, approval } = payload;
                // Stable across new transport nonces/token refreshes: replay,
                // parallel calls and restarts cannot repeat the same mutation.
                const operationId = hash({ kind: 'broker-command-v1', uid: actor.uid, teamId: command.teamId, proposalId: command.proposalId });
                const binding = { actorHash: hash(actor), requestHash: hash({ actor, command, approval }) };
                if (payload.purpose === 'schedule.status') {
                    const row = checkedRow(await store.get(command.teamId, operationId), binding);
                    (await checkCurrent())();
                    return { operationId, status: !row ? 'not_started' : row.state === 'committed' ? 'committed' : 'unverified' };
                }
                let claimed = false;
                // No recovery may turn an uncertain reservation into permission
                // to execute. A lost claim response is safe to inspect, not retry.
                const row = await store.change(command.teamId, operationId, (existing) => {
                    claimed = false;
                    if (existing) return checkedRow(existing, binding);
                    claimed = true;
                    return { kind: 'broker-command-attempt', ...binding, state: 'reserved', reservedAt: now() };
                });
                checkedRow(row, binding);
                if (!row || (claimed && row.state !== 'reserved')) fail('broker_outcome_unknown');
                (await checkCurrent())();
                if (!claimed) return { operationId, status: row.state === 'committed' ? 'committed' : 'unverified' };
                let committed = false;
                try {
                    // The ID token exists only in this invocation. It is never
                    // placed in durable attempt state, status, logs or errors.
                    // The executor must await assertCurrent after its own I/O,
                    // then run assertDispatchReady synchronously at final fetch.
                    assertDispatchReady();
                    const result = await executeCommand({ actor: structuredClone(actor), command: structuredClone(command), approval: structuredClone(approval),
                        idToken: envelope.idToken, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt, assertCurrent: checkCurrent, assertDispatchReady });
                    committed = result?.commitVerified === true;
                } catch { /* Unknown writes are never replayed automatically. */ }
                const saved = await store.change(command.teamId, operationId, (existing) => {
                    checkedRow(existing, binding);
                    if (existing?.state !== 'reserved') fail('broker_command_conflict');
                    return { ...existing, state: committed ? 'committed' : 'unverified', finishedAt: now() };
                });
                checkedRow(saved, binding);
                if (!saved || saved.state !== (committed ? 'committed' : 'unverified')) fail('broker_outcome_unknown');
                (await checkCurrent())();
                return { operationId, status: committed ? 'committed' : 'unverified' };
            } catch (error) {
                // Never return an SDK/provider error, token or raw request.
                fail(['broker_command_conflict', 'broker_request_denied'].includes(error?.code) ? error.code : 'broker_outcome_unknown');
            }
        }
    };
}
module.exports = { signBrokerCommand, createScheduleBrokerChannel };
