import { vi } from 'vitest';
import { createDirectPracticeTimelineCommands } from '../../services/chatgpt-mcp/src/directPracticeTimeline.js';

export const practiceProposalId = '00112233-4455-4677-8899-aabbccddeeff';
export const practiceUpdateId = '00112233-4455-4677-8899-aabbccddeeaa';
export const practiceInput = { proposalId: practiceProposalId, mode: 'create', teamId: 'team-1', eventId: 'practice-1', sessionId: `mcp_${practiceProposalId}`,
    changes: { title: 'Synthetic Practice Plan', blocks: [{ drillId: 'drill-1', duration: 15 }, { title: 'Water break', duration: 5 }] } };
export const practiceSessionPath = `teams/team-1/practiceSessions/${practiceInput.sessionId}`;
export const acceptPractice = () => ({ action: 'accept', content: { approve: true }, consume: vi.fn() });
export function directPracticeFixture() {
    const records = new Map(); let revision = 0; let clock = Date.now();
    const put = (path, data) => records.set(path, { exists: true, data: structuredClone(data), version: `v${++revision}` });
    put('teams/team-1', { name: 'Synthetic Team' });
    put('teams/team-1/games/practice-1', { type: 'practice', title: 'Synthetic Practice', date: new Date('2026-12-01T17:00:00Z'), location: 'Synthetic Field' });
    put('drillLibrary/drill-1', { source: 'community', title: 'Passing', type: 'Technical', description: 'Pass in pairs.', setup: { duration: 10 } });
    const context = { uid: 'owner', teams: new Map([['team-1', { team: { name: 'Synthetic Team' }, roles: new Set(['owner']) }]]) };
    const store = {
        get: vi.fn(async (path) => structuredClone(records.get(path) || { exists: false, data: null, version: null })),
        list: vi.fn(async (path, args = {}) => [...records].filter(([key, row]) => key.startsWith(`${path}/`) && (!args.eventId || row.data.eventId === args.eventId))
            .map(([key, row]) => ({ ...structuredClone(row), id: key.split('/').at(-1) }))),
        create: vi.fn(async (path, data) => { if (records.has(path)) throw new Error('exists'); put(path, data); }),
        transaction: vi.fn(async (callback, { beforeCommit } = {}) => {
            const writes = [];
            const result = await callback({ get: store.get, list: store.list,
                set: (path, data) => writes.push(() => put(path, data)),
                patch: (path, data) => writes.push(() => put(path, { ...records.get(path).data, ...data })),
                append: (path, field, values, data) => writes.push(() => put(path, { ...records.get(path).data, ...data, [field]: [...records.get(path).data[field], ...values] })) });
            if (writes.length) await beforeCommit?.(); writes.forEach((write) => write()); return result;
        })
    };
    const getDb = async () => ({ collection: (path) => {
        let field; let value; let after; let limit = 100;
        const query = { select: () => query, orderBy: () => query, limit: (n) => { limit = n; return query; }, startAfterDocumentId: (id) => { after = id; return query; },
            where: (f, op, v) => { field = f; value = v; return query; },
            get: async () => ({ docs: (await store.list(path)).filter((row) => (!field || row.data[field] === value) && (!after || row.id > after)).slice(0, limit).map((row) => ({ id: row.id, data: () => row.data })) }) };
        return query;
    } });
    const dependencies = { uid: 'owner', store, practiceTimelineStore: store, getContext: async () => context, getDb, now: () => clock };
    return { records, put, context, store, dependencies, commands: createDirectPracticeTimelineCommands(dependencies), expire: () => { clock += 300001; } };
}
