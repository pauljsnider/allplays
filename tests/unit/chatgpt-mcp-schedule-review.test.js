import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { describe, expect, it, vi } from 'vitest';
import { createScheduleReviewCommands, normalizeScheduleInstant } from '../../services/chatgpt-mcp/src/scheduleReview.js';
import { createDirectDiscovery } from '../../services/chatgpt-mcp/src/directDiscovery.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';

const requestId = '00112233-4455-4677-8899-aabbccddeeff';
const input = { requestId, mode: 'create', teamId: 'team-1', eventType: 'practice', changes: { title: 'Synthetic Practice', startDate: '2026-12-01T17:00:00-06:00', endDate: '2026-12-01T18:00:00-06:00' } };
const eventPath = 'teams/team-1/games/event-1';
const requestPath = `teams/team-1/privateAiPendingActions/mcp_${requestId}`;
function fixture() {
    const event = { type: 'game', opponent: 'Synthetic Visitors', date: new Date('2026-12-01T17:00Z'), end: new Date('2026-12-01T18:00Z'), arrivalTime: new Date('2026-12-01T16:30Z'), location: 'Synthetic Field', notes: 'Excluded', statTrackerConfigId: 'preserved-config' };
    const records = new Map([[eventPath, event]]);
    const context = { uid: 'owner', teams: new Map([['team-1', { roles: new Set(['owner']) }]]) };
    const query = { select: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), startAfterDocumentId: vi.fn().mockReturnThis(), get: vi.fn(async () => ({ docs: [{ id: 'event-1', data: () => event }] })) };
    const db = { collection: () => query, doc: (path) => ({ get: vi.fn(async () => ({ exists: records.has(path), data: () => records.get(path) })) }),
        createReviewRequest: vi.fn(async (docs) => { if (docs.some(({ path }) => records.has(path))) throw new Error('Exists'); docs.forEach(({ path, data }) => records.set(path, data)); }) };
    let clock = Date.now();
    const dependencies = { uid: 'owner', getContext: async () => context, getDb: async () => db, now: () => clock };
    return { event, records, db, query, context, dependencies, commands: createScheduleReviewCommands(dependencies), expire: () => { clock += 31 * 60000; } };
}

describe('ordinary schedule review bridge', () => {
    it('normalizes explicit offsets and stages only app review with a notification disclosure', async () => {
        const f = fixture(); const before = structuredClone(f.event);
        const result = await f.commands.prepare(input);
        expect(result).toMatchObject({ status: 'requested', requiresAppConfirmation: true, mayNotifyTeam: true, previewIsAdvisory: true,
            preview: { requested: { startDate: '2026-12-01T23:00:00.000Z', endDate: '2026-12-02T00:00:00.000Z' } } });
        expect(f.records.get(eventPath)).toEqual(before); expect(f.records.size).toBe(3);
        expect(f.records.get(requestPath).args).toEqual({ teamId: 'team-1', eventType: 'practice', input: result.preview.requested });
        expect(JSON.stringify(f.records.get(`users/owner/privateAiPendingActions/mcp_${requestId}`))).not.toContain('Synthetic Practice');
    });
    it('sends only requested update fields so the app merges current data; estimates shifted times without private fields', async () => {
        const f = fixture();
        const result = await f.commands.prepare({ ...input, mode: 'update', eventId: 'event-1', eventType: 'game', changes: { startDate: '2026-12-01T18:00:00Z' } });
        expect(result.preview.estimatedAfter).toMatchObject({ startDate: '2026-12-01T18:00:00.000Z', endDate: '2026-12-01T19:00:00.000Z', arrivalTime: '2026-12-01T17:30:00.000Z', opponent: f.event.opponent });
        expect(f.records.get(requestPath).args.input).toEqual({ startDate: '2026-12-01T18:00:00.000Z' });
        expect(JSON.stringify(result)).not.toContain('Excluded'); expect(JSON.stringify(result)).not.toContain('preserved-config');
    });
    it.each(['2026-12-01', '2026-12-01T17:00', '2026-02-30T17:00Z', '2026-12-01T24:00Z', '2026-12-01T17:60Z', '2026-12-01T17:00:60Z', '2026-12-01T17:00-00:00', '2026-12-01T17:00+14:30', '2026-12-01T17:00+01:60'])('rejects ambiguous/invalid time %s', (value) => {
        expect(() => normalizeScheduleInstant(value)).toThrow();
    });
    it.each([
        { eventType: 'game' }, { changes: { startDate: '2026-12-01T17:00Z' } },
        { changes: { ...input.changes, endDate: '2026-12-01T16:00Z' } },
        { changes: { ...input.changes, scheduleNotifications: { enabled: false } } },
        { changes: { ...input.changes, recurrence: { frequency: 'weekly' } } },
        { changes: { ...input.changes, arrivalTime: '2026-12-01T16:30Z' } },
        { changes: { ...input.changes, source: 'suppress-announcement' } }
    ])('rejects incomplete or out-of-scope changes %#', async (overrides) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, ...overrides })).rejects.toMatchObject({ code: 'invalid_argument' });
        expect(f.db.createReviewRequest).not.toHaveBeenCalled();
    });
    it.each([{ recurrence: {} }, { sharedScheduleId: 'shared' }, { opponentTeamId: 'other' }, { source: 'calendar' }, { trackingEngine: 'diamond-v2' }, { status: 'completed' }, { liveStatus: 'live' }, { cancelled: true }])('leaves specialized event updates to app %#', async (fields) => {
        const f = fixture(); Object.assign(f.event, fields);
        await expect(f.commands.prepare({ ...input, mode: 'update', eventId: 'event-1', eventType: 'game', changes: { location: 'Other' } })).rejects.toMatchObject({ code: 'unsupported_event' });
        expect(f.db.createReviewRequest).not.toHaveBeenCalled();
    });
    it.each(['parent', 'revoked', 'identity'])('rejects %s context before staging or status reads', async (kind) => {
        const f = fixture(); await f.commands.prepare(input);
        if (kind === 'parent') f.context.teams.get('team-1').roles = new Set(['parent']);
        if (kind === 'revoked') f.context.teams.clear();
        if (kind === 'identity') f.context.uid = 'other';
        await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'permission_denied' });
        await expect(f.commands.status({ requestId })).rejects.toMatchObject({ code: 'permission_denied' });
        expect(f.db.createReviewRequest).toHaveBeenCalledTimes(1);
    });
    it('is idempotent for equivalent offsets and rejects changed request reuse; status expires', async () => {
        const f = fixture(); await f.commands.prepare(input);
        await f.commands.prepare({ ...input, changes: { ...input.changes, startDate: '2026-12-01T23:00Z', endDate: '2026-12-02T00:00Z' } });
        expect(f.db.createReviewRequest).toHaveBeenCalledTimes(1);
        await expect(f.commands.prepare({ ...input, changes: { ...input.changes, title: 'Different' } })).rejects.toMatchObject({ code: 'conflict' });
        f.expire(); expect((await f.commands.status({ requestId })).status).toBe('expired');
    });
    it('reconciles a lost staging response and never claims an unverified request or business write succeeded', async () => {
        const f = fixture(); const create = f.db.createReviewRequest.getMockImplementation();
        f.db.createReviewRequest.mockImplementation(async (docs) => { await create(docs); throw new Error('Lost response'); });
        expect((await f.commands.prepare(input)).status).toBe('requested');
        const failed = fixture(); failed.db.createReviewRequest.mockRejectedValue(new Error('Denied'));
        await expect(failed.commands.prepare(input)).rejects.toMatchObject({ code: 'unavailable' });
        expect(failed.records.size).toBe(1);
    });
    it('pages exact event IDs without exposing notes and rechecks access on each page', async () => {
        const f = fixture(); const discovery = createDirectDiscovery(f.dependencies);
        f.query.get.mockResolvedValue({ docs: [{ id: 'a', data: () => f.event }, { id: 'b', data: () => f.event }] });
        const page = await discovery.schedule({ teamId: 'team-1', limit: 1 });
        expect(page).toMatchObject({ hasMore: true, nextCursor: 'a', items: [{ id: 'a', supportsOrdinaryAppReview: true }] });
        expect(JSON.stringify(page)).not.toContain('Excluded');
        await discovery.schedule({ teamId: 'team-1', cursor: 'a' }); expect(f.query.startAfterDocumentId).toHaveBeenCalledWith('a');
        f.context.teams.clear(); await expect(discovery.schedule({ teamId: 'team-1', cursor: 'a' })).rejects.toMatchObject({ code: 'permission_denied' });
    });
    it('exposes discovery and app review through the SDK without a direct schedule confirm tool', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'synthetic', version: '1' }, { capabilities: {} });
        const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
        try {
            const names = (await client.listTools()).tools.map((tool) => tool.name);
            expect(names).not.toContain('confirm_schedule_event');
            expect((await client.callTool({ name: 'list_team_schedule_events', arguments: { teamId: 'team-1' } })).structuredContent.items[0].id).toBe('event-1');
            expect((await client.callTool({ name: 'prepare_schedule_event_review', arguments: { ...input, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_schedule_event_review', arguments: input })).structuredContent.requiresAppConfirmation).toBe(true);
            expect((await client.callTool({ name: 'get_schedule_event_review', arguments: { requestId } })).structuredContent.status).toBe('requested');
        } finally { await client.close(); await server.close(); }
    });
});
