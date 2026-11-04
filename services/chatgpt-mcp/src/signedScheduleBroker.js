import { createRequire } from 'node:module';
import { DomainError } from './core.js';
import { fingerprint } from './directRevisionCommand.js';
import { createDirectScheduleCommands } from './directSchedule.js';
import { approvedContent } from './directConfirmation.js';
const require = createRequire(import.meta.url);
const { signBrokerCommand } = require('../../../functions/schedule-broker-channel.cjs');
const identityKeys = ['uid', 'clientId', 'grantKey', 'sessionId'];
const deny = () => { throw new DomainError('confirmation_unavailable', 'The exact session-bound schedule approval is unavailable.'); };
const sameActor = (one, two) => identityKeys.every((key) => one?.[key] === two?.[key]);

// Unmounted broker composition. The host supplies a reviewed signing key and
// private authenticated transport; tests use ephemeral keys and loopback only.
// No envelope, signing capability or user token is returned to an MCP tool.
export function createSignedScheduleBroker({ dependencies, getActor, sessionId, keyId, privateKey, audience, sendEnvelope, now = Date.now, maxSubmissions = 100 }) {
    if (![getActor, sendEnvelope].every((fn) => typeof fn === 'function') || !dependencies?.scheduleStore || !dependencies?.getContext
        || ![sessionId, keyId].every((value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))
        || privateKey?.asymmetricKeyType !== 'ed25519' || typeof audience !== 'string' || !audience
        || !Number.isInteger(maxSubmissions) || maxSubmissions < 1 || maxSubmissions > 100) throw new Error('Explicit bounded broker signing dependencies are required.');
    const forms = new WeakMap(); const submissions = new Map(); let closed = false;
    const local = createDirectScheduleCommands({ ...dependencies, store: dependencies.scheduleStore, now });
    const current = async () => {
        if (closed) deny();
        const actor = await getActor();
        if (closed || !['uid', 'clientId', 'grantKey'].every((key) => typeof actor?.[key] === 'string' && actor[key]) || actor?.uid !== dependencies.uid || actor.reviewRequests !== true || !Number.isSafeInteger(actor.expiresAt) || actor.expiresAt <= now()
            || typeof actor.idToken !== 'string' || !actor.idToken) deny();
        return { ...actor, sessionId };
    };
    const report = (proposalId, response) => ({ proposalId, operationId: response.operationId,
        status: response.status === 'committed' ? 'completed' : response.status, notificationDelivery: 'unverified',
        message: 'Check this same proposal ID after interruption. Do not repeat a save to resend notifications.' });
    const send = async (record, purpose) => {
        const actor = await current(); if (!sameActor(actor, record.actor)) deny();
        const issuedAt = purpose === 'schedule.execute' ? record.issuedAt : now();
        const expiresAt = purpose === 'schedule.execute' ? Math.min(record.expiresAt, actor.expiresAt) : Math.min(actor.expiresAt, issuedAt + 120000);
        if (expiresAt <= now()) deny();
        const envelope = signBrokerCommand({ keyId, privateKey, audience, actor: Object.fromEntries(identityKeys.map((key) => [key, actor[key]])),
            command: record.command, approval: record.approval, idToken: actor.idToken, issuedAt, expiresAt, purpose });
        // No awaited work between the final local deadline check and send.
        if (expiresAt <= now()) deny();
        const response = await sendEnvelope(envelope);
        const operationId = fingerprint({ kind: 'broker-command-v1', uid: actor.uid, teamId: record.command.teamId, proposalId: record.command.proposalId });
        if (response?.operationId !== operationId || !['not_started', 'committed', 'unverified'].includes(response.status)) deny();
        return report(record.command.proposalId, response);
    };
    const captureForm = async ({ actor, preview, issuedAt, expiresAt, content }) => {
        // Other bounded domains keep their existing one-action approval path.
        if (!/^(Create|Update) one scheduled (game|practice)$/.test(preview?.action || '')) return undefined;
        const live = await current();
        if (!sameActor({ ...actor, sessionId: actor?.sessionId ?? sessionId }, live) || content?.approve !== true || content.notifyTeam !== true
            || ![issuedAt, expiresAt].every(Number.isSafeInteger) || issuedAt < 0 || issuedAt > now() || expiresAt <= now() || expiresAt > live.expiresAt || expiresAt - issuedAt > 120000) deny();
        const handle = Object.freeze({}); forms.set(handle, { actor: Object.fromEntries(identityKeys.map((key) => [key, live[key]])),
            preview: structuredClone(preview), issuedAt, expiresAt, used: false });
        return handle;
    };
    const status = async ({ proposalId }) => {
        await current();
        const record = submissions.get(proposalId);
        if (record) return send(record, 'schedule.status');
        const result = await local.status({ proposalId });
        return result.status === 'completed' ? { ...result, businessStatus: 'completed', status: 'unverified', message: 'No bound backend status is available in this session. Check the app; do not repeat the save.' } : result;
    };
    return { captureForm, close: () => { closed = true; submissions.clear(); }, commands: {
        prepare: async (args) => {
            await current();
            if (submissions.has(args.proposalId)) return status(args);
            const result = await local.prepare(args);
            return result.status === 'completed' ? status(args) : result;
        }, status,
        confirm: async ({ proposalId }, approve) => {
            await current();
            if (submissions.has(proposalId)) return status({ proposalId });
            const record = await local.review({ proposalId });
            if (record.status === 'completed') return status({ proposalId });
            if (typeof approve !== 'function') deny();
            const answer = await approve(record.preview);
            if (!approvedContent(record.preview, answer)) return { proposalId, status: answer?.action === 'decline' ? 'declined' : 'cancelled', applied: false };
            if (typeof answer.consume !== 'function') deny();
            const form = forms.get(answer.formEvidence);
            if (!form || form.used || now() >= form.expiresAt || fingerprint(form.preview) !== fingerprint(record.preview)) deny();
            const fresh = await local.review({ proposalId });
            if (fresh.status !== 'prepared' || fresh.digest !== record.digest || fingerprint(fresh.preview) !== fingerprint(form.preview)) deny();
            await answer.consume();
            const actor = await current();
            if (!sameActor(actor, form.actor) || now() >= form.expiresAt || submissions.has(proposalId) || submissions.size >= maxSubmissions) deny();
            const command = { proposalId, ...Object.fromEntries(['mode', 'teamId', 'eventId', 'eventType', 'changes'].map((key) => [key, fresh[key]])) };
            if (form.preview.teamId !== command.teamId || form.preview.eventId !== command.eventId
                || fingerprint(form.preview.requested) !== fingerprint(command.changes)
                || form.preview.action !== `${command.mode === 'create' ? 'Create' : 'Update'} one scheduled ${command.eventType}`) deny();
            form.used = true;
            const submission = { actor: form.actor, command: structuredClone(command), approval: { preview: form.preview, approve: true, notifyTeam: true }, issuedAt: form.issuedAt, expiresAt: form.expiresAt };
            submissions.set(proposalId, submission); // retain before any awaited dispatch; retries are status-only
            return send(submission, 'schedule.execute');
        }
    } };
}
