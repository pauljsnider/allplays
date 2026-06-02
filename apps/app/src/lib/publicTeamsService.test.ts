import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getTeams: vi.fn()
}));

vi.mock('../../../../js/db.js', () => dbMocks);

import { getPublicTeamsByLocation } from './publicTeamsService';

describe('getPublicTeamsByLocation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('defaults public teams without access flags to website access', async () => {
        dbMocks.getTeams.mockResolvedValue([
            {
                id: 'team-legacy-1',
                name: 'Legacy Legends',
                city: 'Chicago',
                state: 'IL'
            }
        ]);

        await expect(getPublicTeamsByLocation()).resolves.toEqual([
            expect.objectContaining({
                teamId: 'team-legacy-1',
                teamName: 'Legacy Legends',
                location: 'Chicago, IL',
                appAccess: false,
                webAccess: true,
                isPublic: true
            })
        ]);
        expect(dbMocks.getTeams).toHaveBeenCalledWith({ publicOnly: true, locationFilter: '' });
    });

    it('preserves explicit access flags from the public team document', async () => {
        dbMocks.getTeams.mockResolvedValue([
            {
                id: 'team-hidden-1',
                name: 'Hidden Club',
                zip: '60601',
                appAccess: false,
                webAccess: false
            }
        ]);

        await expect(getPublicTeamsByLocation('60601')).resolves.toEqual([
            expect.objectContaining({
                teamId: 'team-hidden-1',
                location: '60601',
                appAccess: false,
                webAccess: false
            })
        ]);
        expect(dbMocks.getTeams).toHaveBeenCalledWith({ publicOnly: true, locationFilter: '60601' });
    });
});
