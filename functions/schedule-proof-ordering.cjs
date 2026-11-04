"use strict";
const { scheduleDeliveryFingerprint: hash } = require('./schedule-delivery-coordinator.cjs');
const { canonicalScheduleVersion } = require('./schedule-effect-eligibility.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = (code = 'proof_ordering_unavailable') => { throw Object.assign(new Error('Schedule proof routing is not yet resolved.'), { code }); };
const validId = (id) => typeof id === 'string' && ID.test(id);
const before = (value) => value === null ? null : canonicalScheduleVersion(value);
const effectFor = (value) => {
    if (!validId(value?.teamId) || !validId(value?.eventId) || value.category !== 'schedule') fail();
    return { teamId: value.teamId, eventId: value.eventId, sourceVersion: canonicalScheduleVersion(value.sourceVersion), category: 'schedule' };
};
const fenceIdFor = (value) => hash({ kind: 'schedule-proof-fence-v1', teamId: value.teamId, eventId: value.eventId, beforeVersion: before(value.beforeVersion) });
const inboxIdFor = (effect) => hash({ kind: 'schedule-trigger-inbox-v1', ...effect });
const same = (one, two, keys) => keys.every((key) => one?.[key] === two?.[key]);
const bindingKeys = ['teamId', 'eventId', 'beforeVersion', 'eventDigest', 'intentDigest', 'approvalId'];

// Isolated protocol model. Producer arming MUST persist before the user-
// credentialed business commit starts. Both consumers MUST resolve this private
// index before choosing ownership. No raw receipt or client event flag is read.
function createScheduleProofOrdering({ store, verifyApprovedIntent, verifyCommit, verifyTrigger, now = Date.now }) {
    if (!store?.get || !store?.change || [verifyApprovedIntent, verifyCommit, verifyTrigger].some((fn) => typeof fn !== 'function')) throw new Error('Durable state and trusted intent, commit and trigger verifiers are required.');
    const fence = (row, id) => {
        if (!row || row.kind !== 'schedule-proof-fence' || row.fenceId !== id || row.intentHash !== hash(row.intent)
            || !['pending', 'proof', 'legacy', 'cancelled'].includes(row.state)
            || (row.state === 'proof' && (!row.reference || row.reference.evidenceId !== row.intent.approvalId || row.reference.teamId !== row.intent.teamId || !row.sourceVersion))) fail();
        return row;
    };
    const inbox = async (effect) => {
        const row = await store.get(effect.teamId, inboxIdFor(effect));
        if (!row || row.kind !== 'schedule-trigger-inbox' || row.eventHash !== hash(row.event) || !same(row.event, effect, Object.keys(effect))) fail();
        return row.event;
    };
    const decision = (row, event) => {
        // A different digest or predecessor is a distinct legacy write, not a
        // failed MCP proof. Never let an unrelated intent hold its notification.
        if (!row || !same(row.intent, event, ['teamId', 'eventId', 'beforeVersion', 'eventDigest'])) return { state: 'legacy' };
        if (row.state === 'pending') return { state: 'pending' };
        if (['legacy', 'cancelled'].includes(row.state)) return { state: 'legacy' };
        // A later recreation can share null predecessor/content with an old
        // create. Proof for another exact commit is not proof for this effect.
        if (row.sourceVersion !== event.sourceVersion) return { state: 'legacy' };
        return { state: 'proof', reference: structuredClone(row.reference) };
    };
    return {
        async arm(intentHandle) {
            const approved = await verifyApprovedIntent(intentHandle);
            const intent = Object.fromEntries(['teamId', 'eventId', 'uid', 'beforeVersion', 'eventDigest', 'intentDigest', 'approvalId', 'approve', 'notifyTeam', 'consumed', 'expiresAt'].map((key) => [key, approved?.[key]]));
            if (!intent || !validId(intent.teamId) || !validId(intent.eventId) || !validId(intent.uid)
                || !['eventDigest', 'intentDigest', 'approvalId'].every((key) => HASH.test(intent[key] || ''))
                || intent.approve !== true || intent.notifyTeam !== true || intent.consumed !== true
                || !Number.isSafeInteger(intent.expiresAt) || intent.expiresAt <= now() || intent.expiresAt - now() > 120000) fail();
            intent.beforeVersion = before(intent.beforeVersion);
            const id = fenceIdFor(intent); const intentHash = hash(intent);
            const prior = await store.get(intent.teamId, id);
            let archivedHash = null;
            if (prior && fence(prior, id).state === 'cancelled' && prior.intentHash !== intentHash) {
                archivedHash = hash(prior);
                const archiveId = hash({ kind: 'cancelled-proof-fence-v1', fenceId: id, intentHash: prior.intentHash });
                const archived = await store.change(intent.teamId, archiveId, (existing) => {
                    if (existing && hash(existing) !== archivedHash) fail();
                    return existing || prior;
                });
                if (!archived || hash(archived) !== archivedHash) fail();
            }
            const saved = await store.change(intent.teamId, id, (existing) => {
                if (existing) {
                    fence(existing, id);
                    if (existing.state === 'cancelled' && hash(existing) === archivedHash) { /* preserved tombstone permits a fresh intent */ }
                    else {
                        if (existing.intentHash !== intentHash || existing.state !== 'pending') fail('proof_fence_conflict');
                        return existing;
                    }
                }
                return { kind: 'schedule-proof-fence', fenceId: id, intent, intentHash, state: 'pending', producerState: 'armed', armedAt: now() };
            });
            if (fence(saved, id).intentHash !== intentHash || saved.state !== 'pending' || now() >= intent.expiresAt) fail();
            // Internal ordering acknowledgment only, not a write capability.
            // The existing one-action command engine still authorizes the write.
            return { teamId: intent.teamId, fenceId: id, intentHash };
        },
        async beginWrite(reference) {
            const saved = await store.change(reference.teamId, reference.fenceId, (existing) => {
                const row = fence(existing, reference.fenceId);
                if (row.intentHash !== reference.intentHash || row.state !== 'pending' || row.producerState !== 'armed'
                    || now() >= row.intent.expiresAt) fail('write_not_authorized');
                return { ...row, producerState: 'dispatched', dispatchStartedAt: now() };
            });
            if (fence(saved, reference.fenceId).intentHash !== reference.intentHash || saved.producerState !== 'dispatched') fail();
        },
        async cancelUnstarted(reference) {
            const saved = await store.change(reference.teamId, reference.fenceId, (existing) => {
                const row = fence(existing, reference.fenceId);
                if (row.intentHash !== reference.intentHash) fail('proof_fence_conflict');
                if (row.state === 'cancelled') return row;
                if (row.state !== 'pending' || row.producerState !== 'armed') fail('write_outcome_unknown');
                return { ...row, state: 'cancelled', producerState: 'cancelled', resolvedAt: now() };
            });
            if (fence(saved, reference.fenceId).state !== 'cancelled' || saved.intentHash !== reference.intentHash) fail();
        },
        async captureTrigger(triggerHandle) {
            const event = structuredClone(await verifyTrigger(triggerHandle));
            const effect = effectFor(event); event.sourceVersion = effect.sourceVersion; event.beforeVersion = before(event.beforeVersion);
            if (!HASH.test(event.eventDigest || '')) fail();
            // Full platform payload retention is the host queue's obligation.
            // This private inbox durably records routing identity, not authority
            // to send or a replacement for the notification delivery outbox.
            const normalized = { ...effect, beforeVersion: event.beforeVersion, eventDigest: event.eventDigest };
            const eventHash = hash(normalized);
            const saved = await store.change(effect.teamId, inboxIdFor(effect), (existing) => {
                if (existing) { if (existing.kind !== 'schedule-trigger-inbox' || existing.eventHash !== eventHash || hash(existing.event) !== eventHash) fail(); return existing; }
                return { kind: 'schedule-trigger-inbox', event: normalized, eventHash, capturedAt: now() };
            });
            if (!saved || saved.eventHash !== eventHash || hash(saved.event) !== eventHash) fail();
            return effect;
        },
        async publish(reference) {
            const commit = structuredClone(await verifyCommit(reference));
            if (!commit || commit.committed !== true || commit.consumed !== true || commit.approve !== true || commit.notifyTeam !== true
                || !validId(commit.teamId) || !validId(commit.eventId) || !validId(commit.uid)
                || reference?.teamId !== commit.teamId || reference?.evidenceId !== commit.approvalId) fail();
            commit.sourceVersion = canonicalScheduleVersion(commit.sourceVersion); commit.beforeVersion = before(commit.beforeVersion);
            const id = fenceIdFor(commit);
            const saved = await store.change(commit.teamId, id, (existing) => {
                const row = fence(existing, id);
                if (!same(row.intent, commit, [...bindingKeys, 'uid']) || row.producerState !== 'dispatched' || ['legacy', 'cancelled'].includes(row.state)) fail('proof_path_closed');
                if (row.state === 'proof') { if (row.sourceVersion !== commit.sourceVersion) fail(); return row; }
                return { ...row, state: 'proof', reference: { teamId: reference.teamId, evidenceId: reference.evidenceId }, sourceVersion: commit.sourceVersion, resolvedAt: now() };
            });
            if (fence(saved, id).state !== 'proof' || saved.sourceVersion !== commit.sourceVersion) fail();
        },
        async resolveEffect(input) {
            const effect = effectFor(input); const event = await inbox(effect);
            const id = fenceIdFor(event); const row = await store.get(effect.teamId, id);
            return decision(row ? fence(row, id) : null, event);
        },
        async closeForLegacy(input) {
            const effect = effectFor(input); const event = await inbox(effect);
            const id = fenceIdFor(event);
            const saved = await store.change(effect.teamId, id, (existing) => {
                const row = fence(existing, id);
                if (!same(row.intent, event, ['teamId', 'eventId', 'beforeVersion', 'eventDigest'])) fail();
                if (row.state !== 'pending') return row;
                if (now() < row.intent.expiresAt) fail('proof_still_pending');
                // This durable terminal fence closes publication; expiry alone
                // never selects a consumer. A late proof cannot reopen the path.
                return { ...row, state: 'legacy', resolvedAt: now() };
            });
            return decision(fence(saved, id), event);
        }
    };
}
module.exports = { createScheduleProofOrdering };
