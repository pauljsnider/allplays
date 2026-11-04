import { vi } from 'vitest';
import { createDirectRosterCommands } from '../../services/chatgpt-mcp/src/directRoster.js';
export function rosterFixture() {
    const records = new Map(); let revision = 0; let clock = Date.now();
    const put = (key, data) => records.set(key, { exists: true, data: structuredClone(data), version: `v${++revision}` });
    put('teams/team-1', { name: 'Synthetic Team' });
    put('teams/team-1/players/existing', { name: 'Synthetic Existing', number: '00', position: 'Forward', active: false, legacyContact: 'excluded' });
    const context = { uid: 'owner', teams: new Map([['team-1', { team: { name: 'Synthetic Team' }, roles: new Set(['owner']) }]]) };
    const store = {
        get: vi.fn(async (key) => structuredClone(records.get(key) || { exists: false, version: null, data: null })),
        list: vi.fn(async (collection) => [...records].filter(([key]) => key.startsWith(`${collection}/`) && !key.slice(collection.length + 1).includes('/')).map(([key, value]) => ({ ...structuredClone(value), id: key.split('/').at(-1) }))),
        create: vi.fn(async (key, data) => { if (records.has(key)) throw new Error('exists'); put(key, data); }),
        transaction: vi.fn(async (callback, { beforeCommit } = {}) => {
            const writes = [];
            const result = await callback({ get: store.get, list: store.list,
                set: (key, data) => writes.push(() => put(key, data)),
                patch: (key, data) => writes.push(() => put(key, { ...records.get(key).data, ...data })) });
            if (writes.length) await beforeCommit?.(); writes.forEach((write) => write()); return result;
        })
    };
    const query = { select: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: async () => ({ docs: (await store.list('teams/team-1/players')).map((row) => ({ id: row.id, data: () => row.data })) }) };
    const dependencies = { uid: 'owner', store, rosterStore: store, getContext: async () => context, getDb: async () => ({ collection: () => query }), now: () => clock };
    return { records, put, context, store, dependencies, commands: createDirectRosterCommands(dependencies), advance: (ms) => { clock += ms; }, expire: () => { clock += 300001; } };
}
