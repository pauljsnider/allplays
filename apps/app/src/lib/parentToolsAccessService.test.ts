import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyMocks = vi.hoisted(() => ({
    createParentMembershipRequest: vi.fn(),
    discoverPublicTeams: vi.fn(),
    getTeam: vi.fn(),
    getPlayers: vi.fn(),
    listMyParentMembershipRequests: vi.fn()
}));

vi.mock('./adapters/legacyParentTools', () => legacyMocks);

import { discoverParentAccessTeams, loadParentAccessTeam } from './parentToolsAccessService';

describe('parentToolsAccessService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('searches public teams with bounded cursor pagination and preserves nextCursor', async () => {
        legacyMocks.discoverPublicTeams.mockResolvedValue({
            teams: [
                { id: 'private-team', name: 'Private Wolves', isPublic: false },
                { id: 'team-1', name: 'Austin Bats', sport: 'Soccer', city: 'Austin', state: 'TX', zip: '73301', isPublic: true }
            ],
            nextCursor: { id: 'team-1' }
        });

        await expect(discoverParentAccessTeams({
            searchText: '  Austin  ',
            cursor: { id: 'previous' },
            pageSize: 12
        })).resolves.toEqual({
            teams: [
                { id: 'team-1', name: 'Austin Bats', sport: 'Soccer', city: 'Austin', state: 'TX', zip: '73301' }
            ],
            nextCursor: { id: 'team-1' }
        });

        expect(legacyMocks.discoverPublicTeams).toHaveBeenCalledWith({
            searchText: 'Austin',
            cursor: { id: 'previous' },
            pageSize: 12
        });
    });

    it('loads one public active team by id for deep-linked access requests', async () => {
        legacyMocks.getTeam.mockResolvedValue({
            id: 'team-late',
            name: 'Late Team',
            sport: 'Soccer',
            isPublic: true
        });

        await expect(loadParentAccessTeam('team-late')).resolves.toEqual({
            id: 'team-late',
            name: 'Late Team',
            sport: 'Soccer',
            city: '',
            state: '',
            zip: ''
        });

        expect(legacyMocks.getTeam).toHaveBeenCalledWith('team-late');
    });

    it('does not expose a private deep-linked team', async () => {
        legacyMocks.getTeam.mockResolvedValue({
            id: 'team-private',
            name: 'Private Team',
            isPublic: false
        });

        await expect(loadParentAccessTeam('team-private')).resolves.toBeNull();
    });
});
