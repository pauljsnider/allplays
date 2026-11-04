"use strict";

// Unmounted backend interface. Verified evidence must come from a trusted
// approval/commit authority; client-writable MCP receipts are never evidence.
const { createHash } = require('node:crypto');
const { createNotificationAttemptJournal, normalizeNotificationAttempt, NotificationJournalError } = require('./notification-attempt-journal.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const fail = (code = 'binding_denied') => { throw new NotificationJournalError(code, 'Verified schedule delivery evidence or current authorization is unavailable.'); };
const same = (one, two, keys) => keys.every((key) => one[key] === two[key]);
const identityKeys = ['uid', 'clientId', 'grantKey'];
const evidenceKeys = [...identityKeys, 'sessionId', 'approvalId', 'proposalId', 'teamId', 'eventId', 'intentDigest', 'eventDigest', 'beforeVersion', 'mode', 'eventType'];
const approvalAuditKeys = ['issuedAt', 'expiresAt', 'consumedAt', 'approve', 'notifyTeam', 'consumed'];

function createScheduleDeliveryCoordinator({ store, authenticate, verifyApproval, verifyCommit, readEvent, authorize, resolveRecipients, providers, now = Date.now }) {
    if (!store?.get || !store?.change || !providers?.pin || !providers?.send || !providers?.reconcile
        || [authenticate, verifyApproval, verifyCommit, readEvent, authorize, resolveRecipients].some((fn) => typeof fn !== 'function')) throw new Error('Explicit trusted evidence, authorization, recipient and provider interfaces are required.');
    const safely = async (callback) => { try { return await callback(); } catch { fail(); } };
    const actorFor = async (credential) => {
        const actor = await safely(() => authenticate(credential));
        if (!actor || !ID.test(actor.uid || '') || !ID.test(actor.clientId || '') || !HASH.test(actor.grantKey || '')
            || actor.reviewRequests !== true || !Number.isSafeInteger(actor.expiresAt) || actor.expiresAt <= now()) fail();
        return actor;
    };
    const currentAccess = async (credential, binding, phase, request = null) => {
        const actor = await actorFor(credential);
        if (!same(actor, binding, identityKeys)) fail();
        const allowed = await safely(() => authorize({ actor, binding: structuredClone(binding), phase, request: request && structuredClone(request) }));
        if (allowed?.actorAllowed !== true) fail();
        if (typeof allowed.recipientAllowed !== 'boolean') fail();
        return allowed;
    };
    const validateBinding = (row, teamId, bindingId) => {
        if (!row || row.kind !== 'approved-schedule-delivery' || row.schemaVersion !== 1 || row.teamId !== teamId || row.bindingId !== bindingId
            || !HASH.test(row.evidenceHash || '') || fingerprint(row.evidence) !== row.evidenceHash
            || !same(row, row.evidence, [...evidenceKeys, ...approvalAuditKeys, 'committedAt', 'sourceVersion']) || !HASH.test(row.eventDigest || '')) fail('receipt_conflict');
        return row;
    };
    const getBinding = async (credential, reference) => {
        if (!reference || Object.keys(reference).some((key) => !['teamId', 'bindingId'].includes(key)) || !ID.test(reference.teamId || '') || !HASH.test(reference.bindingId || '')) fail();
        const actor = await actorFor(credential);
        const binding = validateBinding(await safely(() => store.get(reference.teamId, reference.bindingId)), reference.teamId, reference.bindingId);
        if (!same(actor, binding, identityKeys)) fail();
        await currentAccess(credential, binding, 'status');
        return binding;
    };
    const sourceCurrent = async (binding) => {
        const event = await safely(() => readEvent({ teamId: binding.teamId, eventId: binding.eventId }));
        return !!event?.data && event.version === binding.sourceVersion && fingerprint(event.data) === binding.eventDigest;
    };
    const journalFor = (credential, binding) => createNotificationAttemptJournal({ store, now,
        authorize: async (request, phase) => {
            const access = await currentAccess(credential, binding, phase, request);
            return { actorAllowed: true, sourceCurrent: await sourceCurrent(binding), recipientAllowed: access.recipientAllowed };
        }, send: providers.send, reconcile: providers.reconcile });
    const source = (binding) => ({ teamId: binding.teamId, eventId: binding.eventId, actorUid: binding.uid, sourceVersion: binding.sourceVersion,
        title: binding.mode === 'create' ? 'Schedule event added' : 'Schedule event updated', body: 'Open ALL PLAYS to review the schedule change.' });
    const planIdFor = (binding) => fingerprint({ plan: true, teamId: binding.teamId, eventId: binding.eventId, sourceVersion: binding.sourceVersion });
    const storedPlan = async (binding) => {
        const plan = await safely(() => store.get(binding.teamId, planIdFor(binding)));
        if (!plan) return null;
        const sourceHash = fingerprint(source(binding));
        if (plan.kind !== 'notification-plan' || plan.schemaVersion !== 1 || plan.planId !== planIdFor(binding) || plan.sourceHash !== sourceHash
            || !Array.isArray(plan.requests) || plan.requests.length > 100 || fingerprint(plan.requests) !== plan.planHash) fail('receipt_conflict');
        for (const request of plan.requests) {
            normalizeNotificationAttempt(request);
            if (!same(request, source(binding), Object.keys(source(binding))) || !request.provider) fail('receipt_conflict');
        }
        return plan;
    };
    const summary = (binding, results, planned) => ({ bindingId: binding.bindingId, status: planned ? 'recorded' : 'not_started',
        plannedTargetCount: results.length, accepted: results.filter((row) => row.status === 'accepted').length,
        uncertain: results.filter((row) => ['uncertain', 'dispatching'].includes(row.status)).length,
        suppressed: results.filter((row) => row.status === 'suppressed').length,
        pending: results.filter((row) => ['not_found', 'pending', 'leased', 'retryable'].includes(row.status)).length,
        failed: results.filter((row) => row.status === 'failed').length, deviceDelivery: 'unverified' });
    return {
        async bind(credential, { approvalHandle, commitHandle }) {
            const actor = await actorFor(credential);
            const approval = await safely(() => verifyApproval(approvalHandle));
            const commit = await safely(() => verifyCommit(commitHandle));
            if (!approval || !commit || !same(approval, actor, identityKeys) || !same(approval, commit, evidenceKeys)
                || !['sessionId', 'approvalId', 'proposalId', 'teamId', 'eventId'].every((key) => ID.test(approval[key] || ''))
                || !['intentDigest', 'eventDigest'].every((key) => HASH.test(approval[key] || ''))
                || !['create', 'update'].includes(approval.mode) || !['game', 'practice'].includes(approval.eventType)
                || approval.approve !== true || approval.notifyTeam !== true || approval.consumed !== true || commit.committed !== true
                || ![approval.issuedAt, approval.expiresAt, approval.consumedAt, commit.committedAt].every(Number.isSafeInteger)
                || approval.issuedAt < 0 || approval.expiresAt <= approval.issuedAt || approval.expiresAt - approval.issuedAt > 120000
                || approval.consumedAt < approval.issuedAt || approval.consumedAt > commit.committedAt
                || commit.committedAt > approval.expiresAt || commit.committedAt > now()
                || Date.parse(commit.sourceVersion) !== commit.committedAt
                || (approval.mode === 'create' ? approval.beforeVersion !== null : typeof approval.beforeVersion !== 'string')) fail();
            // Version format is shared with the journal, not inferred from a
            // client timestamp or a user-writable completion flag.
            normalizeNotificationAttempt({ ...source({ ...approval, sourceVersion: commit.sourceVersion }), recipientUid: actor.uid, endpoint: actor.uid, channel: 'inbox' });
            const evidence = { ...Object.fromEntries([...evidenceKeys, 'sourceVersion', 'committedAt'].map((key) => [key, commit[key]])),
                ...Object.fromEntries(approvalAuditKeys.map((key) => [key, approval[key]])) };
            const bindingId = fingerprint({ approvedSchedule: true, teamId: commit.teamId, eventId: commit.eventId, sourceVersion: commit.sourceVersion });
            const candidate = { kind: 'approved-schedule-delivery', schemaVersion: 1, ...evidence, bindingId, evidence,
                evidenceHash: fingerprint(evidence), createdAt: now() };
            await currentAccess(credential, candidate, 'bind');
            if (!await sourceCurrent(candidate)) fail('source_changed');
            let saved;
            try { saved = await store.change(candidate.teamId, bindingId, (existing) => {
                if (existing && validateBinding(existing, candidate.teamId, bindingId).evidenceHash !== candidate.evidenceHash) fail('receipt_conflict');
                return existing || candidate;
            }); } catch (error) {
                if (error instanceof NotificationJournalError) throw error;
                saved = await safely(() => store.get(candidate.teamId, bindingId));
                if (!saved || validateBinding(saved, candidate.teamId, bindingId).evidenceHash !== candidate.evidenceHash) fail();
            }
            validateBinding(saved, candidate.teamId, bindingId);
            if (saved.evidenceHash !== candidate.evidenceHash) fail('receipt_conflict');
            return { teamId: saved.teamId, bindingId: saved.bindingId };
        },
        async deliver(credential, reference) {
            const binding = await getBinding(credential, reference);
            const frozen = await storedPlan(binding);
            const journal = journalFor(credential, binding);
            if (!frozen && !await sourceCurrent(binding)) fail('source_changed');
            let requests = frozen?.requests;
            if (!requests) {
                const targets = await safely(() => resolveRecipients({ teamId: binding.teamId, eventId: binding.eventId, sourceVersion: binding.sourceVersion, actorUid: binding.uid }));
                if (!Array.isArray(targets) || targets.length > 100) fail();
                requests = targets.map((target) => {
                    if (!target || Object.keys(target).some((key) => !['recipientUid', 'channel', 'endpoint'].includes(key))) fail();
                    return providers.pin(normalizeNotificationAttempt({ ...source(binding), ...target }).request);
                });
            }
            const result = await journal.deliverPlan(requests, source(binding));
            return summary(binding, result.results, true);
        },
        async status(credential, reference, { reconcile = false } = {}) {
            const binding = await getBinding(credential, reference);
            const plan = await storedPlan(binding);
            if (!plan) return summary(binding, [], false);
            const journal = journalFor(credential, binding);
            const results = [];
            for (const request of plan.requests) results.push(await (reconcile ? journal.reconcile(request) : journal.status(request)));
            return summary(binding, results, true);
        }
    };
}

module.exports = { createScheduleDeliveryCoordinator, scheduleDeliveryFingerprint: fingerprint };
