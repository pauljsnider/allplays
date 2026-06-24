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
    it('uses single-field recipient lookups so parent fees do not depend on composite team indexes', async () => {
        const collectionGroupMock = vi.fn((_db, name) => ({ name }));
        const whereMock = vi.fn((field, op, value) => ({ field, op, value }));
        const queryMock = vi.fn((ref, ...clauses) => ({ ref, clauses }));
        const getDocs = vi.fn(async (request) => {
            const fields = request.clauses.map((clause) => clause.field);
            expect(fields).not.toContain('teamId');

            if (fields.includes('parentUserId')) {
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

            if (fields.includes('playerId')) {
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
                        },
                        {
                            id: 'recipient-3',
                            ref: { path: 'teams/team-2/feeBatches/batch-9/feeRecipients/recipient-3' },
                            data: () => ({
                                teamId: 'team-2',
                                playerId: 'player-1',
                                title: 'Wrong team fee'
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
        expect(fees.some((fee) => fee.id === 'recipient-3')).toBe(false);
    });
});
