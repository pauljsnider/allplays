import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { createDirectAssignmentBatchCommands, createDirectAssignmentBatchStore } from '../../services/chatgpt-mcp/src/directAssignmentBatch.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const eventPath = 'teams/team-1/games/event';
const claimPath = (role) => `${eventPath}/assignmentClaims/${role}`;
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const open = (role) => ({ role, value: '', claimable: true });
const fixed = (role, value = 'Synthetic Staff') => ({ role, value, claimable: false });
const operation = (action, role, assignment = open(role)) => ({ action, role, assignment });
const input = { proposalId, teamId: 'team-1', eventId: 'event', operations: [operation('update', 'Snack', fixed('Snacks')), operation('create', 'Water')] };
const claim = { claimedByUserId: 'parent', claimedByName: 'Synthetic Parent', claimedAt: new Date('2020-01-01') };
const accept = async () => ({ action: 'accept', content: { approve: true, assignmentChanges: true }, consume: async () => {} });
function fixture() {
    const f = rosterFixture(); f.put(eventPath, { type: 'game', date: new Date('2060-01-01'), assignments: [open('Snack'), fixed('Equipment')], notes: 'Preserve private note', location: 'Field' });
    return { ...f, commands: createDirectAssignmentBatchCommands(f.dependencies) };
}
describe('atomic manager assignment batch', () => {
    it('creates and updates together, clearing only displayed source/destination claims', async () => {
        const f = fixture(); for (const role of ['Snack', 'Snacks', 'Water', 'Equipment']) f.put(claimPath(role), claim);
        const prepared = await f.commands.prepare(input); expect(prepared.preview.removedClaims.map((r) => r.role)).toEqual(['Snack', 'Snacks', 'Water']);
        expect(prepared.preview.requiredAcknowledgements).toEqual(['assignmentChanges']); expect(prepared.preview.effect).toMatch(/not notified/);
        await f.commands.confirm({ proposalId }, accept);
        expect(f.records.get(eventPath).data).toEqual({ type: 'game', date: new Date('2060-01-01'), assignments: [fixed('Snacks'), fixed('Equipment'), open('Water')], notes: 'Preserve private note', location: 'Field' });
        for (const role of ['Snack', 'Snacks', 'Water']) expect(f.records.has(claimPath(role))).toBe(false);
        expect(f.records.get(claimPath('Equipment')).data).toEqual(claim); expect(f.store.transaction).toHaveBeenCalledTimes(1);
    });
    it('reopens a fixed slot without claims and preserves every untouched open claim', async () => {
        const f = fixture(); f.put(claimPath('Snack'), claim);
        await f.commands.prepare({ ...input, operations: [operation('update', 'Equipment')] }); await f.commands.confirm({ proposalId }, accept);
        expect(f.records.get(eventPath).data.assignments).toEqual([open('Snack'), open('Equipment')]); expect(f.records.get(claimPath('Snack')).data).toEqual(claim);
    });
    it('rejects reopening a fixed slot with a stale claim instead of reviving it', async () => {
        const f = fixture(); f.put(claimPath('Equipment'), claim);
        await expect(f.commands.prepare({ ...input, operations: [operation('update', 'Equipment')] })).rejects.toThrow(/stale claim/);
        expect(f.records.get(claimPath('Equipment')).data).toEqual(claim); expect(f.store.create).not.toHaveBeenCalled();
    });
    it('accepts twenty explicit creates and caps the resulting list at fifty', async () => {
        const f = fixture(); const operations = Array.from({ length: 20 }, (_, i) => operation('create', `New${i}`));
        f.put(eventPath, { ...f.records.get(eventPath).data, assignments: Array.from({ length: 30 }, (_, i) => open(`Old${i}`)) });
        await f.commands.prepare({ ...input, operations }); await f.commands.confirm({ proposalId }, accept); expect(f.records.get(eventPath).data.assignments).toHaveLength(50);
        await expect(f.commands.prepare({ ...input, proposalId: '00112233-4455-4677-8899-aabbccddeeaa', operations: [operation('create', 'Overflow')] })).rejects.toThrow(/50/);
    });
    it.each([
        [], Array.from({ length: 21 }, (_, i) => operation('create', `New${i}`)),
        [operation('create', 'Water'), operation('create', 'water')],
        [operation('update', 'Snack', open('Equipment')), operation('update', 'Equipment', open('Snack'))],
        [operation('create', 'Water'), operation('update', 'Water', open('Other'))],
        [{ action: 'remove', role: 'Snack', assignment: open('Snack') }],
        [{ ...operation('create', 'Water'), hidden: true }],
        [operation('create', 'Water', { ...open('Water'), claimedByUserId: 'parent' })],
        [operation('create', 'Other', open('Water'))], [operation('create', '../Water')],
        [operation('update', 'Snack', { role: 'Snack', value: 'Filled', claimable: true })],
        [operation('update', 'missing')], [operation('update', 'Snack', fixed('Equipment'))],
        [operation('create', 'snack')], [operation('update', 'Snack', { claimable: true, value: '', role: 'Snack' })]
    ])('rejects malformed, overlapping, unsupported or unchanged operations %# before persisting', async (operations) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, operations })).rejects.toThrow(); expect(f.store.create).not.toHaveBeenCalled(); expect(f.store.transaction).not.toHaveBeenCalled();
    });
    it.each([{ status: 'cancelled' }, { seriesId: 'series' }, { source: 'import' }, { trackingEngine: 'diamond-v2' }, { assignments: [{ ...open('Snack'), notes: 'Preserve' }] }, { assignments: [open('Snack'), open('snack')] }])('rejects unsupported event or extended slots %#', async (change) => {
        const f = fixture(); f.put(eventPath, { ...f.records.get(eventPath).data, ...change }); await expect(f.commands.prepare(input)).rejects.toThrow();
    });
    it.each([{ extra: true }, { claimedAt: null }, { claimedByUserId: '../uid' }])('does not discard extended or malformed affected claims %#', async (change) => {
        const f = fixture(); f.put(claimPath('Snacks'), { ...claim, ...change }); await expect(f.commands.prepare(input)).rejects.toThrow(); expect(f.records.get(claimPath('Snacks')).data).toEqual({ ...claim, ...change });
    });
    it.each(['event', 'claim', 'destination', 'team', 'permission', 'expiry', 'preview'])('fails atomically for stale %s', async (kind) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (kind === 'event') f.put(eventPath, { ...f.records.get(eventPath).data, location: 'Later edit' });
            if (kind === 'claim' || kind === 'destination') f.put(claimPath(kind === 'claim' ? 'Snack' : 'Water'), claim);
            if (kind === 'team') f.put('teams/team-1', { name: 'Changed' });
            if (kind === 'permission') f.context.teams.clear(); if (kind === 'expiry') f.expire();
            if (kind === 'preview') f.put(header, { ...f.records.get(header).data, preview: { altered: true } });
            return accept();
        })).rejects.toThrow(); expect(f.records.get(eventPath).data.assignments).toEqual([open('Snack'), fixed('Equipment')]);
    });
    it.each(['expired', 'disconnected', 'revoked'])('uses the actual one-action authority to stop %s before dispatch', async (kind) => {
        const f = fixture(); const abort = new AbortController(); let current = true;
        const authority = createOneActionApproval({ getActor: async () => { if (!current) throw new Error('Revoked'); return { uid: 'owner', clientId: 'synthetic', grantKey: 'synthetic', expiresAt: f.dependencies.now() + 1000000 }; }, now: f.dependencies.now });
        await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => { const guard = await settings.beforeDispatch(); if (kind === 'expired') f.advance(120001); if (kind === 'disconnected') abort.abort(); return guard; } }));
        await expect(f.commands.confirm({ proposalId }, (preview) => authority(preview, async () => { if (kind === 'revoked') current = false; return accept(); }, abort.signal))).rejects.toThrow();
        expect(f.records.get(eventPath).data.assignments).toEqual([open('Snack'), fixed('Equipment')]);
    });
    it('requires literal distinct acknowledgement, handles declines and rejects absent authority', async () => {
        const f = fixture(); await f.commands.prepare(input);
        for (const action of ['decline', 'cancel']) expect(await f.commands.confirm({ proposalId }, async () => ({ action }))).toMatchObject({ applied: false });
        for (const assignmentChanges of [undefined, false, 'true']) expect(await f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true, assignmentChanges }, consume: async () => {} }))).toMatchObject({ applied: false });
        await expect(f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true, assignmentChanges: true } }))).rejects.toThrow(); expect(f.store.transaction).not.toHaveBeenCalled();
    });
    it('reconciles lost response without repeated writes and rejects reuse for changed operations', async () => {
        const f = fixture(); await f.commands.prepare(input); await expect(f.commands.prepare({ ...input, operations: [operation('create', 'Other')] })).rejects.toThrow();
        const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); });
        expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.context.teams.clear(); await expect(f.commands.status({ proposalId })).rejects.toThrow();
    });
    it('refuses parent-only access and wrong actor before reading targets', async () => {
        for (const change of [() => new Set(['parent']), () => new Set()]) { const f = fixture(); f.context.teams.get('team-1').roles = change(); await expect(f.commands.prepare(input)).rejects.toThrow(); expect(f.store.get).not.toHaveBeenCalled(); }
        const f = fixture(); f.context.uid = 'other'; await expect(f.commands.prepare(input)).rejects.toThrow();
    });
    it('store forbids generic event/claim sets, unrelated deletes and other event patches', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' })));
        const store = createDirectAssignmentBatchStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl });
        for (const path of [eventPath, claimPath('Snack')]) await expect(store.transaction(async (tx) => tx.set(path, {}))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.delete(eventPath))).rejects.toThrow(); await expect(store.transaction(async (tx) => tx.patch(eventPath, { location: 'No' }))).rejects.toThrow();
        expect(fetchImpl.mock.calls.some(([url]) => url.endsWith(':commit'))).toBe(false);
    });
    it('matches actual app create/update field and claim-removal semantics for supported input', async () => {
        const source = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');
        const functions = source.slice(source.indexOf('export async function createScheduleAssignment('), source.indexOf('export async function removeScheduleAssignment('))
            .replaceAll('export ', '').replaceAll(': ParentScheduleEvent', '').replaceAll(': AuthUser | null', '').replaceAll(': ScheduleAssignmentInput', '').replaceAll(': string', '');
        let rows = [open('Snack'), fixed('Equipment')]; const cleared = [];
        const app = runInNewContext(`${functions}; ({ createScheduleAssignment, updateScheduleAssignment })`, {
            assertAssignmentManagementEvent() {}, normalizeAssignments: (value) => value, normalizeScheduleAssignmentInput: (value) => value,
            normalizeAssignmentRoleKey: (value) => value.toLowerCase(), normalizeAssignmentRole: (value) => value.trim(), assertUniqueAssignmentRole() {},
            persistScheduleAssignments: async (_, value) => { rows = value; return rows; }, clearScheduleAssignmentClaim: async (_, role) => cleared.push(role),
            invalidateScheduleEventAssignmentClaimsCache() {}, reloadPersistedScheduleAssignments: async (_, value) => value
        });
        for (const entry of input.operations) if (entry.action === 'create') await app.createScheduleAssignment({ assignments: rows }, { uid: 'owner' }, entry.assignment);
        else await app.updateScheduleAssignment({ assignments: rows }, { uid: 'owner' }, entry.role, entry.assignment);
        const f = fixture(); for (const role of ['Snack', 'Snacks', 'Water']) f.put(claimPath(role), claim);
        const preview = (await f.commands.prepare(input)).preview; await f.commands.confirm({ proposalId }, accept);
        expect(f.records.get(eventPath).data.assignments).toEqual(rows); expect(preview.removedClaims.map((row) => row.role)).toEqual([...new Set(cleared)]);
    });
    it('actual notification classifier produces no notification for an assignment-only batch', async () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        const classify = runInNewContext(`${source.slice(source.indexOf('function detectGameNotificationCategory('), source.indexOf('function buildStaffFeeNotificationDestination('))}; detectGameNotificationCategory`, { toNumericScore: (value) => Number(value) || 0, valuesDiffer: (a, b) => JSON.stringify(a) !== JSON.stringify(b) });
        const f = fixture(); const before = f.records.get(eventPath).data; await f.commands.prepare(input); await f.commands.confirm({ proposalId }, accept); expect(classify(before, f.records.get(eventPath).data)).toBeNull();
    });
    it('MCP rejects extra scope and model approval, then requires the actual form and distinct acknowledgement', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, assignmentBatchStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let approved = false;
        client.setRequestHandler(ElicitRequestSchema, async (request) => { expect(request.params.requestedSchema.required).toEqual(['approve', 'assignmentChanges']); expect(request.params.message).toContain('not notified'); return { action: 'accept', content: { approve: true, assignmentChanges: approved } }; });
        const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            expect((await client.callTool({ name: 'prepare_schedule_assignment_batch', arguments: { ...input, notify: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_schedule_assignment_batch', arguments: input })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_schedule_assignment_batch', arguments: { proposalId, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'confirm_schedule_assignment_batch', arguments: { proposalId } })).structuredContent.applied).toBe(false);
            approved = true; expect((await client.callTool({ name: 'confirm_schedule_assignment_batch', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            expect((await client.callTool({ name: 'get_schedule_assignment_batch_action', arguments: { proposalId } })).structuredContent.status).toBe('completed');
        } finally { await client.close(); await server.close(); }
    });
});
