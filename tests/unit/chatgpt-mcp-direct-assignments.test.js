import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createDirectAssignmentCommands, createDirectAssignmentStore, canonicalAssignments } from '../../services/chatgpt-mcp/src/directAssignments.js';
import { createDirectAssignmentClaimCommands, createDirectAssignmentClaimStore } from '../../services/chatgpt-mcp/src/directAssignmentClaims.js';
import { createDirectTrackingStatusStore } from '../../services/chatgpt-mcp/src/directTrackingStatus.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { mergeAssignmentsWithClaims, getOpenClaimableAssignments } from '../../js/snack-helpers.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const ids = { teamId: 'team-1', eventId: 'event' };
const eventPath = 'teams/team-1/games/event';
const claimPath = `${eventPath}/assignmentClaims/Snack`;
const slot = { role: 'Snack', value: '', claimable: true };
const fixed = { role: 'Equipment', value: 'Staff', claimable: false };
const manage = { ...ids, proposalId, action: 'update', role: 'Snack', assignment: { role: 'Snacks', value: '', claimable: true } };
const own = { ...ids, proposalId, action: 'claim', role: 'Snack' };
const accept = async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} });
const claim = (uid = 'owner') => ({ claimedByUserId: uid, claimedByName: uid === 'owner' ? 'Synthetic Parent' : 'Other Parent', claimedAt: new Date('2020-01-01') });
function fixture() {
    const f = rosterFixture(); f.context.teams.get('team-1').roles.add('parent');
    f.put('users/owner', { parentTeamIds: ['team-1'], fullName: 'Synthetic Parent', email: 'never-copy@example.test' });
    f.put(eventPath, { type: 'game', date: new Date('2060-01-01'), assignments: [slot, fixed], notes: 'Private preserved', location: 'Field' });
    return { ...f, manager: createDirectAssignmentCommands(f.dependencies), parent: createDirectAssignmentClaimCommands(f.dependencies) };
}
describe('ordinary volunteer assignment batch', () => {
    it('creates, replaces and removes slots while preserving unrelated event fields and app read-model compatibility', async () => {
        const f = fixture(); const before = f.records.get(eventPath).data;
        await f.manager.prepare({ ...manage, action: 'create', role: 'Water', assignment: { role: 'Water', value: '', claimable: true } });
        await f.manager.confirm({ proposalId }, accept);
        expect(getOpenClaimableAssignments(f.records.get(eventPath).data.assignments).map((row) => row.role)).toEqual(['Snack', 'Water']);
        await f.manager.prepare({ ...manage, proposalId: second }); await f.manager.confirm({ proposalId: second }, accept);
        const third = '00112233-4455-4677-8899-aabbccddeebb';
        await f.manager.prepare({ ...ids, proposalId: third, action: 'remove', role: 'Snacks' }); await f.manager.confirm({ proposalId: third }, accept);
        expect(f.records.get(eventPath).data).toEqual({ ...before, assignments: [fixed, { role: 'Water', value: '', claimable: true }] });
    });
    it('shows and atomically clears old and destination claims during rename, preserving unrelated claims', async () => {
        const f = fixture(); f.put(claimPath, claim('other')); f.put(`${eventPath}/assignmentClaims/Snacks`, claim()); f.put(`${eventPath}/assignmentClaims/Equipment`, claim());
        const prepared = await f.manager.prepare(manage); expect(prepared.preview.removedClaims.map((row) => row.role)).toEqual(['Snack', 'Snacks']);
        await f.manager.confirm({ proposalId }, accept);
        expect(f.records.has(claimPath)).toBe(false); expect(f.records.has(`${eventPath}/assignmentClaims/Snacks`)).toBe(false); expect(f.records.has(`${eventPath}/assignmentClaims/Equipment`)).toBe(true);
    });
    it('preserves a same-role open claim but clears it on conversion to fixed assignment', async () => {
        const f = fixture(); f.put(claimPath, claim()); await f.manager.prepare({ ...manage, assignment: slot }); await f.manager.confirm({ proposalId }, accept); expect(f.records.get(claimPath).data).toEqual(claim());
        await f.manager.prepare({ ...manage, proposalId: second, assignment: { ...slot, value: 'Staff', claimable: false } }); await f.manager.confirm({ proposalId: second }, accept); expect(f.records.has(claimPath)).toBe(false);
    });
    it('claims and releases only the actor’s own slot with the app claim schema', async () => {
        const f = fixture(); const prepared = await f.parent.prepare(own); expect(prepared.preview).toMatchObject({ actorId: 'owner', displayName: 'Synthetic Parent', role: 'Snack' }); expect(JSON.stringify(prepared)).not.toContain('never-copy');
        await f.parent.confirm({ proposalId }, accept); const saved = f.records.get(claimPath).data;
        expect(saved).toEqual({ claimedByUserId: 'owner', claimedByName: 'Synthetic Parent', claimedAt: expect.any(Date) });
        expect(mergeAssignmentsWithClaims([slot], { Snack: saved })[0].claim).toEqual(saved);
        await f.parent.prepare({ ...own, proposalId: second, action: 'release' }); await f.parent.confirm({ proposalId: second }, accept); expect(f.records.has(claimPath)).toBe(false);
    });
    it.each(['claim', 'release'])('refuses %s of another person’s existing claim', async (action) => {
        const f = fixture(); f.put(claimPath, claim('other')); await expect(f.parent.prepare({ ...own, action })).rejects.toThrow(); expect(f.records.get(claimPath).data).toEqual(claim('other'));
    });
    it.each([{ privateNote: 'Retain me' }, { claimedAt: null }, { claimedByUserId: 'other/uid' }, { claimedByName: '' }])('preserves and refuses an extended or malformed claim %#', async (changes) => {
        const f = fixture(); const original = { ...claim(), ...changes }; f.put(claimPath, original);
        await expect(f.manager.prepare(manage)).rejects.toThrow(); await expect(f.parent.prepare({ ...own, action: 'release' })).rejects.toThrow(); expect(f.records.get(claimPath).data).toEqual(original);
    });
    it.each([{ role: '../Snack' }, { role: ' Snack' }, { role: 'Snack/' }, { role: '__reserved__' }, { teamId: '../team' }])('rejects malformed role or path %#', async (change) => {
        const f = fixture(); await expect(f.parent.prepare({ ...own, ...change })).rejects.toThrow(); await expect(f.manager.prepare({ ...manage, ...change })).rejects.toThrow();
    });
    it.each([{ assignments: [{ ...slot, note: 'Retain' }] }, { assignments: [{ role: 'Snack', value: '' }] }, { assignments: [slot, { ...slot, role: 'snack' }] }, { assignments: null }, { assignments: [{ ...slot, value: 'Already filled' }] }, { assignments: Array.from({ length: 51 }, (_, i) => ({ ...slot, role: `Slot${i}` })) }, { status: 'cancelled' }, { source: 'import' }, { seriesId: 'series' }])('refuses unsupported event/slot shape %#', async (change) => {
        const f = fixture(); f.put(eventPath, { ...f.records.get(eventPath).data, ...change }); await expect(f.manager.prepare(manage)).rejects.toThrow(); await expect(f.parent.prepare(own)).rejects.toThrow();
    });
    it.each([{ action: 'create', role: 'snack', assignment: { ...slot, role: 'snack' } }, { assignment: { ...slot, role: 'Equipment' } }, { action: 'remove', assignment: slot }, { assignment: { ...slot, notes: 'Hidden' } }, { assignment: { ...slot, value: 'Filled' } }])('rejects ambiguous or inconsistent replacement %#', async (change) => {
        const f = fixture(); await expect(f.manager.prepare({ ...manage, ...change })).rejects.toThrow();
    });
    it.each(['manager', 'parent'])('rejects stale revisions, altered previews and absent authority for %s', async (kind) => {
        for (const mutation of ['event', 'claim', 'permission', 'expiry', 'preview', 'authority']) {
            const f = fixture(); const engine = f[kind]; await engine.prepare(kind === 'manager' ? manage : own);
            await expect(engine.confirm({ proposalId }, async () => {
                if (mutation === 'event') f.put(eventPath, { ...f.records.get(eventPath).data, location: 'Changed' });
                if (mutation === 'claim') f.put(claimPath, claim('other'));
                if (mutation === 'permission') f.context.teams.clear();
                if (mutation === 'expiry') f.expire();
                if (mutation === 'preview') f.put(`users/owner/privateAiPendingActions/direct_${proposalId}`, { ...f.records.get(`users/owner/privateAiPendingActions/direct_${proposalId}`).data, preview: { unapproved: true } });
                return mutation === 'authority' ? { action: 'accept', content: { approve: true } } : accept();
            })).rejects.toThrow();
            expect(f.records.get(eventPath).data.assignments).toEqual([slot, fixed]); expect(f.records.get(claimPath)?.data.claimedByUserId).not.toBe('owner');
        }
    });
    it.each(['profile', 'canonical_parent_link'])('rejects %s changes even when a cached role says parent', async (kind) => {
        const f = fixture(); await f.parent.prepare(own);
        await expect(f.parent.confirm({ proposalId }, async () => { f.put('users/owner', { ...f.records.get('users/owner').data, ...(kind === 'profile' ? { fullName: 'Changed' } : { parentTeamIds: [] }) }); return accept(); })).rejects.toThrow(); expect(f.records.has(claimPath)).toBe(false);
    });
    it('requires canonical parent access and a supported current profile name without email fallback', async () => {
        const f = fixture(); f.put('users/owner', { parentOf: [{ teamId: 'team-1' }], fullName: 'Parent' }); await expect(f.parent.prepare(own)).rejects.toThrow();
        f.put('users/owner', { parentTeamIds: ['team-1'], email: 'do-not-publish@example.test' }); await expect(f.parent.prepare(own)).rejects.toMatchObject({ code: 'unsupported_profile' });
    });
    it.each(['manager', 'parent'])('decline/cancel and lost-response reconciliation for %s', async (kind) => {
        const f = fixture(); const engine = f[kind]; await engine.prepare(kind === 'manager' ? manage : own);
        for (const action of ['decline', 'cancel']) expect(await engine.confirm({ proposalId }, async () => ({ action }))).toMatchObject({ applied: false });
        expect(f.store.transaction).not.toHaveBeenCalled(); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost acknowledgment'); });
        expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.context.teams.clear(); await expect(engine.status({ proposalId })).rejects.toThrow();
    });
    it('discovery excludes private event fields and other claimant identities', async () => {
        const f = fixture(); f.put(claimPath, claim('other')); const parent = await f.parent.discover(ids);
        expect(parent.slots).toEqual([{ role: 'Snack', state: 'claimed' }, { role: 'Equipment', state: 'fixed' }]); expect(JSON.stringify(parent)).not.toContain('Other Parent');
        expect(JSON.stringify(await f.manager.discover(ids))).not.toContain('Private preserved');
    });
    it('the actual notification category detector does not notify for assignment-only mutations', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        const match = /function detectGameNotificationCategory\(beforeGame, afterGame\) \{[\s\S]*?\n\}/.exec(source);
        const detect = vm.runInNewContext(`(${match[0]})`, { toNumericScore: (value) => Number(value || 0), valuesDiffer: (a, b) => JSON.stringify(a) !== JSON.stringify(b) });
        const before = { date: '2060-01-01', location: 'Field', assignments: [slot] };
        expect(detect(before, { ...before, assignments: [fixed] })).toBe(null); expect(detect(before, { ...before, location: 'New Field' })).toBe('schedule');
    });
    it('adapters reject unrelated deletes, parent event patches and manager non-assignment patches', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' })));
        const options = { projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl };
        for (const store of [createDirectAssignmentStore(options), createDirectAssignmentClaimStore(options), createDirectTrackingStatusStore(options)]) {
            await expect(store.transaction(async (tx) => tx.delete(eventPath))).rejects.toThrow();
            await expect(store.transaction(async (tx) => tx.delete('teams/team-1/players/player'))).rejects.toThrow();
            await expect(store.transaction(async (tx) => tx.patch(eventPath, { location: 'Unapproved' }))).rejects.toThrow();
        }
        await expect(createDirectTrackingStatusStore(options).transaction(async (tx) => tx.delete('teams/team-1/trackingItems/item/memberTracking/player'))).rejects.toThrow();
        expect(fetchImpl.mock.calls.every(([url]) => !url.endsWith(':commit'))).toBe(true);
    });
    it('all three workflow entry points require actual MCP form approval', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, assignmentStore: f.store, assignmentClaimStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let forms = 0;
        client.setRequestHandler(ElicitRequestSchema, async () => { forms++; return { action: 'accept', content: { approve: true } }; });
        const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            for (const [prepare, confirm, args] of [
                ['prepare_manage_schedule_assignment', 'confirm_schedule_assignment', { ...manage, assignment: slot }],
                ['prepare_claim_schedule_assignment', 'confirm_own_schedule_assignment', { ...ids, proposalId: second, role: 'Snack' }],
                ['prepare_release_schedule_assignment', 'confirm_own_schedule_assignment', { ...ids, proposalId: '00112233-4455-4677-8899-aabbccddeebb', role: 'Snack' }]]) {
                expect((await client.callTool({ name: prepare, arguments: args })).isError).not.toBe(true);
                expect((await client.callTool({ name: confirm, arguments: { proposalId: args.proposalId, confirmed: true } })).isError).toBe(true);
                expect((await client.callTool({ name: confirm, arguments: { proposalId: args.proposalId } })).structuredContent.status).toBe('completed');
            }
            expect(forms).toBe(3);
        } finally { await client.close(); await server.close(); }
    });
});
