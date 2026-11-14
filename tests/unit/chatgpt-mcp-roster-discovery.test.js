import { describe, expect, it, vi } from 'vitest';
import { getManagedTeamRoster } from '../../services/chatgpt-mcp/src/rosterDiscovery.js';
import { createUserDb, encodeValue } from '../../services/chatgpt-mcp/src/firestoreRest.js';

const context = (roles = ['owner']) => ({ teams: new Map([['team-1', { roles: new Set(roles) }]]) });
function fixture(rows = []) {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options) => {
        const query = JSON.parse(options.body).structuredQuery;
        calls.push({ url, options, query });
        const cursor = query.startAt?.values[0].referenceValue.split('/').pop();
        const results = rows.filter((row) => !cursor || row.id > cursor).slice(0, query.limit);
        return {
            ok: true,
            json: async () => results.map(({ id, ...data }) => ({
                document: { name: `projects/synthetic/databases/(default)/documents/teams/team-1/players/${id}`, fields: encodeValue(data).mapValue.fields }
            }))
        };
    });
    return { calls, fetchImpl, db: createUserDb({ projectId: 'synthetic', idToken: 'synthetic-user-token', fetchImpl }) };
}

describe('managed roster discovery for multi-turn MCP requests', () => {
    it('paginates by document identity and keeps active and inactive players without exposing private fields', async () => {
        const { db, calls } = fixture([
            { id: 'a', name: 'Alex', number: 9, active: false, medicalInfo: 'private', parentContacts: [{ email: 'private@example.test' }] },
            { id: 'b', name: 'Alex', position: 'GK' },
            { id: 'c', name: 'Casey', address: 'private' }
        ]);
        const first = await getManagedTeamRoster(db, context(), { teamId: 'team-1', limit: 2 });
        expect(first).toMatchObject({ hasMore: true, nextCursor: 'b', players: [{ id: 'a', active: false }, { id: 'b', active: true }] });
        const second = await getManagedTeamRoster(db, context(['admin']), { teamId: 'team-1', limit: 2, cursor: first.nextCursor });
        expect(second).toMatchObject({ hasMore: false, nextCursor: null, players: [{ id: 'c' }] });
        expect(JSON.stringify(first.players)).not.toContain('private');
        expect(JSON.stringify(second.players)).not.toContain('private');
        expect(first.players.map((row) => row.name)).toEqual(['Alex', 'Alex']);
        expect(calls[0].options.headers.Authorization).toBe('Bearer synthetic-user-token');
        expect(calls[0].query.select.fields.map((field) => field.fieldPath)).toEqual(['name', 'number', 'position', 'active']);
        expect(calls[1].query.startAt).toEqual({ before: false, values: [{ referenceValue: 'projects/synthetic/databases/(default)/documents/teams/team-1/players/b' }] });
        expect(calls[1].query.orderBy).toEqual([{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }]);
    });
    it('rejects parents, scorekeepers, revoked managers and unrelated teams before reading', async () => {
        const { db, fetchImpl } = fixture();
        for (const roles of [[], ['parent'], ['scorekeeper']]) {
            await expect(getManagedTeamRoster(db, context(roles), { teamId: 'team-1' })).rejects.toMatchObject({ code: 'permission_denied' });
        }
        await expect(getManagedTeamRoster(db, context(), { teamId: 'other' })).rejects.toMatchObject({ code: 'permission_denied' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
    it.each([
        { teamId: '../team-1' }, { teamId: 'team-1', cursor: '../../users' },
        { teamId: 'team-1', limit: 101 }, { teamId: 'team-1', limit: 0 }, { teamId: 'team-1', limit: 1.5 }
    ])('rejects malformed lookup parameters: %j', async (args) => {
        const { db, fetchImpl } = fixture();
        await expect(getManagedTeamRoster(db, context(), args)).rejects.toMatchObject({ code: 'invalid_argument' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
    it('does not misreport unavailable or denied data as an empty roster', async () => {
        const { db, fetchImpl } = fixture();
        fetchImpl.mockResolvedValueOnce({ ok: false, status: 403 });
        await expect(getManagedTeamRoster(db, context(), { teamId: 'team-1' })).rejects.toMatchObject({ code: 'permission_denied' });
        fetchImpl.mockRejectedValueOnce(new Error('network unavailable'));
        await expect(getManagedTeamRoster(db, context(), { teamId: 'team-1' })).rejects.toThrow('network unavailable');
        for (const payload of [{}, [{ error: { code: 7 } }], [{}]]) {
            fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => payload });
            await expect(getManagedTeamRoster(db, context(), { teamId: 'team-1' })).rejects.toMatchObject({ code: 'unavailable' });
        }
        fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => [{ readTime: new Date().toISOString() }] });
        const empty = await getManagedTeamRoster(db, context(), { teamId: 'team-1' });
        expect(empty).toMatchObject({ players: [], hasMore: false, nextCursor: null });
    });
    it('does not accept a document cursor with another query ordering', () => {
        const { db } = fixture();
        expect(() => db.collection('teams/team-1/players').orderBy('name').startAfterDocumentId('a')).toThrow();
    });
});
