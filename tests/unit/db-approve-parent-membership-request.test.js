import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function getFunctionSource(functionName) {
    const start = dbSource.indexOf(`export async function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = dbSource.indexOf('\nexport async function ', start + 1);
    const nextImport = dbSource.indexOf('\nimport ', start + 1);
    const candidates = [nextExport, nextImport].filter((value) => value !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : dbSource.length;
    return dbSource.slice(start, end);
}

function buildApproveParentMembershipRequest(deps) {
    const functionSource = getFunctionSource('approveParentMembershipRequest')
        .replace('export async function approveParentMembershipRequest', 'return async function approveParentMembershipRequest');

    return new Function(
        'auth',
        'doc',
        'db',
        'runTransaction',
        'buildParentMembershipRequestUpdate',
        'Timestamp',
        functionSource
    )(
        deps.auth,
        deps.doc,
        deps.db,
        deps.runTransaction,
        deps.buildParentMembershipRequestUpdate,
        deps.Timestamp
    );
}

function makeSnap(id, data) {
    return { id, exists: () => data !== null, data: () => data };
}

describe('approveParentMembershipRequest', () => {
    it('updates the player and request without touching the parent user doc client-side', async () => {
        const writes = { sets: [], updates: [] };
        const reads = [];
        const transaction = {
            get: vi.fn(async (ref) => {
                reads.push(ref.path);
                return {
                    'teams/team-1/membershipRequests/req-1': makeSnap('req-1', {
                        status: 'pending',
                        playerId: 'player-9',
                        requesterUserId: 'parent-uid',
                        requesterEmail: 'parent@example.com',
                        relation: 'Parent'
                    }),
                    'teams/team-1': makeSnap('team-1', { name: 'Jr Current', active: true }),
                    'teams/team-1/players/player-9': makeSnap('player-9', { name: 'Madison', number: '23', parents: [] })
                }[ref.path] || makeSnap('missing', null);
            }),
            set: (ref, data, options) => writes.sets.push({ path: ref.path, data, options }),
            update: (ref, data) => writes.updates.push({ path: ref.path, data })
        };

        const approveParentMembershipRequest = buildApproveParentMembershipRequest({
            auth: { currentUser: { uid: 'coach-uid', displayName: 'Coach', email: 'coach@example.com' } },
            doc: (_db, collectionPath, id) => ({ path: id ? `${collectionPath}/${id}` : collectionPath }),
            db: {},
            runTransaction: async (_db, fn) => fn(transaction),
            buildParentMembershipRequestUpdate: ({ nextStatus, decidedBy, decidedByName, decisionNote }) => ({
                status: nextStatus,
                decidedBy,
                decidedByName,
                decisionNote
            }),
            Timestamp: { now: () => 'NOW' }
        });

        const result = await approveParentMembershipRequest('team-1', 'req-1');
        expect(result).toEqual({ success: true });
        expect(reads).toEqual([
            'teams/team-1/membershipRequests/req-1',
            'teams/team-1',
            'teams/team-1/players/player-9'
        ]);

        const playerSet = writes.sets.find((write) => write.path === 'teams/team-1/players/player-9');
        expect(playerSet).toBeTruthy();
        expect(playerSet.data.parents).toEqual([
            { userId: 'parent-uid', email: 'parent@example.com', relation: 'Parent', addedAt: 'NOW' }
        ]);
        expect(writes.sets.some((write) => write.path === 'users/parent-uid')).toBe(false);

        const requestUpdate = writes.updates.find((write) => write.path === 'teams/team-1/membershipRequests/req-1');
        expect(requestUpdate?.data.status).toBe('approved');
        expect(requestUpdate?.data.decidedAt).toBe('NOW');
    });
});
