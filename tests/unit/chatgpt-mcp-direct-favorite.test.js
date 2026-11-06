import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { describe, expect, it, vi } from 'vitest';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { createDirectFavoriteCommands } from '../../services/chatgpt-mcp/src/directFavorite.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { createDirectFavoriteStore } from '../../services/chatgpt-mcp/src/directFavoriteStore.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';

const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const input = { proposalId, teamId: 'team-1', drillId: 'drill-1', favorite: true };
const proposalPath = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const favoritePath = 'teams/team-1/drillFavorites/drill-1';
const accepted = () => Promise.resolve({ action: 'accept', content: { approve: true }, consume: async () => {} });

function fixture() {
    const records = new Map();
    let version = 0;
    const put = (path, data) => records.set(path, { exists: true, data: structuredClone(data), version: `revision-${++version}` });
    put('teams/team-1', { name: 'Synthetic Team' });
    put('drillLibrary/drill-1', { title: 'Passing' });
    let clock = Date.now();
    const context = { uid: 'owner', teams: new Map([['team-1', { roles: new Set(['owner']) }]]) };
    const store = {
        get: vi.fn(async (path) => structuredClone(records.get(path) || { exists: false, data: null, version: null })),
        create: vi.fn(async (path, data) => { if (records.has(path)) throw new Error('exists'); put(path, data); }),
        transaction: vi.fn(async (callback, { beforeCommit } = {}) => {
            const writes = [];
            const result = await callback({ get: store.get, set: (path, data) => writes.push(() => put(path, data)), delete: (path) => writes.push(() => records.delete(path)) });
            if (writes.length) await beforeCommit?.();
            writes.forEach((write) => write());
            return result;
        })
    };
    const dependencies = { uid: 'owner', store, getContext: async () => context, now: () => clock };
    return { records, put, store, context, dependencies, commands: createDirectFavoriteCommands(dependencies), expire: () => { clock += 300001; } };
}

describe('bounded direct favorite command', () => {
    it.each([0, 120001, Infinity, NaN])('rejects an unbounded approval lifetime: %s', (lifetimeMs) => {
        expect(() => createOneActionApproval({ getActor: async () => ({}), lifetimeMs })).toThrow(/bounded approval lifetime/);
    });
    it.each(['uid', 'clientId', 'grantKey', 'expiresAt'])('does not elicit without the live actor binding field %s', async (field) => {
        const actor = { uid: 'owner', clientId: 'client', grantKey: 'grant', expiresAt: Date.now() + 120000 }; delete actor[field];
        const elicit = vi.fn(); const authorize = createOneActionApproval({ getActor: async () => actor });
        await expect(authorize({}, elicit)).rejects.toMatchObject({ code: 'confirmation_unavailable' }); expect(elicit).not.toHaveBeenCalled();
    });
    it.each([undefined, null, true, 'yes'])('rejects accepted content without a callable one-use authority: %s', async (consume) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume })))
            .rejects.toMatchObject({ code: 'confirmation_unavailable' });
        expect(f.store.transaction).not.toHaveBeenCalled(); expect(f.records.has(favoritePath)).toBe(false);
    });
    it('prepares without business writes, then atomically records an approved change and does not replay it', async () => {
        const f = fixture();
        const proposal = await f.commands.prepare(input);
        expect(proposal.preview).toMatchObject({ teamName: 'Synthetic Team', drillTitle: 'Passing', wasFavorite: false });
        expect(f.records.has(favoritePath)).toBe(false);
        const approve = vi.fn(accepted);
        expect(await f.commands.confirm({ proposalId }, approve)).toMatchObject({ status: 'completed', favorite: true });
        expect(f.records.get(favoritePath).data.addedBy).toBe('owner');
        expect(f.records.get(proposalPath).data).toMatchObject({ status: 'completed', approvedBy: 'owner' });
        const restarted = createDirectFavoriteCommands(f.dependencies);
        expect(await restarted.confirm({ proposalId }, approve)).toMatchObject({ status: 'completed' });
        expect(approve).toHaveBeenCalledTimes(1);
        expect(f.store.transaction).toHaveBeenCalledTimes(1);
    });
    it.each([{ action: 'decline' }, { action: 'cancel' }, { action: 'accept', content: { approve: false } }, { action: 'accept' }])('never writes without explicit approval: %j', async (answer) => {
        const f = fixture(); await f.commands.prepare(input);
        expect(await f.commands.confirm({ proposalId }, async () => answer)).toMatchObject({ applied: false });
        expect(f.store.transaction).not.toHaveBeenCalled();
        expect(f.records.has(favoritePath)).toBe(false);
    });
    it('blocks expiry, changed previews, lost permissions and changed actors', async () => {
        for (const mutate of [
            (f) => f.expire(),
            (f) => f.put(proposalPath, { ...f.records.get(proposalPath).data, preview: { action: 'Something else' } }),
            (f) => f.context.teams.clear(),
            (f) => { f.context.uid = 'other'; }
        ]) {
            const f = fixture(); await f.commands.prepare(input); mutate(f);
            const approve = vi.fn(accepted);
            await expect(f.commands.confirm({ proposalId }, approve)).rejects.toThrow();
            expect(approve).not.toHaveBeenCalled();
            expect(f.records.has(favoritePath)).toBe(false);
        }
    });
    it('rechecks authorization, proposal contents and target versions after the approval response', async () => {
        for (const mutate of [
            (f) => f.context.teams.clear(),
            (f) => f.put('teams/team-1', { name: 'Changed team' }),
            (f) => f.put('drillLibrary/drill-1', { title: 'Changed drill' }),
            (f) => f.put(proposalPath, { ...f.records.get(proposalPath).data, favorite: false })
        ]) {
            const f = fixture(); await f.commands.prepare(input);
            await expect(f.commands.confirm({ proposalId }, async () => { mutate(f); return accepted(); })).rejects.toThrow();
            expect(f.records.has(favoritePath)).toBe(false);
        }
    });
    it('rejects reuse for another target and reconciles a lost successful commit without another write', async () => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.prepare({ ...input, favorite: false })).rejects.toMatchObject({ code: 'conflict' });
        const transaction = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (callback, options) => { await transaction(callback, options); throw new Error('response lost'); });
        expect(await f.commands.confirm({ proposalId }, accepted)).toMatchObject({ status: 'completed' });
        expect(f.store.transaction).toHaveBeenCalledTimes(1);
    });
    it('supports removal and leaves an already-satisfied favorite unchanged', async () => {
        const remove = fixture(); remove.put(favoritePath, { addedBy: 'owner' });
        await remove.commands.prepare({ ...input, favorite: false });
        await remove.commands.confirm({ proposalId }, accepted);
        expect(remove.records.has(favoritePath)).toBe(false);
        const same = fixture(); same.put(favoritePath, { addedBy: 'other-manager' });
        await same.commands.prepare(input);
        await same.commands.confirm({ proposalId }, accepted);
        expect(same.records.get(favoritePath).data.addedBy).toBe('other-manager');
    });
    it('reports an unverified transaction outcome without automatically replaying it', async () => {
        const f = fixture(); await f.commands.prepare(input);
        f.store.transaction.mockRejectedValue(new Error('connection lost'));
        await expect(f.commands.confirm({ proposalId }, accepted)).rejects.toMatchObject({ code: 'outcome_unknown' });
        expect(f.store.transaction).toHaveBeenCalledTimes(1);
        expect(f.records.has(favoritePath)).toBe(false);
    });
    it('compares stored maps independently of Firestore field order', async () => {
        const f = fixture(); await f.commands.prepare(input);
        const record = f.records.get(proposalPath).data;
        f.put(proposalPath, { ...record, preview: Object.fromEntries(Object.entries(record.preview).reverse()), revisions: Object.fromEntries(Object.entries(record.revisions).reverse()) });
        expect(await f.commands.confirm({ proposalId }, accepted)).toMatchObject({ status: 'completed' });
    });
    it('restricts the REST writer to actor-owned proposals and team-favorite paths', async () => {
        const fetchImpl = vi.fn();
        const store = createDirectFavoriteStore({ uid: 'owner', projectId: 'synthetic', idToken: 'synthetic', fetchImpl });
        await expect(store.create('teams/team-1/games/game-1', {})).rejects.toThrow();
        await expect(store.get(`users/other/privateAiPendingActions/direct_${proposalId}`)).rejects.toThrow();
        expect(fetchImpl).not.toHaveBeenCalled();
    });
    it('checks approval after credential refresh and never sends a commit if the approval expired meanwhile', async () => {
        let clock = 1000; let authentications = 0;
        const authorize = createOneActionApproval({ getActor: async () => ({ uid: 'owner', clientId: 'client', grantKey: 'grant', expiresAt: 10000 }), now: () => clock, lifetimeMs: 1000 });
        const approval = await authorize({ favorite: true }, accepted);
        const fetchImpl = vi.fn(async (url) => ({ ok: true, json: async () => url.endsWith(':beginTransaction') ? { transaction: 'synthetic' } : {} }));
        const store = createDirectFavoriteStore({ uid: 'owner', projectId: 'synthetic', fetchImpl, getIdToken: async () => {
            if (++authentications === 2) clock = 3000;
            return 'synthetic-token';
        } });
        await expect(store.transaction(async (transaction) => { transaction.set(favoritePath, { addedBy: 'owner' }); }, { beforeCommit: approval.consume })).rejects.toMatchObject({ code: 'confirmation_expired' });
        expect(fetchImpl.mock.calls.map(([url]) => url.split(':').at(-1))).toEqual(['beginTransaction', 'rollback']);
    });
});

describe('MCP protocol approval, without a production endpoint', () => {
    it.each([undefined, null, true])('refuses construction without a bound authority: %s', (authorizeAction) => {
        expect(() => createDirectFavoriteMcpSession({ ...fixture().dependencies, authorizeAction })).toThrow(/approval authority/);
    });
    it('does not execute when a custom composition returns raw form content without a consumption authority', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, authorizeAction: (preview, elicit) => elicit(preview) });
        const client = new Client({ name: 'synthetic-raw-form', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content: { approve: true } }));
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport); await client.connect(clientTransport);
        try {
            await client.callTool({ name: 'prepare_team_drill_favorite', arguments: input });
            const result = await client.callTool({ name: 'confirm_team_drill_favorite', arguments: { proposalId } });
            expect(result.isError).toBe(true); expect(result.content[0].text).toContain('confirmation_unavailable'); expect(f.records.has(favoritePath)).toBe(false);
        } finally { await client.close(); await server.close(); }
    });
    it.each([true, false])('requires an initialized client with form elicitation support: %s', async (supportsApproval) => {
        const f = fixture();
        const server = createDirectFavoriteMcpSession({ ...f.dependencies, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'synthetic-approval-client', version: '1' }, { capabilities: supportsApproval ? { elicitation: { form: {} } } : {} });
        const approve = vi.fn(async (request) => {
            expect(request.params.message).toContain('Synthetic Team');
            expect(request.params.message).toContain('Passing');
            expect(request.params.requestedSchema.properties.approve.default).toBe(false);
            return accepted();
        });
        if (supportsApproval) client.setRequestHandler(ElicitRequestSchema, approve);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport); await client.connect(clientTransport);
        try {
            const tools = await client.listTools();
            expect(tools.tools.map((tool) => tool.name)).toEqual(['prepare_team_drill_favorite', 'confirm_team_drill_favorite', 'get_team_drill_favorite_action']);
            await client.callTool({ name: 'prepare_team_drill_favorite', arguments: input });
            const rejected = await client.callTool({ name: 'confirm_team_drill_favorite', arguments: { proposalId, confirmed: true } });
            expect(rejected.isError).toBe(true);
            expect(approve).not.toHaveBeenCalled();
            const result = await client.callTool({ name: 'confirm_team_drill_favorite', arguments: { proposalId } });
            expect(Boolean(result.isError)).toBe(!supportsApproval);
            expect(f.records.has(favoritePath)).toBe(supportsApproval);
            expect(approve).toHaveBeenCalledTimes(supportsApproval ? 1 : 0);
        } finally { await client.close(); await server.close(); }
    });
});
