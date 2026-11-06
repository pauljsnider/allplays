"use strict";

// Unmounted server-only prototype. No trigger, callable, provider or credentials
// are installed here. Ordinary notification triggers still use their old path.
const { createHash, randomUUID } = require('node:crypto');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STATES = new Set(['pending', 'leased', 'dispatching', 'retryable', 'accepted', 'uncertain', 'suppressed', 'failed']);
const TERMINAL = new Set(['accepted', 'suppressed', 'failed']);
class NotificationJournalError extends Error {
    constructor(code, message) { super(message); this.name = 'NotificationJournalError'; this.code = code; }
}
const fail = (code, message) => { throw new NotificationJournalError(code, message); };
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const bounded = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);

function normalizeProviderEnvelope(value) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype
        || Object.keys(value).some((key) => !['adapter', 'parameters'].includes(key))
        || !/^[a-z][a-z0-9-]{0,63}-v[1-9][0-9]*$/.test(value.adapter || '')
        || !value.parameters || Object.getPrototypeOf(value.parameters) !== Object.prototype) fail('invalid_request', 'Use a versioned provider request.');
    const visit = (item, depth = 0) => {
        if (depth > 12) fail('invalid_request', 'Provider request nesting exceeds the bound.');
        if (item === null || typeof item === 'boolean' || typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item))) return;
        if (Array.isArray(item)) { item.forEach((entry) => visit(entry, depth + 1)); return; }
        if (!item || Object.getPrototypeOf(item) !== Object.prototype || Object.keys(item).some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))) fail('invalid_request', 'Provider parameters must be plain JSON.');
        Object.values(item).forEach((entry) => visit(entry, depth + 1));
    };
    visit(value.parameters);
    if (Buffer.byteLength(JSON.stringify(value)) > 16384) fail('invalid_request', 'Provider request exceeds the bound.');
    return structuredClone(value);
}

function normalizeNotificationAttempt(input) {
    const keys = ['teamId', 'eventId', 'actorUid', 'recipientUid', 'sourceVersion', 'channel', 'endpoint', 'title', 'body'];
    if (!input || Object.keys(input).some((key) => !keys.includes(key) && key !== 'provider') || !keys.every((key) => Object.hasOwn(input, key))
        || !['teamId', 'eventId', 'actorUid', 'recipientUid'].every((key) => ID.test(input[key] || ''))
        || !['inbox', 'push'].includes(input.channel) || !bounded(input.endpoint, 4096)
        || (input.channel === 'inbox' && input.endpoint !== input.recipientUid)
        || !bounded(input.title, 160) || !bounded(input.body, 1000)
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(input.sourceVersion || '') || !Number.isFinite(Date.parse(input.sourceVersion))
        || new Date(input.sourceVersion).toISOString().slice(0, 19) !== input.sourceVersion.slice(0, 19)) {
        fail('invalid_request', 'Use a bounded, verified schedule revision and one exact recipient/channel.');
    }
    const request = Object.fromEntries(keys.map((key) => [key, input[key]]));
    if (Object.hasOwn(input, 'provider')) request.provider = normalizeProviderEnvelope(input.provider);
    const effectId = hash({ teamId: request.teamId, eventId: request.eventId, sourceVersion: request.sourceVersion,
        recipientUid: request.recipientUid, channel: request.channel, endpointHash: hash(request.endpoint) });
    return { request, effectId, requestHash: hash(request) };
}

// The adapter accepts only this existing server-private namespace. MCP must not
// obtain an Admin client or direct read access to these records.
function createFirestoreNotificationJournalStore(firestore) {
    const reference = (teamId, effectId) => {
        if (!ID.test(teamId || '') || !/^[a-f0-9]{64}$/.test(effectId || '')) fail('invalid_request', 'Invalid journal identity.');
        return firestore.doc(`teams/${teamId}/notificationSendLog/durable_${effectId}`);
    };
    return {
        async get(teamId, effectId) { const row = await reference(teamId, effectId).get(); return row.exists ? row.data() : null; },
        async change(teamId, effectId, update) {
            const ref = reference(teamId, effectId);
            return firestore.runTransaction(async (transaction) => {
                const row = await transaction.get(ref);
                const before = row.exists ? row.data() : null;
                const after = update(before);
                if (after !== before) transaction.set(ref, after);
                return after;
            });
        }
    };
}

function createNotificationAttemptJournal({ store, authorize, send, reconcile, now = Date.now, uuid = randomUUID, leaseMs = 120000, retryMs = 30000, maxAttempts = 3 }) {
    if (!store?.get || !store?.change || typeof authorize !== 'function' || typeof send !== 'function'
        || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000
        || !Number.isSafeInteger(retryMs) || retryMs < 1000 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error('A bounded store, live authorization and provider adapter are required.');
    const time = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0) fail('clock_unavailable', 'Current time is unavailable.'); return value; };
    const validate = (record, expected) => {
        if (record && (record.schemaVersion !== 1 || record.effectId !== expected.effectId || record.requestHash !== expected.requestHash
            || hash(record.request) !== expected.requestHash || !STATES.has(record.status) || !Number.isSafeInteger(record.attempt) || record.attempt < 0
            || !Number.isSafeInteger(record.updatedAt) || (record.lease && (!UUID.test(record.lease.id || '') || !Number.isSafeInteger(record.lease.until)))
            || (['leased', 'dispatching'].includes(record.status) && !record.lease)
            || (['dispatching', 'uncertain'].includes(record.status) && (!UUID.test(record.dispatch?.attemptId || '') || record.dispatch.requestHash !== expected.requestHash))
            || (record.status === 'accepted' && (!proof(record.evidence, expected, record.dispatch?.attemptId) || record.evidence.outcome !== 'accepted')))) fail('receipt_conflict', 'The durable receipt does not match this exact request.');
        return record;
    };
    const read = async (expected) => {
        let record;
        try { record = await store.get(expected.request.teamId, expected.effectId); }
        catch { fail('journal_unavailable', 'The durable receipt could not be read.'); }
        return validate(record, expected);
    };
    const access = async (expected, phase) => {
        let result;
        try { result = await authorize(structuredClone(expected.request), phase); }
        catch { fail('authorization_unavailable', 'Current authorization could not be verified.'); }
        if (result?.actorAllowed !== true) fail('permission_denied', 'Current actor authorization could not be verified.');
        if (typeof result.sourceCurrent !== 'boolean' || typeof result.recipientAllowed !== 'boolean') fail('authorization_unavailable', 'Source and recipient authorization must be verified explicitly.');
        return result.sourceCurrent && result.recipientAllowed;
    };
    const project = (record) => ({ effectId: record.effectId, status: record.status, attempt: record.attempt,
        providerAcceptance: record.status === 'accepted' ? 'confirmed' : record.status === 'uncertain' ? 'unknown' : 'not_confirmed',
        deviceDelivery: 'unverified' });
    // Every transition has an operation identity so a lost commit response can
    // be reconciled before proceeding. An unreadable journal never permits send.
    const change = async (expected, operation, update) => {
        try {
            return await store.change(expected.request.teamId, expected.effectId, (row) => {
                const before = validate(row, expected); const after = update(before);
                return after === before ? before : { ...after, operation, updatedAt: time() };
            });
        } catch (error) {
            if (error instanceof NotificationJournalError) throw error;
            const saved = await read(expected).catch(() => null);
            if (saved?.operation === operation) return saved;
            fail('journal_unavailable', 'The journal transition could not be verified. No automatic provider retry is authorized.');
        }
    };
    const makeId = () => { const id = uuid(); if (!UUID.test(id || '')) fail('nonce_unavailable', 'A secure attempt ID is required.'); return id; };
    const finish = (expected, leaseId, status, evidence = null) => change(expected, makeId(), (record) => {
        const lateProof = record?.status === 'uncertain' && record.dispatch?.attemptId === leaseId && proof(evidence, expected, leaseId);
        if (!record || (record.lease?.id !== leaseId && !lateProof)) fail('lease_lost', 'This worker no longer owns the attempt.');
        if (TERMINAL.has(record.status)) return record;
        return { ...record, status, evidence, lease: null, retryAt: status === 'retryable' ? time() + retryMs : null };
    });
    const proof = (value, expected, attemptId) => value && UUID.test(attemptId || '') && value.effectId === expected.effectId && value.requestHash === expected.requestHash
        && value.attemptId === attemptId && value.final === true && bounded(value.receiptId, 256)
        && ['accepted', 'rejected'].includes(value.outcome);
    const proofFields = (value) => Object.fromEntries(['effectId', 'requestHash', 'attemptId', 'final', 'outcome', 'receiptId'].map((key) => [key, value[key]]));

    async function prepare(expected) {
        const allowed = await access(expected, 'prepare');
        return change(expected, makeId(), (record) => record || ({ schemaVersion: 1, effectId: expected.effectId, requestHash: expected.requestHash,
            request: expected.request, status: allowed ? 'pending' : 'suppressed', attempt: 0, lease: null, dispatch: null, retryAt: null, evidence: null }));
    }
    async function status(raw) {
        const expected = normalizeNotificationAttempt(raw); await access(expected, 'status');
        const record = await read(expected);
        if (!record) return { effectId: expected.effectId, status: 'not_found', providerAcceptance: 'not_confirmed', deviceDelivery: 'unverified' };
        // A crashed worker may have crossed the provider boundary. Expiration
        // does not make that request safe to send again.
        if (record.status === 'dispatching' && record.lease.until <= time()) {
            const marked = await change(expected, makeId(), (current) => current.status === 'dispatching' && current.lease.until <= time()
                ? { ...current, status: 'uncertain', lease: null } : current);
            return project(marked);
        }
        return project(record);
    }
    async function deliver(raw) {
        const expected = normalizeNotificationAttempt(raw);
        let record = await prepare(expected);
        if (TERMINAL.has(record.status)) return project(record);
        const leaseId = makeId();
        record = await change(expected, makeId(), (current) => {
            if (TERMINAL.has(current.status) || current.status === 'uncertain') return current;
            if (current.status === 'dispatching') return current.lease.until > time() ? current : { ...current, status: 'uncertain', lease: null };
            if ((current.lease && current.lease.until > time()) || (current.retryAt && current.retryAt > time())) return current;
            if (current.attempt >= maxAttempts) return { ...current, status: 'failed', lease: null };
            return { ...current, status: 'leased', attempt: current.attempt + 1, lease: { id: leaseId, until: time() + leaseMs }, dispatch: null, retryAt: null };
        });
        if (record.status !== 'leased' || record.lease?.id !== leaseId) return project(record);
        let dispatched = false;
        try {
            if (!await access(expected, 'before_dispatch')) return project(await finish(expected, leaseId, 'suppressed'));
            record = await change(expected, makeId(), (current) => {
                if (current.status !== 'leased' || current.lease?.id !== leaseId || current.lease.until <= time()) fail('lease_lost', 'The attempt lease expired before provider dispatch.');
                return { ...current, status: 'dispatching', dispatch: { attemptId: leaseId, requestHash: expected.requestHash, startedAt: time() } };
            });
            // Persistence acknowledgment (or its recovery read) may outlive
            // authorization or the lease. The marker is not permission to send.
            record = await read(expected);
            const assertDispatchReady = () => {
                if (!record || record.status !== 'dispatching' || record.lease?.id !== leaseId
                    || record.dispatch?.attemptId !== leaseId || record.lease.until <= time()) {
                    fail('lease_lost', 'The exact durable dispatch lease is no longer current.');
                }
            };
            assertDispatchReady();
            if (!await access(expected, 'after_dispatch_ack')) fail('permission_denied', 'The current source or recipient no longer permits this delivery.');
            // No awaited work between the final lease check and provider call.
            assertDispatchReady();
            dispatched = true;
            const result = await send(structuredClone(record.request), { effectId: expected.effectId, requestHash: expected.requestHash, attemptId: leaseId, idempotencyKey: expected.effectId });
            if (!proof(result, expected, leaseId)) return project(await finish(expected, leaseId, 'uncertain'));
            const state = result.outcome === 'accepted' ? 'accepted' : record.attempt >= maxAttempts ? 'failed' : 'retryable';
            return project(await finish(expected, leaseId, state, proofFields(result)));
        } catch (error) {
            // Do not erase a durable dispatch marker when its commit response
            // was lost, even if this process never reached send().
            const saved = await read(expected).catch(() => null);
            if (saved && TERMINAL.has(saved.status)) return project(saved);
            if (saved?.lease?.id === leaseId) {
                const stopped = await finish(expected, leaseId, dispatched || saved.dispatch ? 'uncertain' : 'retryable');
                if (['permission_denied', 'authorization_unavailable'].includes(error?.code)) throw error;
                return project(stopped);
            }
            if (saved?.status === 'uncertain') return project(saved);
            throw error;
        }
    }
    async function reconcileAttempt(raw) {
        const expected = normalizeNotificationAttempt(raw); await access(expected, 'reconcile');
        await status(raw); let record = await read(expected);
        if (!record || record.status !== 'uncertain' || typeof reconcile !== 'function') return record ? project(record) : status(raw);
        const attemptId = record.dispatch?.attemptId;
        if (!UUID.test(attemptId || '')) fail('receipt_conflict', 'Uncertain delivery lacks a durable attempt identity.');
        let evidence;
        try { evidence = await reconcile(structuredClone(record.request), { effectId: expected.effectId, requestHash: expected.requestHash, attemptId, idempotencyKey: expected.effectId }); }
        catch { return project(record); }
        // A missing record, timeout or temporary provider 404 is never evidence
        // that an in-flight request will not later be accepted.
        if (!proof(evidence, expected, attemptId)) return project(record);
        record = await change(expected, makeId(), (current) => {
            if (current.status !== 'uncertain' || current.dispatch?.attemptId !== attemptId) return current;
            return { ...current, status: evidence.outcome === 'accepted' ? 'accepted' : current.attempt >= maxAttempts ? 'failed' : 'retryable',
                evidence: proofFields(evidence), lease: null, retryAt: evidence.outcome === 'rejected' ? time() + retryMs : null };
        });
        return project(record);
    }
    async function reservePlan(rawRequests, emptySource) {
        if (!Array.isArray(rawRequests) || rawRequests.length > 100) fail('invalid_request', 'A frozen notification plan supports at most 100 recipient/channel targets.');
        const expected = rawRequests.map(normalizeNotificationAttempt).sort((a, b) => a.effectId.localeCompare(b.effectId));
        const emptyIdentity = expected.length ? null : normalizeNotificationAttempt({ ...emptySource, recipientUid: emptySource?.actorUid, channel: 'inbox', endpoint: emptySource?.actorUid });
        const first = expected[0]?.request || emptyIdentity.request;
        const source = (request) => Object.fromEntries(['teamId', 'eventId', 'actorUid', 'sourceVersion', 'title', 'body'].map((key) => [key, request[key]]));
        const sourceHash = hash(source(first));
        if (new Set(expected.map((item) => item.effectId)).size !== expected.length || expected.some((item) => hash(source(item.request)) !== sourceHash)) fail('invalid_request', 'Plan targets must be distinct and describe the same exact approved source revision and content.');
        const planId = hash({ plan: true, teamId: first.teamId, eventId: first.eventId, sourceVersion: first.sourceVersion });
        if (emptyIdentity) await access(emptyIdentity, 'plan_source');
        for (const item of expected) await access(item, 'plan');
        const requests = expected.map((item) => item.request);
        const validatePlan = (record) => {
            if (record && (record.kind !== 'notification-plan' || record.schemaVersion !== 1 || record.planId !== planId || record.sourceHash !== sourceHash
                || !Array.isArray(record.requests) || record.requests.length > 100 || hash(record.requests) !== record.planHash
                || record.requests.some((request) => hash(source(normalizeNotificationAttempt(request).request)) !== sourceHash))) fail('receipt_conflict', 'The frozen delivery plan does not match this source.');
            return record;
        };
        try {
            return await store.change(first.teamId, planId, (row) => validatePlan(row) || ({ schemaVersion: 1, kind: 'notification-plan', planId, sourceHash,
                requests, planHash: hash(requests), createdAt: time() }));
        } catch (error) {
            if (error instanceof NotificationJournalError) throw error;
            const saved = await store.get(first.teamId, planId).catch(() => null);
            if (saved) return validatePlan(saved);
            fail('journal_unavailable', 'The frozen recipient plan could not be verified. No send is authorized.');
        }
    }
    async function processPlan(rawRequests, action, emptySource) {
        const plan = await reservePlan(rawRequests, emptySource);
        const results = [];
        // The first durable plan remains authoritative. Device rotation, newly
        // joined members or changed discovery must not expand a retry's audience.
        for (const request of plan.requests) results.push(await action(request));
        return { planId: plan.planId, plannedTargetCount: plan.requests.length, results };
    }
    return { deliver, status, reconcile: reconcileAttempt, deliverPlan: (requests, emptySource) => processPlan(requests, deliver, emptySource), reconcilePlan: (requests, emptySource) => processPlan(requests, reconcileAttempt, emptySource) };
}

module.exports = { NotificationJournalError, normalizeNotificationAttempt, createFirestoreNotificationJournalStore, createNotificationAttemptJournal };
