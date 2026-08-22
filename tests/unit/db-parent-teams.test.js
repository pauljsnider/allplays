import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveCanonicalParentScopeInput } from '../../js/parent-membership-utils.js';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildGetParentTeams({ getUserProfile, getTeam }) {
    const start = dbSource.indexOf('export async function getParentTeams');
    const end = dbSource.indexOf('// User profiles', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const functionSource = dbSource
        .slice(start, end)
        .replace('export async function getParentTeams', 'return async function getParentTeams');

    return new Function(
        'getUserProfile',
        'getTeam',
        'resolveCanonicalParentScopeInput',
        functionSource
    )(getUserProfile, getTeam, resolveCanonicalParentScopeInput);
}

describe('getParentTeams', () => {
    it('starts all parent-linked team reads before awaiting any individual team result', async () => {
        const pendingTeamReads = [];
        const getUserProfile = vi.fn().mockResolvedValue({
            parentOf: [
                { teamId: 'team-b', playerId: 'player-b' },
                { teamId: 'team-a', playerId: 'player-a' },
                { teamId: 'team-b', playerId: 'player-b-2' },
                { teamId: 'team-c', playerId: 'player-c' }
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

    it('skips the profile read when the caller already has parentOf', async () => {
        const getUserProfile = vi.fn();
        const getTeam = vi.fn().mockResolvedValue({ id: 'team-a', name: 'Alpha' });
        const getParentTeams = buildGetParentTeams({ getUserProfile, getTeam });

        await expect(getParentTeams('parent-1', {
            parentOf: [{ teamId: 'team-a' }]
        })).resolves.toEqual([{ id: 'team-a', name: 'Alpha' }]);

        expect(getUserProfile).not.toHaveBeenCalled();
        expect(getTeam).toHaveBeenCalledWith('team-a', { includeInactive: false });
    });

    it('falls back to fetching the profile when parentOf is not provided', async () => {
        const getUserProfile = vi.fn().mockResolvedValue({ parentOf: [{ teamId: 'team-a', playerId: 'player-a' }] });
        const getTeam = vi.fn().mockResolvedValue({ id: 'team-a', name: 'Alpha' });
        const getParentTeams = buildGetParentTeams({ getUserProfile, getTeam });

        await expect(getParentTeams('parent-1')).resolves.toEqual([{ id: 'team-a', name: 'Alpha' }]);

        expect(getUserProfile).toHaveBeenCalledWith('parent-1');
    });

    it('uses present canonical team ids instead of stale parentOf teams', async () => {
        const getUserProfile = vi.fn();
        const getTeam = vi.fn(async (teamId) => ({ id: teamId, name: teamId }));
        const getParentTeams = buildGetParentTeams({ getUserProfile, getTeam });

        await expect(getParentTeams('parent-1', {
            profile: {
                parentOf: [
                    { teamId: 'team-current', playerId: 'player-current' },
                    { teamId: 'team-revoked', playerId: 'player-old' }
                ],
                parentTeamIds: ['team-current'],
                parentPlayerKeys: ['team-current::player-current']
            }
        })).resolves.toEqual([{ id: 'team-current', name: 'team-current' }]);

        expect(getUserProfile).not.toHaveBeenCalled();
        expect(getTeam).toHaveBeenCalledTimes(1);
        expect(getTeam).toHaveBeenCalledWith('team-current', { includeInactive: false });
    });

    it('derives teams from strict canonical player keys when team ids are absent', async () => {
        const getTeam = vi.fn(async (teamId) => ({ id: teamId, name: teamId }));
        const getParentTeams = buildGetParentTeams({ getUserProfile: vi.fn(), getTeam });

        await expect(getParentTeams('parent-1', {
            profile: {
                parentOf: [{ teamId: 'team-revoked', playerId: 'player-old' }],
                parentPlayerKeys: ['team-current::player-current', 'team-bad::player::extra']
            }
        })).resolves.toEqual([{ id: 'team-current', name: 'team-current' }]);
    });

    it('treats present empty or malformed canonical team evidence as no parent teams', async () => {
        const getTeam = vi.fn();
        const getParentTeams = buildGetParentTeams({ getUserProfile: vi.fn(), getTeam });

        await expect(getParentTeams('parent-1', {
            profile: {
                parentOf: [{ teamId: 'team-stale', playerId: 'player-stale' }],
                parentTeamIds: [123],
                parentPlayerKeys: ['team-stale::player-stale']
            }
        })).resolves.toEqual([]);

        expect(getTeam).not.toHaveBeenCalled();
    });
});
