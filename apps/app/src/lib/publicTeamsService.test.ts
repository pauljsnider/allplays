import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    discoverPublicTeams: vi.fn(),
    getPublicTeamProfile: vi.fn(),
    getPublicTeamRosterCount: vi.fn()
}));

vi.mock('./adapters/legacyPublicTeamsDb', () => dbMocks);

import { getPublicTeamDetail, getPublicTeamsByLocation, getPublicTeamsPage } from './publicTeamsService';

describe('publicTeamsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMocks.getPublicTeamRosterCount.mockResolvedValue({ count: 0, isCapped: false });
    });

    it('hydrates public cards from bounded roster counts instead of the empty linked-player array', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [{ id: 'team-roster-1', name: 'AI Score Reader', zip: '64131' }],
            nextCursor: null
        });
        dbMocks.getPublicTeamRosterCount.mockResolvedValue({ count: 10, isCapped: false });

        await expect(getPublicTeamsPage()).resolves.toEqual({
            teams: [expect.objectContaining({
                teamId: 'team-roster-1',
                players: [],
                publicRosterCount: 10,
                publicRosterCountCapped: false
            })],
            nextCursor: null
        });
        expect(dbMocks.getPublicTeamRosterCount).toHaveBeenCalledWith('team-roster-1');
    });

    it('omits a roster count when public aggregation access is denied', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [{ id: 'team-legacy-private-fields', name: 'Legacy Team', zip: '64131' }],
            nextCursor: null
        });
        dbMocks.getPublicTeamRosterCount.mockRejectedValue({ code: 'permission-denied' });

        await expect(getPublicTeamsPage()).resolves.toEqual({
            teams: [expect.objectContaining({
                teamId: 'team-legacy-private-fields',
                publicRosterCount: null,
                publicRosterCountCapped: false
            })],
            nextCursor: null
        });
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

    it('accepts nullable location fields from legacy public team results', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [
                {
                    id: 'team-null-location-1',
                    name: 'Null Location FC',
                    city: null,
                    state: null,
                    zip: '73301'
                }
            ],
            nextCursor: null
        });

        await expect(getPublicTeamsPage({ searchText: '73301' })).resolves.toEqual({
            teams: [
                expect.objectContaining({
                    teamId: 'team-null-location-1',
                    location: '73301',
                    city: null,
                    state: null,
                    zip: '73301'
                })
            ],
            nextCursor: null
        });
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

    it('still matches short text prefixes before treating two-letter searches as state codes', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [
                {
                    id: 'team-bears-1',
                    name: 'Bears',
                    city: 'Kansas City',
                    state: 'MO'
                },
                {
                    id: 'team-state-1',
                    name: 'Wildcats',
                    city: 'Wichita',
                    state: 'BE'
                }
            ],
            nextCursor: null
        });

        await expect(getPublicTeamsPage({ searchText: 'be' })).resolves.toEqual({
            teams: [
                expect.objectContaining({
                    teamId: 'team-bears-1',
                    teamName: 'Bears'
                }),
                expect.objectContaining({
                    teamId: 'team-state-1',
                    teamName: 'Wildcats'
                })
            ],
            nextCursor: null
        });
    });

    it('trims generic search text before hitting the bounded discovery helper', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [],
            nextCursor: null
        });

        await getPublicTeamsPage({ searchText: '  Atlanta United  ' });

        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledWith({ searchText: 'Atlanta United', cursor: null, pageSize: 24 });
    });

    it('defensively filters over-broad public browse results against the active search text', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [
                {
                    id: 'team-ai-1',
                    name: 'AI Score Reader',
                    city: 'Kansas City',
                    state: 'MO',
                    zip: '64131'
                },
                {
                    id: 'team-bbb-1',
                    name: 'bbb',
                    city: 'Kansas City',
                    state: 'MO',
                    zip: '64113'
                },
                {
                    id: 'team-blake-1',
                    name: 'Blake\'s Basketball',
                    city: 'Overland Park',
                    state: 'KS',
                    zip: '66210'
                }
            ],
            nextCursor: null
        });

        await expect(getPublicTeamsPage({ searchText: 'AI Score Reader' })).resolves.toEqual({
            teams: [
                expect.objectContaining({
                    teamId: 'team-ai-1',
                    teamName: 'AI Score Reader'
                })
            ],
            nextCursor: null
        });

        await expect(getPublicTeamsPage({ searchText: 'zzzznotateam64131' })).resolves.toEqual({
            teams: [],
            nextCursor: null
        });
    });

    it('maps only the allow-listed callable profile fields for public detail', async () => {
        dbMocks.getPublicTeamProfile.mockResolvedValue({
            id: 'team-public-1',
            name: 'Austin Bats',
            sport: 'Baseball',
            description: 'Community baseball team.',
            photoUrl: 'https://example.com/team.png',
            city: 'Austin',
            state: 'TX',
            zip: '78701',
            ownerId: 'private-owner',
            adminEmails: ['private@example.com']
        });

        await expect(getPublicTeamDetail('team-public-1')).resolves.toEqual({
            id: 'team-public-1',
            name: 'Austin Bats',
            sport: 'Baseball',
            description: 'Community baseball team.',
            photoUrl: 'https://example.com/team.png',
            city: 'Austin',
            state: 'TX',
            zip: '78701',
            location: 'Austin, TX'
        });
        expect(dbMocks.getPublicTeamProfile).toHaveBeenCalledWith('team-public-1');
    });
});
