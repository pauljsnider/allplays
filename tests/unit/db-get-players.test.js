import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildGetPlayers({ collection, getDocs }) {
    const start = dbSource.indexOf('export async function getPlayers(');
    const end = dbSource.indexOf('export async function getPlayersWithPrivateRosterContacts', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const functionSource = dbSource
        .slice(start, end)
        .replace('export async function getPlayers', 'return async function getPlayers');

    return new Function('collection', 'db', 'getDocs', functionSource)(collection, {}, getDocs);
}

describe('getPlayers', () => {
    it('includes players without jersey numbers and sorts the complete roster on the client', async () => {
        const collectionRef = {};
        const collection = vi.fn(() => collectionRef);
        const getDocs = vi.fn().mockResolvedValue({
            docs: [
                { id: 'no-number', data: () => ({ name: 'No Number Player', active: true }) },
                { id: 'number-10', data: () => ({ name: 'Ten', number: '10', active: true }) },
                { id: 'number-2', data: () => ({ name: 'Two', number: '2', active: true }) }
            ]
        });
        const getPlayers = buildGetPlayers({ collection, getDocs });

        await expect(getPlayers('team-1')).resolves.toEqual([
            { id: 'number-2', name: 'Two', number: '2', active: true },
            { id: 'number-10', name: 'Ten', number: '10', active: true },
            { id: 'no-number', name: 'No Number Player', active: true }
        ]);
        expect(collection).toHaveBeenCalledWith({}, 'teams/team-1/players');
        expect(getDocs).toHaveBeenCalledWith(collectionRef);
    });

    it('still excludes inactive players unless includeInactive is requested', async () => {
        const collection = vi.fn(() => ({}));
        const getDocs = vi.fn().mockResolvedValue({
            docs: [
                { id: 'active', data: () => ({ name: 'Active', active: true }) },
                { id: 'inactive', data: () => ({ name: 'Inactive', active: false }) }
            ]
        });
        const getPlayers = buildGetPlayers({ collection, getDocs });

        await expect(getPlayers('team-1')).resolves.toHaveLength(1);
        await expect(getPlayers('team-1', { includeInactive: true })).resolves.toHaveLength(2);
    });
});
