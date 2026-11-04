import { describe, expect, it } from 'vitest';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createDirectScheduleCommands } from '../../services/chatgpt-mcp/src/directSchedule.js';
import { createDirectRsvpCommands, rsvpCutoffAt } from '../../services/chatgpt-mcp/src/directRsvp.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { approvedContent } from '../../services/chatgpt-mcp/src/directConfirmation.js';
import { isAvailabilityLocked } from '../../js/availability-preferences.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';

const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const create = { proposalId, mode: 'create', teamId: 'team-1', eventId: `mcp_${proposalId}`, eventType: 'game', changes: { startDate: '2060-12-01T17:00:00-06:00', opponent: 'Synthetic Visitors' } };
const eventPath = 'teams/team-1/games/existing-event';
const newPath = `teams/team-1/games/${create.eventId}`;
const rsvpPath = `${eventPath}/rsvps/owner__existing`;
const rsvpInput = { proposalId, teamId: 'team-1', eventId: 'existing-event', playerId: 'existing', response: 'going' };
const accept = async () => ({ action: 'accept', content: { approve: true, notifyTeam: true } });
function fixture() {
    const f = rosterFixture();
    f.put('teams/team-1/players/existing', { name: 'Synthetic Player', active: true });
    f.put(eventPath, { type: 'game', opponent: 'Other', date: new Date('2060-12-01T17:00Z'), end: new Date('2060-12-01T18:00Z'), arrivalTime: new Date('2060-12-01T16:30Z'), location: 'Old Field', notes: 'Private retained note', scheduleNotifications: { enabled: false, sent: true }, custom: { retained: true } });
    return { ...f, schedule: createDirectScheduleCommands(f.dependencies), rsvp: createDirectRsvpCommands(f.dependencies) };
}

describe('separately approved ordinary schedule saves', () => {
    it.each(['game', 'practice'])('creates an app-compatible %s only after two explicit acknowledgments', async (eventType) => {
        const f = fixture();
        const changes = eventType === 'game' ? create.changes : { title: 'Synthetic Practice', startDate: '2060-12-01T17:00Z', endDate: '2060-12-01T18:00Z' };
        const preview = await f.schedule.prepare({ ...create, eventType, changes });
        expect(preview.preview.requiredAcknowledgements).toEqual(['notifyTeam']); expect(f.records.has(newPath)).toBe(false);
        const result = await f.schedule.confirm({ proposalId }, accept);
        expect(result).toMatchObject({ status: 'completed', notificationDelivery: 'unverified' });
        const data = f.records.get(newPath).data;
        expect(data).toMatchObject({ type: eventType, status: 'scheduled', createdBy: 'owner', notes: '', date: expect.any(Date), createdAt: expect.any(Date) });
        expect(data.source).toBeUndefined(); expect(data.sourceMetadata).toBeUndefined();
        if (eventType === 'game') expect(data).toMatchObject({ assignments: [], competitionType: 'league', countsTowardSeasonRecord: true, opponentTeamId: null });
        else expect(data).toMatchObject({ title: 'Synthetic Practice', scheduleNotifications: {}, opponent: null });
        await f.schedule.confirm({ proposalId }, async () => { throw new Error('Never resend'); });
    });
    it.each([{ approve: true }, { approve: true, notifyTeam: false }, { approve: true, notifyTeam: 'true' }, { approve: false, notifyTeam: true }])('does not save for incomplete acknowledgments %j', async (content) => {
        const f = fixture(); await f.schedule.prepare(create);
        expect(await f.schedule.confirm({ proposalId }, async () => ({ action: 'accept', content }))).toMatchObject({ applied: false });
        expect(f.records.has(newPath)).toBe(false);
    });
    it('preserves unselected data and shifts omitted end/arrival times when updating a start time', async () => {
        const f = fixture(); const before = structuredClone(f.records.get(eventPath).data);
        await f.schedule.prepare({ ...create, mode: 'update', eventId: 'existing-event', changes: { startDate: '2060-12-01T18:00Z', location: '' } });
        await f.schedule.confirm({ proposalId }, accept);
        expect(f.records.get(eventPath).data).toEqual({ ...before, date: new Date('2060-12-01T18:00Z'), end: new Date('2060-12-01T19:00Z'), arrivalTime: new Date('2060-12-01T17:30Z'), location: '', updatedAt: expect.any(Date), updatedBy: 'owner' });
    });
    it('rejects duplicate events and bounded-query overflow before staging', async () => {
        const f = fixture();
        await expect(f.schedule.prepare({ ...create, changes: { startDate: '2060-12-01T17:00Z', opponent: 'OTHER' } })).rejects.toMatchObject({ code: 'ambiguous_event' });
        f.store.list.mockResolvedValue(Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, data: {}, version: `v${i}` })));
        await expect(f.schedule.prepare(create)).rejects.toMatchObject({ code: 'unsupported_schedule' });
    });
    it.each([{ source: 'calendar' }, { sharedScheduleId: 'linked' }, { sharedScheduleSourceTeamId: 'source' }, { tournament: {} }, { competitionType: 'tournament' }, { diamondSourceGameId: 'proxy' }, { recurrence: {} }, { trackingEngine: 'diamond-v2' }, { liveStatus: 'live' }, { status: 'cancelled' }])('refuses specialized updates %#', async (fields) => {
        const f = fixture(); f.put(eventPath, { ...f.records.get(eventPath).data, ...fields });
        await expect(f.schedule.prepare({ ...create, mode: 'update', eventId: 'existing-event', changes: { location: 'New' } })).rejects.toMatchObject({ code: 'unsupported_event' });
    });
    it.each(['permission', 'team', 'schedule', 'expiry'])('rejects a changed %s during approval', async (kind) => {
        const f = fixture(); await f.schedule.prepare(create);
        await expect(f.schedule.confirm({ proposalId }, async () => {
            if (kind === 'permission') f.context.teams.clear();
            if (kind === 'team') f.put('teams/team-1', { name: 'Changed team' });
            if (kind === 'schedule') f.put('teams/team-1/games/concurrent', { type: 'game', date: new Date(), opponent: 'Other' });
            if (kind === 'expiry') f.expire();
            return accept();
        })).rejects.toThrow(); expect(f.records.has(newPath)).toBe(false);
    });
    it('reconciles a lost committed response without recreating an event or claiming notification delivery', async () => {
        const f = fixture(); await f.schedule.prepare(create); const transaction = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (...args) => { await transaction(...args); throw new Error('Lost response'); });
        expect(await f.schedule.confirm({ proposalId }, accept)).toMatchObject({ status: 'completed', notificationDelivery: 'unverified' });
        await f.schedule.confirm({ proposalId }, async () => { throw new Error('No replay'); }); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        await expect(f.schedule.prepare({ ...create, changes: { ...create.changes, opponent: 'Different' } })).rejects.toMatchObject({ code: 'conflict' });
    });
});

describe('bounded staff RSVP overrides', () => {
    it('creates and updates only the current manager’s player response without changing notes, base records or summaries', async () => {
        const f = fixture(); const before = structuredClone(f.records.get(eventPath));
        const notePath = `${eventPath}/rsvpNotes/owner__existing`; f.put(notePath, { note: 'Private note retained' });
        await f.rsvp.prepare(rsvpInput); await f.rsvp.confirm({ proposalId }, accept);
        expect(f.records.get(rsvpPath).data).toEqual({ userId: 'owner', displayName: null, playerIds: ['existing'], playerId: 'existing', childId: 'existing', response: 'going', respondedAt: expect.any(Date) });
        await f.rsvp.prepare({ ...rsvpInput, proposalId: second, response: 'not_going' }); await f.rsvp.confirm({ proposalId: second }, accept);
        expect(f.records.get(rsvpPath).data.response).toBe('not_going'); expect(f.records.get(notePath).data.note).toBe('Private note retained');
        expect(f.records.get(eventPath)).toEqual(before); expect(f.records.has(`${eventPath}/rsvps/owner`)).toBe(false);
    });
    it.each(['parent', 'missing-player', 'inactive', 'legacy-base', 'legacy-inline-note', 'wrong-player'])('rejects unsupported scope %s', async (kind) => {
        const f = fixture();
        if (kind === 'parent') f.context.teams.get('team-1').roles = new Set(['parent']);
        if (kind === 'missing-player') f.records.delete('teams/team-1/players/existing');
        if (kind === 'inactive') f.put('teams/team-1/players/existing', { name: 'Synthetic', active: false });
        if (kind === 'legacy-base') f.put(`${eventPath}/rsvps/owner`, { userId: 'owner', response: 'going' });
        if (kind.startsWith('legacy-inline') || kind === 'wrong-player') f.put(rsvpPath, { userId: 'owner', playerIds: ['existing'], playerId: 'existing', childId: 'existing', response: 'going', ...(kind === 'wrong-player' ? { playerId: 'different' } : { note: 'Private legacy note' }) });
        await expect(f.rsvp.prepare(rsvpInput)).rejects.toThrow(); expect(f.store.create).not.toHaveBeenCalled();
    });
    it.each(['approval', 'commit'])('enforces a cutoff reached at the %s boundary', async (boundary) => {
        const f = fixture(); f.put('teams/team-1', { name: 'Team', availabilityPreferences: { cutoffMinutesBeforeStart: 1 } });
        f.put(eventPath, { ...f.records.get(eventPath).data, date: new Date(f.dependencies.now() + 61000) });
        await f.rsvp.prepare(rsvpInput);
        await expect(f.rsvp.confirm({ proposalId }, async () => {
            if (boundary === 'approval') f.advance(1001);
            return { ...await accept(), consume: async () => { if (boundary === 'commit') f.advance(1001); } };
        })).rejects.toMatchObject({ code: 'availability_locked' }); expect(f.records.has(rsvpPath)).toBe(false);
    });
    it.each(['permission', 'event', 'player', 'response', 'base'])('rechecks %s after explicit approval', async (kind) => {
        const f = fixture(); await f.rsvp.prepare(rsvpInput);
        await expect(f.rsvp.confirm({ proposalId }, async () => {
            if (kind === 'permission') f.context.teams.clear();
            if (kind === 'event') f.put(eventPath, { ...f.records.get(eventPath).data, location: 'Changed' });
            if (kind === 'player') f.put('teams/team-1/players/existing', { name: 'Changed', active: true });
            if (kind === 'response') f.put(rsvpPath, { userId: 'owner', playerIds: ['existing'], playerId: 'existing', childId: 'existing', response: 'maybe' });
            if (kind === 'base') f.put(`${eventPath}/rsvps/owner`, { userId: 'owner', response: 'going' });
            return accept();
        })).rejects.toThrow(); expect(f.records.get(rsvpPath)?.data.response).not.toBe('going');
    });
    it('keeps cutoff calculations aligned with the app preference helper', () => {
        const start = new Date('2060-12-01T17:00Z');
        for (const preferences of [{}, { cutoffMinutes: 60 }, { availabilityPreferences: { cutoffMinutesBeforeStart: 60 } }, { cutoffMinutesBeforeStart: -1 }, { cutoffMinutesBeforeStart: 0.6 }, { cutoffMinutesBeforeStart: 20000 }, { cutoffMinutesBeforeStart: 'invalid' }]) {
            for (const delta of [-10081 * 60000, -61 * 60000, -60000, 0, 60000]) {
                const now = start.getTime() + delta; const cutoff = rsvpCutoffAt(start, preferences);
                expect(cutoff !== null && now >= cutoff).toBe(isAvailabilityLocked(start, preferences, new Date(now)));
            }
        }
    });
});

describe('distinct one-action confirmation contract', () => {
    it('keeps only explicit known acknowledgments and binds them to actor, preview, expiry and one commit', async () => {
        const preview = { requiredAcknowledgements: ['notifyTeam'], action: 'Synthetic save' };
        let actor = { uid: 'owner', clientId: 'client', grantKey: 'grant', expiresAt: Date.now() + 10000 };
        const authorize = createOneActionApproval({ getActor: async () => actor });
        const answer = { action: 'accept', content: { approve: true, notifyTeam: true, unrelated: true } };
        const approval = await authorize(preview, async () => answer);
        answer.content.notifyTeam = false;
        expect(approval.content).toEqual({ approve: true, notifyTeam: true });
        await approval.consume(); await expect(approval.consume()).rejects.toMatchObject({ code: 'confirmation_replayed' });
        const changed = await authorize(preview, accept); actor = { ...actor, grantKey: 'other' };
        await expect(changed.consume()).rejects.toMatchObject({ code: 'confirmation_expired' });
        expect(() => approvedContent({ requiredAcknowledgements: ['arbitraryCapability'] }, answer)).toThrow();
    });
    it('shows two unchecked SDK approval fields for schedule saves; requires only ordinary approval for RSVP', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, scheduleStore: f.store, rsvpStore: f.store });
        const client = new Client({ name: 'synthetic', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        let acknowledge = false; const requests = [];
        client.setRequestHandler(ElicitRequestSchema, async (request) => { requests.push(request.params); return { action: 'accept', content: { approve: true, notifyTeam: acknowledge } }; });
        const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
        try {
            expect((await client.listTools()).tools.find((tool) => tool.name === 'confirm_schedule_event').annotations.openWorldHint).toBe(true);
            const args = { proposalId, teamId: 'team-1', eventType: 'game', changes: create.changes };
            expect((await client.callTool({ name: 'prepare_create_schedule_event', arguments: { ...args, notifyTeam: true } })).isError).toBe(true);
            await client.callTool({ name: 'prepare_create_schedule_event', arguments: args });
            expect((await client.callTool({ name: 'confirm_schedule_event', arguments: { proposalId } })).structuredContent.applied).toBe(false);
            expect(requests[0].requestedSchema.properties.notifyTeam.default).toBe(false);
            expect(requests[0].requestedSchema.required).toEqual(['approve', 'notifyTeam']); acknowledge = true;
            expect((await client.callTool({ name: 'confirm_schedule_event', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            await client.callTool({ name: 'prepare_staff_rsvp_override', arguments: { ...rsvpInput, proposalId: second } });
            expect((await client.callTool({ name: 'confirm_staff_rsvp_override', arguments: { proposalId: second } })).structuredContent.status).toBe('completed');
            expect(requests.at(-1).requestedSchema.required).toEqual(['approve']);
        } finally { await client.close(); await server.close(); }
    });
});
