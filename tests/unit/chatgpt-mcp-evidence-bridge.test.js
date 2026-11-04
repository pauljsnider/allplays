import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createBrokerScheduleEvidenceBridge, canonicalEvidenceFields } from '../../services/chatgpt-mcp/src/directScheduleEvidence.js';
import { encodeValue } from '../../services/chatgpt-mcp/src/firestoreRest.js';
import { scheduleAfter, scheduleSummary } from '../../services/chatgpt-mcp/src/scheduleReview.js';
import { fingerprint } from '../../services/chatgpt-mcp/src/directRevisionCommand.js';
const require = createRequire(import.meta.url);
const { FakeFirestore } = require('../../functions/test/helpers/notification-journal-fixture.cjs');
const { createFirestoreNotificationJournalStore } = require('../../functions/notification-attempt-journal.cjs');
const { createScheduleEvidenceAuthority } = require('../../functions/schedule-delivery-evidence.cjs');

async function fixture({ mode = 'create', eventType = 'game' } = {}) {
    let clock = 100000; const evidence = []; let authority;
    const actor = { uid: 'owner', clientId: 'client', grantKey: fingerprint('synthetic-grant'), reviewRequests: true, expiresAt: 200000 };
    const changes = mode === 'create'
        ? { startDate: '2060-01-01T12:00:00.000Z', endDate: '2060-01-01T13:00:00.000Z', ...(eventType === 'game' ? { opponent: 'Approved Visitors' } : { title: 'Approved Practice' }) }
        : { startDate: '2060-01-01T14:00:00.000Z', ...(eventType === 'game' ? { opponent: 'Approved Visitors' } : { title: 'Approved Practice' }) };
    const old = { type: eventType, date: new Date('2060-01-01T12:00Z'), end: new Date('2060-01-01T13:00Z'), location: 'Field',
        ...(eventType === 'game' ? { opponent: 'Old Visitors', arrivalTime: new Date('2060-01-01T11:30Z'), isHome: true } : { title: 'Old Practice' }), notes: 'Keep private notes' };
    const before = mode === 'create' ? null : scheduleSummary('event-1', old);
    const after = scheduleAfter(before, eventType, changes);
    const preview = { action: `${mode === 'create' ? 'Create' : 'Update'} one scheduled ${eventType}`, teamId: 'team-1', eventId: 'event-1',
        before, requested: changes, after, requiredAcknowledgements: ['notifyTeam'] };
    const args = { mode, teamId: 'team-1', eventId: 'event-1', eventType, changes };
    const descriptor = { proposalId: '00112233-4455-4677-8899-aabbccddeeff', ...args, intentDigest: fingerprint({ uid: actor.uid, ...args }), previewDigest: fingerprint(preview), beforeVersion: mode === 'create' ? null : '1970-01-01T00:01:00.000Z' };
    const prefix = 'projects/demo-allplays-mcp-review/databases/(default)/documents/'; const path = 'teams/team-1/games/event-1';
    const common = { type: eventType, date: new Date(after.startDate), end: new Date(after.endDate), location: after.location, notes: '', status: 'scheduled',
        homeScore: 0, awayScore: 0, statTrackerConfigId: null, createdBy: actor.uid, createdAt: new Date(clock) };
    const create = eventType === 'game' ? { ...common, title: null, opponent: after.opponent, isHome: after.isHome, arrivalTime: null,
        assignments: [], competitionType: 'league', countsTowardSeasonRecord: true, opponentTeamId: null, opponentTeamName: null, opponentTeamPhoto: null }
        : { ...common, title: after.title, opponent: null, scheduleNotifications: {} };
    const patch = { date: new Date(after.startDate), end: new Date(after.endDate), ...(eventType === 'game' ? { opponent: after.opponent, arrivalTime: new Date(after.arrivalTime) } : { title: after.title }), updatedBy: actor.uid, updatedAt: new Date(clock) };
    const fields = encodeValue(mode === 'create' ? create : patch).mapValue.fields;
    const plan = { reads: { [path]: mode === 'create' ? { missing: prefix + path } : { found: { name: prefix + path, updateTime: descriptor.beforeVersion, fields: encodeValue(old).mapValue.fields } } }, writes: [
        { update: { name: prefix + path, fields }, ...(mode === 'update' ? { updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { exists: true } } : {}) },
        { update: { name: `${prefix}users/owner/privateAiPendingActions/direct_${descriptor.proposalId}`, fields: { digest: { stringValue: descriptor.intentDigest }, status: { stringValue: 'completed' }, receiptOnly: { booleanValue: true } } } },
        { delete: `${prefix}teams/team-1/privateAiPendingActions/direct_owner_${descriptor.proposalId}` }
    ] };
    const event = { version: '1970-01-01T00:01:40.001Z', data: canonicalEvidenceFields(mode === 'create' ? fields : { ...encodeValue(old).mapValue.fields, ...fields }) };
    const response = { commitTime: event.version, writeResults: [{ updateTime: event.version }, { updateTime: event.version }, {}] };
    const bridge = createBrokerScheduleEvidenceBridge({ projectId: 'demo-allplays-mcp-review', getActor: async () => actor, sessionId: 'session', now: () => clock,
        readEvent: async () => event, authorizeCommand: async () => true, onEvidence: (reference) => evidence.push(reference),
        createAuthority: (interfaces) => { authority = createScheduleEvidenceAuthority({ store: createFirestoreNotificationJournalStore(new FakeFirestore()), now: () => clock, ...interfaces }); return authority; } });
    const formEvidence = await bridge.captureForm({ actor, preview, issuedAt: 90000, expiresAt: 150000, content: { approve: true, notifyTeam: true } });
    return { bridge, actor, preview, descriptor, formEvidence, plan, event, response, evidence, authority, advance: () => { clock = 100001; } };
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
    it.each(['create', 'update'])('rejects an unapproved opponent in a %s write before issuing evidence', async (mode) => {
        const f = await fixture({ mode });
        f.plan.writes[0].update.fields.opponent = { stringValue: 'Unapproved Visitors' };
        f.event.data.opponent = { stringValue: 'Unapproved Visitors' };
        await expect(f.bridge.beforeCommit(f)).rejects.toMatchObject({ code: 'confirmation_unavailable' });
        expect(f.evidence).toHaveLength(0);
    });
    it.each([['create', 'game'], ['create', 'practice'], ['update', 'game'], ['update', 'practice']])('accepts the exact approved %s %s mutation', async (mode, eventType) => {
        const f = await fixture({ mode, eventType });
        const attempt = await f.bridge.beforeCommit(f); f.advance();
        await f.bridge.afterCommit(attempt, f); expect(f.evidence).toHaveLength(1);
    });
    it.each(['date', 'end', 'location', 'opponent', 'isHome', 'arrivalTime', 'notes', 'status', 'homeScore', 'awayScore',
        'statTrackerConfigId', 'createdBy', 'createdAt', 'assignments', 'competitionType', 'countsTowardSeasonRecord',
        'opponentTeamId', 'opponentTeamName', 'opponentTeamPhoto', 'title', 'unexpected'])('rejects changed create field %s even when the observed event agrees', async (key) => {
        const f = await fixture();
        f.plan.writes[0].update.fields[key] = { stringValue: 'Unapproved' };
        f.event.data = canonicalEvidenceFields(f.plan.writes[0].update.fields);
        await expect(f.bridge.beforeCommit(f)).rejects.toMatchObject({ code: 'confirmation_unavailable' });
        expect(f.evidence).toHaveLength(0);
    });
    it.each(['title', 'scheduleNotifications'])('rejects changed practice field %s', async (key) => {
        const f = await fixture({ eventType: 'practice' });
        f.plan.writes[0].update.fields[key] = encodeValue(key === 'title' ? 'Unapproved Practice' : { enabled: true });
        await expect(f.bridge.beforeCommit(f)).rejects.toMatchObject({ code: 'confirmation_unavailable' });
    });
    it.each(['date', 'end', 'arrivalTime', 'updatedBy', 'updatedAt', 'extra-field', 'missing-field', 'mask', 'before', 'after', 'intent', 'preview-copy'])('rejects an altered update %s', async (kind) => {
        const f = await fixture({ mode: 'update' }); const write = f.plan.writes[0];
        if (['date', 'end', 'arrivalTime'].includes(kind)) write.update.fields[kind] = { timestampValue: '2060-02-01T12:00:00.000Z' };
        if (kind === 'updatedBy') write.update.fields.updatedBy = { stringValue: 'other' };
        if (kind === 'updatedAt') write.update.fields.updatedAt = { timestampValue: '1970-01-01T00:01:40.001Z' };
        if (kind === 'extra-field') { write.update.fields.notes = { stringValue: 'Overwritten' }; write.updateMask.fieldPaths.push('notes'); }
        if (kind === 'missing-field') { delete write.update.fields.end; write.updateMask.fieldPaths = write.updateMask.fieldPaths.filter((key) => key !== 'end'); }
        if (kind === 'mask') write.updateMask.fieldPaths = ['opponent'];
        if (kind === 'before') f.plan.reads['teams/team-1/games/event-1'].found.fields.location = { stringValue: 'Changed' };
        if (kind === 'after') { f.preview.after.opponent = 'Unapproved'; f.descriptor.previewDigest = fingerprint(f.preview); }
        if (kind === 'intent') { f.descriptor.intentDigest = fingerprint('forged intent'); f.plan.writes[1].update.fields.digest.stringValue = f.descriptor.intentDigest; }
        if (kind === 'preview-copy') { f.preview.requested.opponent = 'Unapproved'; f.preview.after.opponent = 'Unapproved'; write.update.fields.opponent = { stringValue: 'Unapproved' }; }
        await expect(f.bridge.beforeCommit(f)).rejects.toMatchObject({ code: 'confirmation_unavailable' });
        expect(f.evidence).toHaveLength(0);
    });
    it('normalizes equivalent wire timestamps/nulls/empty containers without dropping nanoseconds or references', () => {
        const referenceValue = 'projects/demo-allplays-mcp-review/databases/(default)/documents/teams/team-1';
        expect(canonicalEvidenceFields({ time: { timestampValue: '2060-01-01T00:00:00Z' }, empty: { arrayValue: {} }, absent: { nullValue: 'NULL_VALUE' } }))
            .toEqual(canonicalEvidenceFields({ time: { timestampValue: '2060-01-01T00:00:00.000Z' }, empty: { arrayValue: { values: [] } }, absent: { nullValue: null } }));
        expect(canonicalEvidenceFields({ precise: { timestampValue: '2060-01-01T00:00:00.123456789Z' }, reference: { referenceValue } }))
            .toEqual({ precise: { timestampValue: '2060-01-01T00:00:00.123456789Z' }, reference: { referenceValue } });
    });
});
