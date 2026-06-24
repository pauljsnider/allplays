import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildListParentTeamFeeRecipients({ db = {}, collectionGroup, query, where, getDocs }) {
    const start = dbSource.indexOf('function getTeamIdFromDocPath');
    const end = dbSource.indexOf('\nexport async function getTeamFeeBatch', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const functionSource = `${dbSource.slice(start, end)}\nreturn listParentTeamFeeRecipients;`
        .replace('export async function listParentTeamFeeRecipients', 'async function listParentTeamFeeRecipients');

    return new Function('db', 'collectionGroup', 'query', 'where', 'getDocs', functionSource)(
        db,
        collectionGroup,
        query,
        where,
        getDocs
    );
}

describe('listParentTeamFeeRecipients', () => {
    it('keeps parent fee lookups scoped to linked teams so Firestore rules can authorize them', async () => {
        const collectionGroupMock = vi.fn((_db, name) => ({ name }));
        const whereMock = vi.fn((field, op, value) => ({ field, op, value }));
        const queryMock = vi.fn((ref, ...clauses) => ({ ref, clauses }));
        const getDocs = vi.fn(async (request) => {
            const fields = request.clauses.map((clause) => clause.field);
            expect(fields).toContain('teamId');

            const teamIdClause = request.clauses.find((clause) => clause.field === 'teamId');
            const playerIdClause = request.clauses.find((clause) => clause.field === 'playerId');
            const parentUserClause = request.clauses.find((clause) => clause.field === 'parentUserId');

            if (teamIdClause?.value !== 'team-1') {
                return { docs: [] };
            }

            if (parentUserClause?.value === 'parent-1') {
                return {
                    docs: [
                        {
                            id: 'recipient-1',
                            ref: { path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1' },
                            data: () => ({
                                teamId: 'team-1',
                                parentUserId: 'parent-1',
                                playerId: 'player-1',
                                title: 'Season dues'
                            })
                        }
                    ]
                };
            }

            if (playerIdClause?.value === 'player-1') {
                return {
                    docs: [
                        {
                            id: 'recipient-2',
                            ref: { path: 'teams/team-1/feeBatches/batch-2/feeRecipients/recipient-2' },
                            data: () => ({
                                teamId: 'team-1',
                                playerId: 'player-1',
                                title: 'Tournament fee'
                            })
                        }
                    ]
                };
            }

            return { docs: [] };
        });
        const listParentTeamFeeRecipients = buildListParentTeamFeeRecipients({
            collectionGroup: collectionGroupMock,
            query: queryMock,
            where: whereMock,
            getDocs
        });

        const fees = await listParentTeamFeeRecipients('parent-1', [{ teamId: 'team-1', playerId: 'player-1' }]);

        expect(collectionGroupMock).toHaveBeenCalledWith({}, 'feeRecipients');
        expect(fees).toEqual([
            expect.objectContaining({ id: 'recipient-1', title: 'Season dues' }),
            expect.objectContaining({ id: 'recipient-2', title: 'Tournament fee' })
        ]);
        expect(queryMock).toHaveBeenCalledWith(
            { name: 'feeRecipients' },
            { field: 'teamId', op: '==', value: 'team-1' },
            { field: 'parentUserId', op: '==', value: 'parent-1' }
        );
        expect(queryMock).toHaveBeenCalledWith(
            { name: 'feeRecipients' },
            { field: 'teamId', op: '==', value: 'team-1' },
            { field: 'playerId', op: '==', value: 'player-1' }
        );
    });
});
