import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildGetParentTeams({ getUserProfile, getTeam }) {
    const start = dbSource.indexOf('export async function getParentTeams');
    const end = dbSource.indexOf('// User profiles', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const functionSource = dbSource
        .slice(start, end)
        .replace('export async function getParentTeams', 'return async function getParentTeams');

    return new Function('getUserProfile', 'getTeam', functionSource)(getUserProfile, getTeam);
}

describe('getParentTeams', () => {
    it('starts all parent-linked team reads before awaiting any individual team result', async () => {
        const pendingTeamReads = [];
        const getUserProfile = vi.fn().mockResolvedValue({
            parentOf: [
                { teamId: 'team-b' },
                { teamId: 'team-a' },
                { teamId: 'team-b' },
                { teamId: 'team-c' }
            ]
        });
        const getTeam = vi.fn((teamId, options) => new Promise((resolve) => {
            pendingTeamReads.push({ teamId, options, resolve });
        }));
        const getParentTeams = buildGetParentTeams({ getUserProfile, getTeam });

        const teamsPromise = getParentTeams('parent-1', { includeInactive: true });
        await Promise.resolve();
        await Promise.resolve();

        expect(getUserProfile).toHaveBeenCalledWith('parent-1');
        expect(getTeam).toHaveBeenCalledTimes(3);
        expect(pendingTeamReads.map((entry) => entry.teamId)).toEqual(['team-b', 'team-a', 'team-c']);
        expect(pendingTeamReads.map((entry) => entry.options)).toEqual([
            { includeInactive: true },
            { includeInactive: true },
            { includeInactive: true }
        ]);

        pendingTeamReads.find((entry) => entry.teamId === 'team-b')?.resolve({ id: 'team-b', name: 'Bravo' });
        pendingTeamReads.find((entry) => entry.teamId === 'team-a')?.resolve({ id: 'team-a', name: 'Alpha' });
        pendingTeamReads.find((entry) => entry.teamId === 'team-c')?.resolve({ id: 'team-c', name: 'Charlie' });

        await expect(teamsPromise).resolves.toEqual([
            { id: 'team-a', name: 'Alpha' },
            { id: 'team-b', name: 'Bravo' },
            { id: 'team-c', name: 'Charlie' }
        ]);
    });
});
