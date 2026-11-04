import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createBrokerScheduleEvidenceBridge, canonicalEvidenceFields } from '../../services/chatgpt-mcp/src/directScheduleEvidence.js';
import { fingerprint } from '../../services/chatgpt-mcp/src/directRevisionCommand.js';
const require = createRequire(import.meta.url);
const { FakeFirestore } = require('../../functions/test/helpers/notification-journal-fixture.cjs');
const { createFirestoreNotificationJournalStore } = require('../../functions/notification-attempt-journal.cjs');
const { createScheduleEvidenceAuthority } = require('../../functions/schedule-delivery-evidence.cjs');

async function fixture() {
    let clock = 100000; const evidence = []; let authority;
    const actor = { uid: 'owner', clientId: 'client', grantKey: fingerprint('synthetic-grant'), reviewRequests: true, expiresAt: 200000 };
    const preview = { action: 'Create one game', requiredAcknowledgements: ['notifyTeam'] };
    const descriptor = { proposalId: '00112233-4455-4677-8899-aabbccddeeff', teamId: 'team-1', eventId: 'event-1', mode: 'create', eventType: 'game', intentDigest: fingerprint('intent'), previewDigest: fingerprint(preview), beforeVersion: null };
    const prefix = 'projects/demo-allplays-mcp-review/databases/(default)/documents/'; const path = 'teams/team-1/games/event-1';
    const fields = { type: { stringValue: 'game' }, date: { timestampValue: '2060-01-01T12:00:00.000Z' }, title: { nullValue: null }, blocks: { arrayValue: { values: [] } } };
    const plan = { reads: { [path]: { missing: prefix + path } }, writes: [
        { update: { name: prefix + path, fields } },
        { update: { name: `${prefix}users/owner/privateAiPendingActions/direct_${descriptor.proposalId}`, fields: { digest: { stringValue: descriptor.intentDigest }, status: { stringValue: 'completed' }, receiptOnly: { booleanValue: true } } } },
        { delete: `${prefix}teams/team-1/privateAiPendingActions/direct_owner_${descriptor.proposalId}` }
    ] };
    const event = { version: '1970-01-01T00:01:40.001Z', data: canonicalEvidenceFields(fields) };
    const response = { commitTime: event.version, writeResults: [{ updateTime: event.version }, { updateTime: event.version }, {}] };
    const bridge = createBrokerScheduleEvidenceBridge({ projectId: 'demo-allplays-mcp-review', getActor: async () => actor, sessionId: 'session', now: () => clock,
        readEvent: async () => event, authorizeCommand: async () => true, onEvidence: (reference) => evidence.push(reference),
        createAuthority: (interfaces) => { authority = createScheduleEvidenceAuthority({ store: createFirestoreNotificationJournalStore(new FakeFirestore()), now: () => clock, ...interfaces }); return authority; } });
    const formEvidence = await bridge.captureForm({ actor, preview, issuedAt: 90000, expiresAt: 150000, content: { approve: true, notifyTeam: true } });
    return { bridge, actor, descriptor, formEvidence, plan, event, response, evidence, authority, advance: () => { clock = 100001; } };
}

describe('opaque local broker-to-command evidence bridge', () => {
    it('records independently observed exact writes and rejects replay of the same form or commit handle', async () => {
        const f = await fixture(); const attempt = await f.bridge.beforeCommit(f); f.advance();
        await f.bridge.afterCommit(attempt, f); expect(f.evidence).toHaveLength(1);
        expect((await f.authority.verifyCommit(f.evidence[0])).eventDigest).toBe(fingerprint(f.event.data));
        await expect(f.bridge.beforeCommit(f)).rejects.toThrow(); await expect(f.bridge.afterCommit(attempt, f)).rejects.toThrow();
    });
    it.each(['form', 'preview', 'actor', 'scope', 'project', 'extra-write', 'receipt'])('rejects spoofed %s before issuing a dispatch capability', async (kind) => {
        const f = await fixture();
        if (kind === 'form') f.formEvidence = {};
        if (kind === 'preview') f.descriptor.previewDigest = fingerprint('different');
        if (kind === 'actor') f.actor.clientId = 'other';
        if (kind === 'scope') f.actor.reviewRequests = false;
        if (kind === 'project') f.plan.writes[0].update.name = f.plan.writes[0].update.name.replace('demo-allplays-mcp-review', 'another-project');
        if (kind === 'extra-write') f.plan.writes.push(f.plan.writes[0]);
        if (kind === 'receipt') f.plan.writes[1].update.fields.digest.stringValue = fingerprint('other');
        await expect(f.bridge.beforeCommit(f)).rejects.toMatchObject({ code: 'confirmation_unavailable' }); expect(f.evidence).toHaveLength(0);
    });
    it.each(['plan', 'version', 'data', 'handle'])('does not manufacture commit authority from a changed %s', async (kind) => {
        const f = await fixture(); const attempt = await f.bridge.beforeCommit(f); f.advance();
        if (kind === 'plan') f.plan.writes[0].update.fields.location = { stringValue: 'Changed' };
        if (kind === 'version') f.event.version = '1970-01-01T00:01:41Z';
        if (kind === 'data') f.event.data.location = { stringValue: 'Changed' };
        await expect(f.bridge.afterCommit(kind === 'handle' ? {} : attempt, f)).rejects.toThrow(); expect(f.evidence).toHaveLength(0);
    });
    it('normalizes equivalent wire timestamps/nulls/empty containers without dropping nanoseconds or references', () => {
        const referenceValue = 'projects/demo-allplays-mcp-review/databases/(default)/documents/teams/team-1';
        expect(canonicalEvidenceFields({ time: { timestampValue: '2060-01-01T00:00:00Z' }, empty: { arrayValue: {} }, absent: { nullValue: 'NULL_VALUE' } }))
            .toEqual(canonicalEvidenceFields({ time: { timestampValue: '2060-01-01T00:00:00.000Z' }, empty: { arrayValue: { values: [] } }, absent: { nullValue: null } }));
        expect(canonicalEvidenceFields({ precise: { timestampValue: '2060-01-01T00:00:00.123456789Z' }, reference: { referenceValue } }))
            .toEqual({ precise: { timestampValue: '2060-01-01T00:00:00.123456789Z' }, reference: { referenceValue } });
    });
});
