import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createSignedScheduleBroker } from '../../services/chatgpt-mcp/src/signedScheduleBroker.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { fingerprint } from '../../services/chatgpt-mcp/src/directRevisionCommand.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const otherId = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId, mode: 'create', teamId: 'team-1', eventId: `mcp_${proposalId}`, eventType: 'game', changes: { startDate: '2060-12-01T17:00Z', opponent: 'Synthetic Visitors' } };
const accept = async () => ({ action: 'accept', content: { approve: true, notifyTeam: true } });
function fixture(options = {}) {
    const f = rosterFixture(); const now = f.dependencies.now;
    const actor = { uid: 'owner', clientId: 'client', grantKey: 'a'.repeat(64), expiresAt: now() + 600000, idToken: 'synthetic-user-token', reviewRequests: true };
    const keys = generateKeyPairSync('ed25519'); const payloads = [];
    const sendEnvelope = vi.fn(async (envelope) => {
        expect(verify(null, Buffer.from(`${envelope.keyId}.${envelope.payload}`), keys.publicKey, Buffer.from(envelope.signature, 'base64url'))).toBe(true);
        const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString()); payloads.push(payload);
        return { operationId: fingerprint({ kind: 'broker-command-v1', uid: 'owner', teamId: 'team-1', proposalId: payload.command.proposalId }), status: 'committed' };
    });
    const broker = createSignedScheduleBroker({ dependencies: { ...f.dependencies, scheduleStore: f.store }, getActor: async () => actor, sessionId: 'session', keyId: 'test-key', privateKey: keys.privateKey, audience: 'isolated', sendEnvelope, now, ...options });
    const authorize = createOneActionApproval({ getActor: async () => actor, now, captureForm: broker.captureForm });
    const approve = (preview) => authorize(preview, accept);
    return { ...f, broker, actor, payloads, sendEnvelope, authorize, approve };
}
describe('opaque form-bound schedule signing', () => {
    it('signs the exact approved normalized command and only queries status on repeats', async () => {
        const f = fixture(); const prepared = await f.broker.commands.prepare(input);
        const result = await f.broker.commands.confirm({ proposalId }, f.approve);
        expect(result).toMatchObject({ status: 'completed', notificationDelivery: 'unverified' });
        expect(f.payloads[0]).toMatchObject({ audience: 'isolated', purpose: 'schedule.execute', actor: { uid: 'owner', sessionId: 'session' }, approval: { preview: prepared.preview, approve: true, notifyTeam: true }, command: { ...input, changes: prepared.preview.requested } });
        expect(f.store.transaction).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain(f.actor.idToken);
        await f.broker.commands.confirm({ proposalId }, () => { throw new Error('No second form'); });
        expect(f.payloads.map((row) => row.purpose)).toEqual(['schedule.execute', 'schedule.status']);
    });
    it.each(['missing', 'serialized', 'foreign'])('rejects %s form evidence even when conversational approval is asserted', async (kind) => {
        const f = fixture(); const prepared = await f.broker.commands.prepare(input); const valid = await f.approve(prepared.preview);
        const formEvidence = kind === 'missing' ? undefined : kind === 'serialized' ? JSON.parse(JSON.stringify(valid.formEvidence)) : (await fixture().approve(prepared.preview)).formEvidence;
        await expect(f.broker.commands.confirm({ proposalId }, async () => ({ ...valid, formEvidence }))).rejects.toThrow();
        expect(f.sendEnvelope).not.toHaveBeenCalled(); expect(f.store.transaction).not.toHaveBeenCalled();
    });
    it.each(['clientId', 'grantKey', 'uid', 'reviewRequests', 'expiry', 'disconnect'])('denies changed %s after form acceptance', async (field) => {
        const f = fixture(); await f.broker.commands.prepare(input);
        await expect(f.broker.commands.confirm({ proposalId }, async (preview) => {
            const answer = await f.approve(preview);
            if (field === 'expiry') f.advance(120001);
            else if (field === 'disconnect') f.broker.close();
            else f.actor[field] = field === 'reviewRequests' ? false : 'other';
            return answer;
        })).rejects.toThrow(); expect(f.sendEnvelope).not.toHaveBeenCalled();
    });
    it('rejects modified proposal content after approval before signing', async () => {
        const f = fixture(); await f.broker.commands.prepare(input);
        await expect(f.broker.commands.confirm({ proposalId }, async (preview) => {
            const answer = await f.approve(preview); const path = `users/owner/privateAiPendingActions/direct_${proposalId}`;
            const data = structuredClone(f.records.get(path).data); data.changes.opponent = 'Unapproved'; f.put(path, data); return answer;
        })).rejects.toThrow(); expect(f.sendEnvelope).not.toHaveBeenCalled();
    });
    it('uses fresh bounded status authorization after approval expiry without another execution', async () => {
        const f = fixture(); await f.broker.commands.prepare(input); await f.broker.commands.confirm({ proposalId }, f.approve);
        f.advance(120001); await f.broker.commands.status({ proposalId });
        expect(f.payloads[1].purpose).toBe('schedule.status'); expect(f.payloads[1].issuedAt).toBeGreaterThan(f.payloads[0].expiresAt);
        expect(f.payloads[1].approval).toEqual(f.payloads[0].approval);
    });
    it('retains status-only context even when sending never returns a trustworthy response', async () => {
        const f = fixture(); await f.broker.commands.prepare(input); f.sendEnvelope.mockRejectedValueOnce(new Error('Lost response'));
        await expect(f.broker.commands.confirm({ proposalId }, f.approve)).rejects.toThrow();
        await f.broker.commands.confirm({ proposalId }, () => { throw new Error('No new approval'); });
        expect(f.sendEnvelope).toHaveBeenCalledTimes(2); expect(f.payloads[0].purpose).toBe('schedule.status');
    });
    it('does not promote a user-writable completed receipt into backend commit proof', async () => {
        const f = fixture(); await f.broker.commands.prepare(input); const path = `users/owner/privateAiPendingActions/direct_${proposalId}`;
        f.put(path, { ...f.records.get(path).data, status: 'completed' });
        f.sendEnvelope.mockResolvedValueOnce({ operationId: fingerprint({ kind: 'broker-command-v1', uid: 'owner', teamId: 'team-1', proposalId }), status: 'unverified' });
        expect(await f.broker.commands.status({ proposalId })).toMatchObject({ status: 'unverified' });
        const payload = JSON.parse(Buffer.from(f.sendEnvelope.mock.calls[0][0].payload, 'base64url').toString());
        expect(payload.purpose).toBe('schedule.recover'); expect(payload.command).toEqual({ teamId: 'team-1', proposalId }); expect(payload).not.toHaveProperty('approval');
    });
    it('bounds retained submissions and clears capability use on close', async () => {
        const f = fixture({ maxSubmissions: 1 }); await f.broker.commands.prepare(input); await f.broker.commands.confirm({ proposalId }, f.approve);
        await f.broker.commands.prepare({ ...input, proposalId: otherId, eventId: `mcp_${otherId}` });
        await expect(f.broker.commands.confirm({ proposalId: otherId }, f.approve)).rejects.toThrow(); expect(f.sendEnvelope).toHaveBeenCalledTimes(1);
        f.broker.close();
        for (const invoke of [() => f.broker.commands.status({ proposalId }), () => f.broker.commands.prepare(input), () => f.broker.commands.confirm({ proposalId }, f.approve)]) await expect(invoke()).rejects.toThrow();
    });
    it('never evicts a pending submission to make room for a duplicate execution', async () => {
        const f = fixture(); await f.broker.commands.prepare(input);
        const result = await Promise.allSettled([f.broker.commands.confirm({ proposalId }, f.approve), f.broker.commands.confirm({ proposalId }, f.approve)]);
        expect(result.some((row) => row.status === 'fulfilled')).toBe(true);
        expect(f.payloads.filter((row) => row.purpose === 'schedule.execute')).toHaveLength(1);
    });
});
