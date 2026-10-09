import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildListParentTeamFeeRecipients({
    functions = {},
    httpsCallable,
    db = {},
    collectionGroup = vi.fn(),
    query = vi.fn(),
    where = vi.fn(),
    getDocs = vi.fn()
}) {
    const start = dbSource.indexOf('export async function listParentTeamFeeRecipients');
    const end = dbSource.indexOf('\nexport async function getTeamFeeBatch', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const functionSource = `${dbSource.slice(start, end)}\nreturn listParentTeamFeeRecipients;`
        .replace('export async function listParentTeamFeeRecipients', 'async function listParentTeamFeeRecipients');

    return new Function(
        'functions',
        'httpsCallable',
        'db',
        'collectionGroup',
        'query',
        'where',
        'getDocs',
        functionSource
    )(functions, httpsCallable, db, collectionGroup, query, where, getDocs);
}

describe('listParentTeamFeeRecipients', () => {
    it('uses one bounded callable request for a parent with 30 multi-team child links', async () => {
        const collectionGroupMock = vi.fn();
        const getDocsMock = vi.fn();
        const callableMock = vi.fn().mockResolvedValue({
            data: {
                items: [
                    { id: 'recipient-1', teamId: 'team-1', title: 'Season dues' },
                    { id: 'recipient-2', teamId: 'team-2', title: 'Tournament fee' }
                ]
            }
        });
        const httpsCallableMock = vi.fn((_functions, name) => {
            expect(name).toBe('listParentTeamFeeRecipients');
            return callableMock;
        });
        const listParentTeamFeeRecipients = buildListParentTeamFeeRecipients({
            httpsCallable: httpsCallableMock,
            collectionGroup: collectionGroupMock,
            getDocs: getDocsMock
        });
        const childLinks = Array.from({ length: 30 }, (_, index) => ({
            teamId: `team-${(index % 3) + 1}`,
            playerId: `player-${index + 1}`
        }));

        await expect(listParentTeamFeeRecipients('parent-1', childLinks)).resolves.toEqual([
            { id: 'recipient-1', teamId: 'team-1', title: 'Season dues' },
            { id: 'recipient-2', teamId: 'team-2', title: 'Tournament fee' }
        ]);

        expect(httpsCallableMock).toHaveBeenCalledTimes(1);
        expect(httpsCallableMock).toHaveBeenCalledWith({}, 'listParentTeamFeeRecipients');
        expect(callableMock).toHaveBeenCalledTimes(1);
        expect(callableMock).toHaveBeenCalledWith({});
        expect(collectionGroupMock).not.toHaveBeenCalled();
        expect(getDocsMock).not.toHaveBeenCalled();
    });

    it('propagates callable failures instead of returning partial or empty results', async () => {
        const failure = Object.assign(new Error('Too many linked players to load fees safely.'), {
            code: 'functions/resource-exhausted'
        });
        const callableMock = vi.fn().mockRejectedValue(failure);
        const listParentTeamFeeRecipients = buildListParentTeamFeeRecipients({
            httpsCallable: vi.fn(() => callableMock)
        });

        await expect(listParentTeamFeeRecipients('parent-1', [])).rejects.toBe(failure);
    });

    it('does not invoke the callable when no user is signed in', async () => {
        const callableMock = vi.fn();
        const httpsCallableMock = vi.fn(() => callableMock);
        const listParentTeamFeeRecipients = buildListParentTeamFeeRecipients({
            httpsCallable: httpsCallableMock
        });

        await expect(listParentTeamFeeRecipients('', [])).resolves.toEqual([]);
        expect(httpsCallableMock).not.toHaveBeenCalled();
        expect(callableMock).not.toHaveBeenCalled();
    });
});
