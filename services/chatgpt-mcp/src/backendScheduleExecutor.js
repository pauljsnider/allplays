import { DomainError } from './core.js';
import { fingerprint } from './directRevisionCommand.js';
import { createDirectScheduleCommands, createDirectScheduleStore } from './directSchedule.js';
import { createBrokerScheduleEvidenceBridge, createCredentialedEvidenceReader } from './directScheduleEvidence.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const commandKeys = ['proposalId', 'mode', 'teamId', 'eventId', 'eventType', 'changes'];
const sameActor = (one, two) => ['uid', 'clientId', 'grantKey', 'sessionId'].every((key) => one?.[key] === two?.[key]);
const deny = () => { throw new DomainError('confirmation_unavailable', 'The signed schedule execution could not be verified.'); };

// Backend composition only. Neither production server imports this factory.
// The signed channel supplies the two non-serializable guards; this is not an
// MCP tool or a raw-JSON endpoint. Private evidence/producer factories belong to
// the backend; every application read/write uses the supplied user's ID token.
export function createBackendScheduleExecutor({ projectId, createAuthority, createProducer, fetchImpl = fetch, now = Date.now }) {
    if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{3,62}$/.test(projectId)
        || [createAuthority, createProducer, fetchImpl, now].some((fn) => typeof fn !== 'function')) throw new Error('Explicit backend evidence, producer and credentialed transport dependencies are required.');
    return async (input) => {
        if ([input?.assertCurrent, input?.assertDispatchReady].some((fn) => typeof fn !== 'function')) deny();
        const { assertCurrent, assertDispatchReady } = input;
        const { actor, command, approval, idToken, issuedAt, expiresAt } = structuredClone(Object.fromEntries(
            ['actor', 'command', 'approval', 'idToken', 'issuedAt', 'expiresAt'].map((key) => [key, input[key]])));
        if (!actor || ![actor.uid, actor.sessionId].every((value) => typeof value === 'string' && ID.test(value))
            || typeof actor.clientId !== 'string' || !/^[A-Za-z0-9._~-]{1,256}$/.test(actor.clientId)
            || typeof actor.grantKey !== 'string' || !/^[a-f0-9]{64}$/.test(actor.grantKey)
            || typeof idToken !== 'string' || !idToken || idToken.length > 8192 || !command
            || Object.keys(command).length !== commandKeys.length || !commandKeys.every((key) => Object.hasOwn(command, key))
            || typeof command.proposalId !== 'string' || !UUID.test(command.proposalId)
            || ![command.teamId, command.eventId].every((value) => typeof value === 'string' && ID.test(value))
            || !['create', 'update'].includes(command.mode) || !['game', 'practice'].includes(command.eventType)
            || (command.mode === 'create' && command.eventId !== `mcp_${command.proposalId}`)
            || approval?.approve !== true || approval.notifyTeam !== true || !approval.preview
            || ![issuedAt, expiresAt].every(Number.isSafeInteger) || issuedAt > now() || issuedAt < 0 || expiresAt <= now() || expiresAt - issuedAt > 120000) deny();
        const dispatchReady = () => {
            const result = assertDispatchReady();
            if (result !== undefined) {
                if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => {});
                deny(); // an async guard cannot protect the synchronous fetch boundary
            }
        };
        const check = async () => { await assertCurrent(); dispatchReady(); if (now() >= expiresAt) deny(); };
        const getActor = async () => { await check(); return { ...actor, idToken, reviewRequests: true, expiresAt }; };
        const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
        const userFetch = (url, options) => {
            if (typeof url !== 'string' || !(url.startsWith(`${base}:`) || url.startsWith(`${base}/`))
                || options?.headers?.Authorization !== `Bearer ${idToken}`) deny();
            return fetchImpl(url, { ...options, redirect: 'error' });
        };
        await check();
        const store = createDirectScheduleStore({ projectId, uid: actor.uid, getIdToken: async () => (await getActor()).idToken, fetchImpl: userFetch });
        const proposal = await store.get(`users/${actor.uid}/privateAiPendingActions/direct_${command.proposalId}`);
        const { proposalId, ...expected } = command;
        const stored = proposal.data;
        if (!proposal.exists || stored?.status !== 'prepared' || stored.userId !== actor.uid || stored.toolName !== 'mcp_direct_schedule_event'
            || fingerprint(Object.fromEntries(Object.keys(expected).map((key) => [key, stored[key]]))) !== fingerprint(expected)
            || fingerprint(stored.preview) !== fingerprint(approval.preview)) deny();
        let authority; let producer; let verifiedProof = false;
        const producerMethods = ['arm', 'beginWrite', 'cancelUnstarted', 'publish'];
        const producerAdapter = Object.fromEntries(producerMethods.map((method) => [method, (...args) => producer[method](...args)]));
        const authorizeCommand = async (candidate, action) => {
            if (!sameActor(candidate, actor) || action.teamId !== command.teamId) return false;
            await check(); return true; // channel checks current manager access for this exact team
        };
        const bridge = createBrokerScheduleEvidenceBridge({ projectId, getActor, sessionId: actor.sessionId, now,
            createAuthority: (interfaces) => {
                authority = createAuthority(interfaces);
                if (['issue', 'consume', 'recordCommit', 'verifyCommit'].some((method) => typeof authority?.[method] !== 'function')) deny();
                producer = createProducer({ authority });
                if (producerMethods.some((method) => typeof producer?.[method] !== 'function')) deny();
                return authority;
            }, producer: producerAdapter, authorizeCommand,
            readEvent: createCredentialedEvidenceReader({ projectId, getActor, fetchImpl: userFetch }),
            onEvidence: async (reference) => {
                const proof = await authority.verifyCommit(reference);
                if (!sameActor(proof, actor) || proof.proposalId !== proposalId || proof.teamId !== command.teamId || proof.eventId !== command.eventId
                    || proof.mode !== command.mode || proof.eventType !== command.eventType || proof.intentDigest !== fingerprint({ uid: actor.uid, ...expected })
                    || proof.previewDigest !== fingerprint(approval.preview) || proof.committed !== true || proof.consumed !== true) deny();
                verifiedProof = true;
            }
        });
        const executionEvidence = { ...bridge, beforeDispatch: async (attempt) => {
            const localGuard = await bridge.beforeDispatch(attempt);
            if (typeof localGuard !== 'function') deny();
            await check();
            return () => { localGuard(); dispatchReady(); if (now() >= expiresAt) deny(); };
        } };
        const commands = createDirectScheduleCommands({ uid: actor.uid, store, now, executionEvidence,
            getContext: async () => {
                await check();
                // A non-persisted projection of the channel's exact-team manager
                // authorization, never a new role or a grant to another team.
                return { uid: actor.uid, teams: new Map([[command.teamId, { roles: new Set(['admin']) }]]) };
            }
        });
        let approved = false;
        const result = await commands.confirm({ proposalId }, async (preview) => {
            if (approved || fingerprint(preview) !== fingerprint(approval.preview)) deny();
            approved = true; await check();
            const content = { approve: true, notifyTeam: true };
            const formEvidence = await bridge.captureForm({ actor, preview, issuedAt, expiresAt, content });
            let consumed = false;
            return { action: 'accept', content, formEvidence, consume: async () => {
                if (consumed) deny(); consumed = true; await check();
            } };
        });
        // Reconciled user receipts are not commit authority. Only the private
        // evidence callback following actual response/reread can set this flag.
        return { commitVerified: result.status === 'completed' && verifiedProof };
    };
}
