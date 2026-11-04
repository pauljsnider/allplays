"use strict";
const { scheduleDeliveryFingerprint: hash } = require('./schedule-delivery-coordinator.cjs');
const { createScheduleProofOrdering } = require('./schedule-proof-ordering.cjs');
const { createScheduleEffectEligibility, canonicalScheduleVersion } = require('./schedule-effect-eligibility.cjs');
const { createScheduleConsumerOwnership } = require('./schedule-consumer-ownership.cjs');
const { createNotificationAttemptJournal, normalizeNotificationAttempt } = require('./notification-attempt-journal.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const fail = () => { throw new Error('Durable schedule recovery is unavailable.'); };
const effectFor = (value) => {
    if (!value || ![value.teamId, value.eventId].every((id) => typeof id === 'string' && ID.test(id))) fail();
    return { teamId: value.teamId, eventId: value.eventId, sourceVersion: canonicalScheduleVersion(value.sourceVersion), category: 'schedule' };
};
const jobIdFor = (effect) => hash({ kind: 'schedule-recovery-job-v1', ...effect });
const bounded = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);

// Unmounted backend composition. Application writes still run through the
// acting user's REST adapter. This module owns only private queue/fence/plan
// state and requires explicit trusted platform, authorization and provider code.
function createScheduleRecoveryPipeline({ store, authority, verifyPlatformTrigger, assessAudience, prepareLegacyPlan, authorizeDelivery, providers, readVerifiedDeploymentGate, scanWork, now = Date.now }) {
    if (!store?.get || !store?.change || [authority?.verifyConsumedApproval, authority?.verifyCommit, verifyPlatformTrigger, assessAudience, prepareLegacyPlan,
        authorizeDelivery, providers?.pin, providers?.send, readVerifiedDeploymentGate, scanWork].some((fn) => typeof fn !== 'function')) throw new Error('Complete producer, trigger, audience, delivery and recovery interfaces are required.');
    const validateJob = (row, effect) => {
        if (!row || row.kind !== 'schedule-recovery-job' || row.payloadHash !== hash(row.payload) || hash(row.payload.event) !== hash(effect)
            || !['pending', 'waiting', 'completed', 'uncertain'].includes(row.state)
            || (row.plans && row.planHash !== hash(row.plans))) fail();
        return row;
    };
    const jobFor = async (effect) => validateJob(await store.get(effect.teamId, jobIdFor(effect)), effect);
    const ordering = createScheduleProofOrdering({ store, now,
        verifyApprovedIntent: (reference) => authority.verifyConsumedApproval(reference), verifyCommit: (reference) => authority.verifyCommit(reference),
        verifyTrigger: async (reference) => {
            const effect = effectFor(reference); const row = await jobFor(effect);
            return { ...effect, beforeVersion: row.payload.beforeVersion, eventDigest: hash(row.payload.fields) };
        }
    });
    const reservations = new WeakMap();
    const reservationFor = (handle) => { const value = reservations.get(handle); if (!value) fail(); return value; };
    const readiness = async (args) => {
        const value = await assessAudience(args);
        if (!value || !['ready', 'legacy_required'].includes(value.state) || (value.state === 'ready' && (!Array.isArray(value.targets) || value.targets.length > 100))) fail();
        return value;
    };
    const producer = {
        async arm(reference) {
            const approval = await authority.verifyConsumedApproval(reference);
            const ready = await readiness({ teamId: approval.teamId, actorUid: approval.uid });
            const value = { reference: structuredClone(reference), expiresAt: approval.expiresAt, fence: ready.state === 'ready' ? await ordering.arm(reference) : null };
            const handle = Object.freeze({}); reservations.set(handle, value); return handle;
        },
        async beginWrite(handle) {
            const value = reservationFor(handle); if (now() >= value.expiresAt) fail();
            if (value.fence) await ordering.beginWrite(value.fence);
            if (now() >= value.expiresAt) fail();
        },
        async cancelUnstarted(handle) { const value = reservationFor(handle); if (value.fence) await ordering.cancelUnstarted(value.fence); },
        async publish(reference, handle) {
            const value = reservationFor(handle); if (hash(reference) !== hash(value.reference)) fail();
            if (value.fence) await ordering.publish(reference);
        }
    };
    // Do not pass the routing-only category field to the delivery schema.
    const sourceFor = (payload) => ({ teamId: payload.event.teamId, eventId: payload.event.eventId, sourceVersion: payload.event.sourceVersion,
        actorUid: payload.actorUid, title: payload.title, body: payload.body });
    const pinTargets = (payload, targets) => {
        if (!Array.isArray(targets) || targets.length > 100) fail();
        return targets.map((target) => {
            if (!target || Object.keys(target).some((key) => !['recipientUid', 'channel', 'endpoint'].includes(key))) fail();
            return providers.pin(normalizeNotificationAttempt({ ...sourceFor(payload), ...target }).request);
        });
    };
    const updateState = async (effect, state) => {
        const saved = await store.change(effect.teamId, jobIdFor(effect), (row) => ({ ...validateJob(row, effect), state, updatedAt: now() }));
        if (validateJob(saved, effect).state !== state) fail();
    };
    const api = {
        producer,
        async capture(platformHandle) {
            const value = await verifyPlatformTrigger(platformHandle); const event = effectFor(value);
            if (!value.fields || typeof value.actorUid !== 'string' || !ID.test(value.actorUid) || !bounded(value.title, 160) || !bounded(value.body, 1000)) fail();
            const payload = { event, fields: structuredClone(value.fields), beforeVersion: value.beforeVersion === null ? null : canonicalScheduleVersion(value.beforeVersion),
                actorUid: value.actorUid, title: value.title, body: value.body };
            if (Buffer.byteLength(JSON.stringify(payload)) > 262144) fail(); // retain/retry upstream; never acknowledge an oversized lost payload
            const payloadHash = hash(payload);
            const saved = await store.change(event.teamId, jobIdFor(event), (existing) => {
                if (existing) { if (validateJob(existing, event).payloadHash !== payloadHash) fail(); return existing; }
                return { kind: 'schedule-recovery-job', payload, payloadHash, state: 'pending', createdAt: now(), updatedAt: now() };
            });
            if (validateJob(saved, event).payloadHash !== payloadHash) fail();
            await ordering.captureTrigger(event); return event;
        },
        async process(input) {
            const effect = effectFor(input); let job = await jobFor(effect);
            if (job.state === 'completed') return { state: 'completed' };
            await ordering.captureTrigger(effect); // recovers capture-after-queue persistence failure
            let resolution = await ordering.resolveEffect(effect);
            if (resolution.state === 'pending') {
                try { resolution = await ordering.closeForLegacy(effect); }
                catch (error) {
                    if (error.code !== 'proof_still_pending') throw error;
                    await updateState(effect, 'waiting'); return { state: 'waiting' };
                }
            }
            if (!job.plans) {
                const ready = await readiness({ teamId: effect.teamId, actorUid: job.payload.actorUid });
                // Freeze complete plans before choosing either owner. A gate
                // rollback cannot strand an owner whose audience is unresolved.
                const legacyTargets = await prepareLegacyPlan(structuredClone(job.payload));
                const plans = { legacy: pinTargets(job.payload, legacyTargets), journal: ready.state === 'ready' ? pinTargets(job.payload, ready.targets) : null };
                if (Buffer.byteLength(JSON.stringify(plans)) > 262144) fail();
                job = await store.change(effect.teamId, jobIdFor(effect), (row) => {
                    validateJob(row, effect); if (row.plans) return row;
                    return { ...row, plans, planHash: hash(plans), updatedAt: now() };
                });
                validateJob(job, effect); if (!job.plans) fail();
            }
            const verifyEffectEligibility = createScheduleEffectEligibility({ resolveEffect: ordering.resolveEffect, verifyCommit: authority.verifyCommit,
                readEvent: async () => ({ version: effect.sourceVersion, data: job.payload.fields }) });
            const decide = createScheduleConsumerOwnership({ store, readVerifiedDeploymentGate,
                verifyEffectEligibility: (candidate) => job.plans.journal === null ? Promise.resolve({ ...candidate, eligible: false }) : verifyEffectEligibility(candidate) });
            const owner = (await decide({ ...effect, consumer: 'journal' })).owner;
            const requests = job.plans[owner]; if (!Array.isArray(requests)) fail();
            const journal = createNotificationAttemptJournal({ store, now,
                authorize: async (request, phase) => {
                    if (!(await decide({ ...effect, consumer: owner })).mayConsume) fail();
                    return authorizeDelivery({ owner, request, phase, payload: structuredClone(job.payload) });
                }, send: providers.send, reconcile: providers.reconcile });
            // Resolve uncertain prior provider attempts against their exact
            // durable identities before delivery considers any bounded retry.
            // Missing/ambiguous receipts never authorize a second send.
            await journal.reconcilePlan(requests, sourceFor(job.payload));
            const result = await journal.deliverPlan(requests, sourceFor(job.payload));
            const state = result.results.some((row) => ['uncertain', 'dispatching'].includes(row.status)) ? 'uncertain'
                : result.results.every((row) => ['accepted', 'suppressed', 'failed'].includes(row.status)) ? 'completed' : 'pending';
            await updateState(effect, state); return { state, owner, count: result.results.length };
        },
        async recover({ teamId, cursor = null }) {
            if (typeof teamId !== 'string' || !ID.test(teamId)) fail();
            const page = await scanWork({ teamId, cursor });
            if (!page || !Array.isArray(page.rows) || page.rows.length > 100) fail();
            const results = [];
            for (const item of page.rows) {
                try {
                    if (item.kind === 'schedule-recovery-job' && item.state !== 'completed') {
                        if (item.payload?.event?.teamId !== teamId) fail();
                        results.push(await api.process(item.payload.event));
                    }
                    else if (item.kind === 'schedule-proof-fence' && item.state === 'pending' && item.producerState === 'armed' && now() >= item.intent.expiresAt) {
                        await ordering.cancelUnstarted({ teamId, fenceId: item.fenceId, intentHash: item.intentHash }); results.push({ state: 'cancelled_unstarted' });
                    }
                } catch { results.push({ state: 'retry_required' }); } // retained record, no acknowledgment of delivery
            }
            return { results, nextCursor: page.nextCursor ?? null };
        }
    };
    return api;
}

function createFirestoreScheduleRecoveryScanner(firestore) {
    if (!firestore?.collection) throw new Error('A server-private Firestore scanner is required.');
    return async ({ teamId, cursor = null }) => {
        if (typeof teamId !== 'string' || !ID.test(teamId) || (cursor !== null && (typeof cursor !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(cursor)))) fail();
        const path = `teams/${teamId}/notificationSendLog`;
        let query = firestore.collection(path).orderBy('__name__').limit(21);
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.get(); if (!Array.isArray(snapshot.docs) || snapshot.docs.length > 21) fail();
        const docs = snapshot.docs.slice(0, 20);
        return { rows: docs.map((row) => row.data()), nextCursor: snapshot.docs.length > 20 ? docs.at(-1).id : null };
    };
}
module.exports = { createScheduleRecoveryPipeline, createFirestoreScheduleRecoveryScanner };
