"use strict";
const { randomUUID } = require('node:crypto');
const { scheduleDeliveryFingerprint: hash } = require('./schedule-delivery-coordinator.cjs');
const { NotificationJournalError } = require('./notification-attempt-journal.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const identityKeys = ['uid', 'clientId', 'grantKey', 'sessionId'];
const commandKeys = ['proposalId', 'teamId', 'eventId', 'mode', 'eventType', 'intentDigest', 'eventDigest', 'beforeVersion'];
const same = (a, b, keys) => keys.every((key) => a?.[key] === b?.[key]);
const fail = (code = 'evidence_denied') => { throw new NotificationJournalError(code, 'Current actor-bound approval or commit evidence could not be verified.'); };

// Internal authority only. Neither issuance nor consumption is an HTTP tool.
// Form and command verifiers must be owned by the authenticated session broker;
// commit observation must come from its user-credentialed Firestore writer.
function createScheduleEvidenceAuthority({ store, authenticate, verifyForm, resolveCommand, verifyCommitObservation, authorize, now = Date.now, uuid = randomUUID }) {
    if (!store?.get || !store?.change || [authenticate, verifyForm, resolveCommand, verifyCommitObservation, authorize].some((fn) => typeof fn !== 'function')) throw new Error('Explicit trusted evidence interfaces are required.');
    const safe = async (callback) => { try { return await callback(); } catch { fail(); } };
    const actorFor = async (credential) => {
        const actor = await safe(() => authenticate(credential));
        if (!actor || !['uid', 'clientId', 'sessionId'].every((key) => ID.test(actor[key] || '')) || !HASH.test(actor.grantKey || '')
            || actor.reviewRequests !== true || !Number.isSafeInteger(actor.expiresAt) || actor.expiresAt <= now()) fail();
        return actor;
    };
    const validate = (row, reference) => {
        if (!row || row.kind !== 'schedule-approval-evidence' || row.schemaVersion !== 1 || row.teamId !== reference.teamId || row.evidenceId !== reference.evidenceId
            || hash(row.approval) !== row.approvalHash || !['approved', 'consumed', 'committed'].includes(row.state)
            || (row.state !== 'approved' && (!UUID.test(row.dispatchId || '') || !Number.isSafeInteger(row.consumedAt)))
            || (row.state === 'committed' && (!row.commit || hash(row.commit) !== row.commitHash))) fail('evidence_conflict');
        return row;
    };
    const checkReference = (reference) => {
        if (!reference || Object.keys(reference).some((key) => !['teamId', 'evidenceId'].includes(key)) || !ID.test(reference.teamId || '') || !HASH.test(reference.evidenceId || '')) fail();
    };
    const read = async (reference) => { checkReference(reference); return validate(await safe(() => store.get(reference.teamId, reference.evidenceId)), reference); };
    const access = async (credential, row) => {
        const actor = await actorFor(credential);
        if (!same(actor, row.approval, identityKeys) || await safe(() => authorize(actor, structuredClone(row.approval))) !== true) fail();
        return actor;
    };
    const change = async (reference, operationId, callback) => {
        let saved;
        try { saved = await store.change(reference.teamId, reference.evidenceId, (row) => ({ ...callback(row), operationId })); }
        catch (error) {
            if (error instanceof NotificationJournalError) throw error;
            saved = await read(reference);
            if (saved.operationId !== operationId) fail('evidence_outcome_unknown');
        }
        validate(saved, reference);
        if (saved.operationId !== operationId) fail('evidence_outcome_unknown');
        return saved;
    };
    const nonce = () => { const value = uuid(); if (!UUID.test(value || '')) fail(); return value; };
    return {
        async issue(credential, { formHandle, commandHandle }) {
            const actor = await actorFor(credential);
            const command = await safe(() => resolveCommand(commandHandle, actor));
            const form = await safe(() => verifyForm(formHandle, actor, command));
            if (!command || !form || !same(actor, form, identityKeys) || !same(command, form, commandKeys)
                || !['proposalId', 'teamId', 'eventId'].every((key) => ID.test(command[key] || ''))
                || !['intentDigest', 'eventDigest', 'previewDigest'].every((key) => HASH.test(command[key] || '')) || form.previewDigest !== command.previewDigest
                || !['create', 'update'].includes(command.mode) || !['game', 'practice'].includes(command.eventType)
                || (command.mode === 'create' ? command.beforeVersion !== null : !Number.isFinite(Date.parse(command.beforeVersion)))
                || form.approve !== true || form.notifyTeam !== true || form.disconnected !== false
                || ![form.issuedAt, form.expiresAt].every(Number.isSafeInteger) || form.issuedAt > now() || form.issuedAt < 0
                || form.expiresAt <= now() || form.expiresAt > actor.expiresAt || form.expiresAt - form.issuedAt > 120000) fail();
            const approval = { ...Object.fromEntries(identityKeys.map((key) => [key, actor[key]])),
                ...Object.fromEntries(commandKeys.map((key) => [key, command[key]])), previewDigest: command.previewDigest,
                issuedAt: form.issuedAt, expiresAt: form.expiresAt, approve: true, notifyTeam: true };
            const evidenceId = hash({ authority: 'schedule-v1', ...Object.fromEntries([...identityKeys, 'proposalId'].map((key) => [key, approval[key]])) });
            approval.approvalId = evidenceId;
            const reference = { teamId: command.teamId, evidenceId };
            const candidate = { kind: 'schedule-approval-evidence', schemaVersion: 1, ...reference, approval, approvalHash: hash(approval), state: 'approved' };
            await access(credential, candidate);
            await change(reference, nonce(), (existing) => {
                if (existing && validate(existing, reference).approvalHash !== candidate.approvalHash) fail('evidence_conflict');
                return existing || candidate;
            });
            return reference; // opaque, never a reusable execution credential
        },
        async consume(credential, reference) {
            const before = await read(reference); await access(credential, before);
            const dispatchId = nonce();
            const saved = await change(reference, nonce(), (row) => {
                validate(row, reference);
                if (row.approvalHash !== before.approvalHash || row.state !== 'approved') fail('approval_replayed');
                if (row.approval.expiresAt <= now()) fail('approval_expired');
                return { ...row, state: 'consumed', consumedAt: now(), dispatchId };
            });
            await access(credential, saved);
            if (saved.approval.expiresAt <= now()) fail('approval_expired');
            // This return value is for the trusted commit worker only. It is
            // never serialized to an MCP response or a readable user document.
            return { dispatchId: saved.dispatchId, approval: structuredClone(saved.approval) };
        },
        async recordCommit(credential, reference, dispatchId, observationHandle) {
            const before = await read(reference); await access(credential, before);
            if (!UUID.test(dispatchId || '') || before.dispatchId !== dispatchId || before.state === 'approved') fail();
            const observed = await safe(() => verifyCommitObservation(observationHandle, { approval: structuredClone(before.approval), dispatchId }));
            if (!observed || !same(observed, before.approval, [...identityKeys, ...commandKeys]) || observed.dispatchId !== dispatchId
                || observed.committed !== true || !Number.isFinite(Date.parse(observed.sourceVersion))
                || observed.committedAt !== Date.parse(observed.sourceVersion) || observed.committedAt < before.consumedAt
                || observed.committedAt > before.approval.expiresAt || observed.committedAt > now()) fail();
            const commit = { ...before.approval, consumed: true, consumedAt: before.consumedAt, committed: true,
                sourceVersion: observed.sourceVersion, committedAt: observed.committedAt };
            await change(reference, nonce(), (row) => {
                validate(row, reference);
                if (row.dispatchId !== dispatchId || row.approvalHash !== before.approvalHash || (row.state === 'committed' && row.commitHash !== hash(commit))) fail('evidence_conflict');
                return { ...row, state: 'committed', commit, commitHash: hash(commit) };
            });
            return reference;
        },
        async verifyApproval(reference) {
            const row = await read(reference);
            if (row.state !== 'committed') fail('commit_unverified');
            return { ...structuredClone(row.approval), consumed: true, consumedAt: row.consumedAt };
        },
        async verifyCommit(reference) {
            const row = await read(reference);
            if (row.state !== 'committed') fail('commit_unverified');
            return structuredClone(row.commit);
        }
    };
}

module.exports = { createScheduleEvidenceAuthority };
