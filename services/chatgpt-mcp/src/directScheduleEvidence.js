import { DomainError } from './core.js';
import { fingerprint } from './directRevisionCommand.js';
import { approvedScheduleWrite } from './scheduleEvidenceSemantics.js';

const identityKeys = ['uid', 'clientId', 'grantKey', 'sessionId'];
const sameActor = (one, two) => identityKeys.every((key) => one[key] === two[key]);
const deny = () => { throw new DomainError('confirmation_unavailable', 'The bound approval and credentialed commit evidence could not be verified.'); };

// Canonical Firestore wire data preserves references, nanosecond timestamps,
// empty containers and nulls without decoding/re-encoding unrelated fields.
export function canonicalEvidenceFields(fields) {
    const value = (entry) => {
        if ('timestampValue' in entry) {
            const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(entry.timestampValue);
            if (!match || !Number.isFinite(Date.parse(entry.timestampValue))) deny();
            return { timestampValue: `${match[1]}.${(match[2] || '').padEnd(9, '0')}Z` };
        }
        if ('nullValue' in entry) return { nullValue: null };
        if ('mapValue' in entry) return { mapValue: { fields: canonicalEvidenceFields(entry.mapValue.fields || {}) } };
        if ('arrayValue' in entry) return { arrayValue: { values: (entry.arrayValue.values || []).map(value) } };
        return structuredClone(entry);
    };
    return Object.fromEntries(Object.entries(fields || {}).map(([key, entry]) => [key, value(entry)]));
}

export function createCredentialedEvidenceReader({ projectId, getActor, fetchImpl = fetch }) {
    const prefix = `projects/${projectId}/databases/(default)/documents/`;
    return async ({ teamId, eventId }) => {
        if (![teamId, eventId].every((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id || ''))) deny();
        const actor = await getActor();
        const name = `${prefix}teams/${teamId}/games/${eventId}`;
        const response = await fetchImpl(`https://firestore.googleapis.com/v1/${prefix.slice(0, -1)}:batchGet`, {
            method: 'POST', headers: { Authorization: `Bearer ${actor.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ documents: [name] })
        });
        if (!response.ok) deny();
        const rows = await response.json();
        if (!Array.isArray(rows) || rows.length !== 1 || rows[0].found?.name !== name || !rows[0].found.updateTime) deny();
        return { version: rows[0].found.updateTime, data: canonicalEvidenceFields(rows[0].found.fields) };
    };
}

// Local trusted-process composition only, with no Admin client or backend
// credentials. The injected authority factory is server-owned. Opaque object
// handles cannot be supplied by JSON tool arguments or user-written receipts.
// A production split-process channel is deliberately not implemented here.
export function createBrokerScheduleEvidenceBridge({ projectId, getActor, sessionId, createAuthority, readEvent, authorizeCommand, onEvidence = () => {}, now = Date.now }) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId || '') || !/^[a-z][a-z0-9-]{3,62}$/.test(projectId || '') || [getActor, createAuthority, readEvent, authorizeCommand].some((fn) => typeof fn !== 'function')) throw new Error('A live broker session, credentialed reader and trusted authority are required.');
    const forms = new WeakMap(); const commands = new WeakMap(); const observations = new WeakMap(); const attempts = new WeakMap();
    const credential = Object.freeze({});
    const current = async () => {
        const actor = await getActor();
        if (actor?.reviewRequests !== true || !Number.isSafeInteger(actor.expiresAt) || actor.expiresAt <= now()) deny();
        return { ...actor, sessionId };
    };
    const authority = createAuthority({
        authenticate: async (candidate) => { if (candidate !== credential) deny(); return current(); },
        resolveCommand: async (handle, actor) => { const command = commands.get(handle); if (!command || !sameActor(command, actor)) deny(); return structuredClone(command); },
        verifyForm: async (handle, actor, command) => {
            const form = forms.get(handle);
            if (!form || !sameActor(form, actor) || form.previewDigest !== command.previewDigest) deny();
            const { preview, ...binding } = form;
            return { ...command, ...binding, disconnected: false };
        },
        verifyCommitObservation: async (handle, expected) => {
            const observed = observations.get(handle);
            if (!observed || observed.dispatchId !== expected.dispatchId || observed.intentDigest !== expected.approval.intentDigest) deny();
            return structuredClone(observed);
        },
        authorize: authorizeCommand
    });
    return {
        async captureForm({ actor, preview, issuedAt, expiresAt, content }) {
            const live = await current();
            if (!sameActor({ ...actor, sessionId }, live) || content.approve !== true) deny();
            const handle = Object.freeze({});
            forms.set(handle, { ...Object.fromEntries(identityKeys.map((key) => [key, live[key]])), previewDigest: fingerprint(preview), issuedAt, expiresAt,
                preview: structuredClone(preview), approve: content.approve, notifyTeam: content.notifyTeam === true });
            return handle;
        },
        async beforeCommit({ descriptor, formEvidence, plan }) {
            const actor = await current(); const form = forms.get(formEvidence);
            if (!form || form.used || !sameActor(form, actor) || form.notifyTeam !== true || descriptor.previewDigest !== form.previewDigest || now() >= form.expiresAt) deny();
            const eventPath = `teams/${descriptor.teamId}/games/${descriptor.eventId}`;
            const row = plan?.reads?.[eventPath];
            const eventWrite = plan?.writes?.find((write) => write.update?.name?.endsWith(`/documents/${eventPath}`));
            const prefix = eventWrite?.update.name.slice(0, -eventPath.length);
            if (prefix !== `projects/${projectId}/databases/(default)/documents/` || plan.writes.length !== 3 || eventWrite.updateTransforms || eventWrite.transform
                || (descriptor.mode === 'create' ? row?.missing !== `${prefix}${eventPath}` || eventWrite.updateMask
                    : row?.found?.name !== `${prefix}${eventPath}` || row.found.updateTime !== descriptor.beforeVersion || !eventWrite.updateMask)) deny();
            const receiptPath = `${prefix}users/${actor.uid}/privateAiPendingActions/direct_${descriptor.proposalId}`;
            const receipt = plan.writes.find((write) => write.update?.name === receiptPath)?.update.fields;
            if (!receipt || receipt.digest?.stringValue !== descriptor.intentDigest || receipt.status?.stringValue !== 'completed' || receipt.receiptOnly?.booleanValue !== true
                || !plan.writes.some((write) => write.delete === `${prefix}teams/${descriptor.teamId}/privateAiPendingActions/direct_${actor.uid}_${descriptor.proposalId}`)) deny();
            const expected = approvedScheduleWrite({ preview: form.preview, descriptor, actor, row, write: eventWrite, issuedAt: form.issuedAt, now: now() });
            if (fingerprint(canonicalEvidenceFields(expected)) !== fingerprint(canonicalEvidenceFields(eventWrite.update.fields))) deny();
            const fields = descriptor.mode === 'create' ? structuredClone(eventWrite.update.fields) : structuredClone(row.found.fields);
            if (descriptor.mode === 'update') {
                const mask = eventWrite.updateMask.fieldPaths;
                if (!Array.isArray(mask) || mask.some((key) => key.includes('.') || !Object.hasOwn(eventWrite.update.fields, key))
                    || fingerprint([...mask].sort()) !== fingerprint(Object.keys(eventWrite.update.fields).sort())) deny();
                for (const key of mask) fields[key] = structuredClone(eventWrite.update.fields[key]);
            }
            const command = { ...descriptor, ...Object.fromEntries(identityKeys.map((key) => [key, actor[key]])), eventDigest: fingerprint(canonicalEvidenceFields(fields)) };
            const commandHandle = Object.freeze({}); commands.set(commandHandle, command); form.used = true;
            const reference = await authority.issue(credential, { formHandle: formEvidence, commandHandle });
            const dispatch = await authority.consume(credential, reference);
            if (!sameActor(await current(), actor) || now() >= form.expiresAt) deny();
            const attempt = Object.freeze({});
            attempts.set(attempt, { reference, dispatchId: dispatch.dispatchId, command, planDigest: fingerprint(plan), eventIndex: plan.writes.indexOf(eventWrite) });
            return attempt;
        },
        async afterCommit(handle, { plan, response }) {
            const attempt = attempts.get(handle);
            if (!attempt || attempt.recorded || fingerprint(plan) !== attempt.planDigest || !sameActor(await current(), attempt.command)
                || !Array.isArray(response?.writeResults) || response.writeResults.length !== plan.writes.length) deny();
            const sourceVersion = response.writeResults[attempt.eventIndex]?.updateTime;
            if (!sourceVersion || Date.parse(sourceVersion) !== Date.parse(response.commitTime)) deny();
            const event = await readEvent(attempt.command);
            if (event.version !== sourceVersion || fingerprint(event.data) !== attempt.command.eventDigest) deny();
            const observationHandle = Object.freeze({});
            observations.set(observationHandle, { ...attempt.command, dispatchId: attempt.dispatchId, committed: true, sourceVersion, committedAt: Date.parse(sourceVersion) });
            await authority.recordCommit(credential, attempt.reference, attempt.dispatchId, observationHandle);
            attempt.recorded = true;
            await onEvidence(attempt.reference);
        }
    };
}
