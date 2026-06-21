import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    discoverPublicTeams: vi.fn()
}));

vi.mock('./adapters/legacyPublicTeamsDb', () => dbMocks);

import { getPublicTeamsByLocation, getPublicTeamsPage } from './publicTeamsService';

describe('publicTeamsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('defaults public teams without access flags to website access', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [
                {
                    id: 'team-legacy-1',
                    name: 'Legacy Legends',
                    city: 'Chicago',
                    state: 'IL'
                }
            ],
            nextCursor: 'cursor-1'
        });

        await expect(getPublicTeamsPage()).resolves.toEqual({
            teams: [
                expect.objectContaining({
                    teamId: 'team-legacy-1',
                    teamName: 'Legacy Legends',
                    location: 'Chicago, IL',
                    appAccess: false,
                    webAccess: true,
                    isPublic: true
                })
            ],
            nextCursor: 'cursor-1'
        });
        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledWith({ searchText: '', cursor: null, pageSize: 24 });
    });

    it('preserves explicit access flags from the public team document', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [
                {
                    id: 'team-hidden-1',
                    name: 'Hidden Club',
                    zip: '60601',
                    appAccess: false,
                    webAccess: false
                }
            ],
            nextCursor: null
        });

        await expect(getPublicTeamsByLocation('60601')).resolves.toEqual([
            expect.objectContaining({
                teamId: 'team-hidden-1',
                location: '60601',
                appAccess: false,
                webAccess: false
            })
        ]);
        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledWith({ searchText: '60601', cursor: null, pageSize: 24 });
    });

    it('keeps city searches on the bounded helper contract for zip-backed public teams', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [
                {
                    id: 'team-kc-1',
                    name: 'Kansas City Current',
                    city: 'Kansas City',
                    state: 'MO',
                    zip: '64102'
                }
            ],
            nextCursor: null
        });

        await expect(getPublicTeamsByLocation('Kansas City')).resolves.toEqual([
            expect.objectContaining({
                teamId: 'team-kc-1',
                location: 'Kansas City, MO'
            })
        ]);
        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledWith({ searchText: 'Kansas City', cursor: null, pageSize: 24 });
    });

    it('trims generic search text before hitting the bounded discovery helper', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [],
            nextCursor: null
        });

        await getPublicTeamsPage({ searchText: '  Atlanta United  ' });

        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledWith({ searchText: 'Atlanta United', cursor: null, pageSize: 24 });
    });
});
