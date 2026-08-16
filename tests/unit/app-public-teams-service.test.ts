import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    discoverPublicTeams: vi.fn(),
    getPublicTeamGamesProjection: vi.fn(),
    getPublicTeamProfile: vi.fn(),
    getPublicTeamRosterCount: vi.fn()
}));

vi.mock('../../apps/app/src/lib/adapters/legacyPublicTeamsDb', () => dbMocks);

import { getPublicTeamDetail, getPublicTeamStandingsInputs, getPublicTeamsByLocation, getPublicTeamsPage, hydratePublicTeamRosterCounts } from '../../apps/app/src/lib/publicTeamsService';

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

    it('maps lightweight public team pages without waiting for roster counts', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [{
                id: 'team-search-1',
                name: 'Austin Bats',
                sport: 'Baseball',
                photoUrl: 'https://example.com/team.png',
                city: 'Austin',
                state: 'TX',
                zip: '78701',
                appAccess: true,
                webAccess: false
            }],
            nextCursor: 'cursor-2'
        });
        dbMocks.getPublicTeamRosterCount.mockImplementation(() => new Promise(() => {}));

        await expect(getPublicTeamsPage({ searchText: 'Austin', includeRosterCounts: false })).resolves.toEqual({
            teams: [expect.objectContaining({
                teamId: 'team-search-1',
                teamName: 'Austin Bats',
                sport: 'Baseball',
                photoUrl: 'https://example.com/team.png',
                location: 'Austin, TX',
                city: 'Austin',
                state: 'TX',
                zip: '78701',
                appAccess: true,
                webAccess: false,
                isPublic: true,
                publicRosterCount: null,
                publicRosterCountCapped: false
            })],
            nextCursor: 'cursor-2'
        });
        expect(dbMocks.getPublicTeamRosterCount).not.toHaveBeenCalled();
    });

    it('hydrates lightweight teams six at a time and maps aggregation failures to unavailable', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: Array.from({ length: 7 }, (_, index) => ({
                id: `team-${index + 1}`,
                name: `Team ${index + 1}`
            })),
            nextCursor: null
        });
        const lightweightPage = await getPublicTeamsPage({ includeRosterCounts: false });
        let activeRequests = 0;
        let maxActiveRequests = 0;
        const pending: Array<{
            teamId: string;
            resolve: (value: { count: number; isCapped: boolean }) => void;
            reject: (reason: unknown) => void;
        }> = [];
        dbMocks.getPublicTeamRosterCount.mockImplementation((teamId: string) => new Promise((resolve, reject) => {
            activeRequests += 1;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            pending.push({
                teamId,
                resolve: (value) => {
                    activeRequests -= 1;
                    resolve(value);
                },
                reject: (reason) => {
                    activeRequests -= 1;
                    reject(reason);
                }
            });
        }));

        const hydration = hydratePublicTeamRosterCounts(lightweightPage.teams);

        expect(dbMocks.getPublicTeamRosterCount).toHaveBeenCalledTimes(6);
        const firstBatch = pending.splice(0, 6);
        firstBatch.forEach((request, index) => {
            if (request.teamId === 'team-3') {
                request.reject({ code: 'permission-denied' });
            } else {
                request.resolve({ count: index + 1, isCapped: request.teamId === 'team-6' });
            }
        });

        await vi.waitFor(() => expect(dbMocks.getPublicTeamRosterCount).toHaveBeenCalledTimes(7));
        expect(pending).toHaveLength(1);
        pending[0].resolve({ count: 7, isCapped: false });

        const hydratedTeams = await hydration;
        expect(maxActiveRequests).toBe(6);
        expect(hydratedTeams).toEqual([
            expect.objectContaining({ teamId: 'team-1', publicRosterCount: 1, publicRosterCountCapped: false }),
            expect.objectContaining({ teamId: 'team-2', publicRosterCount: 2, publicRosterCountCapped: false }),
            expect.objectContaining({ teamId: 'team-3', publicRosterCount: null, publicRosterCountCapped: false }),
            expect.objectContaining({ teamId: 'team-4', publicRosterCount: 4, publicRosterCountCapped: false }),
            expect.objectContaining({ teamId: 'team-5', publicRosterCount: 5, publicRosterCountCapped: false }),
            expect.objectContaining({ teamId: 'team-6', publicRosterCount: 6, publicRosterCountCapped: true }),
            expect.objectContaining({ teamId: 'team-7', publicRosterCount: 7, publicRosterCountCapped: false })
        ]);
    });

    it('shares the six-request roster limit across overlapping page hydrations', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: Array.from({ length: 8 }, (_, index) => ({
                id: `overlap-team-${index + 1}`,
                name: `Overlap Team ${index + 1}`
            })),
            nextCursor: null
        });
        const lightweightTeams = (await getPublicTeamsPage({ includeRosterCounts: false })).teams;
        let activeRequests = 0;
        let maxActiveRequests = 0;
        const pending: Array<{
            resolve: (value: { count: number; isCapped: boolean }) => void;
        }> = [];
        dbMocks.getPublicTeamRosterCount.mockImplementation(() => new Promise((resolve) => {
            activeRequests += 1;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            pending.push({
                resolve: (value) => {
                    activeRequests -= 1;
                    resolve(value);
                }
            });
        }));

        const firstHydration = hydratePublicTeamRosterCounts(lightweightTeams.slice(0, 4));
        const secondHydration = hydratePublicTeamRosterCounts(lightweightTeams.slice(4));

        await vi.waitFor(() => expect(dbMocks.getPublicTeamRosterCount).toHaveBeenCalledTimes(6));
        expect(maxActiveRequests).toBe(6);
        const firstRequests = pending.splice(0, 6);
        firstRequests.forEach((request) => request.resolve({ count: 1, isCapped: false }));

        await vi.waitFor(() => expect(dbMocks.getPublicTeamRosterCount).toHaveBeenCalledTimes(8));
        pending.splice(0).forEach((request) => request.resolve({ count: 1, isCapped: false }));
        await Promise.all([firstHydration, secondHydration]);

        expect(maxActiveRequests).toBe(6);
    });

    it('removes aborted queued hydration so newer roster counts take the next free slot', async () => {
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: Array.from({ length: 11 }, (_, index) => ({
                id: `queued-team-${index + 1}`,
                name: `Queued Team ${index + 1}`
            })),
            nextCursor: null
        });
        const lightweightTeams = (await getPublicTeamsPage({ includeRosterCounts: false })).teams;
        let activeRequests = 0;
        let maxActiveRequests = 0;
        const requests: Array<{
            teamId: string;
            resolve: (value: { count: number; isCapped: boolean }) => void;
        }> = [];
        dbMocks.getPublicTeamRosterCount.mockImplementation((teamId: string) => new Promise((resolve) => {
            activeRequests += 1;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            requests.push({
                teamId,
                resolve: (value) => {
                    activeRequests -= 1;
                    resolve(value);
                }
            });
        }));

        const blockingHydration = hydratePublicTeamRosterCounts(lightweightTeams.slice(0, 6));
        const obsoleteController = new AbortController();
        const obsoleteHydration = hydratePublicTeamRosterCounts(lightweightTeams.slice(6, 9), {
            signal: obsoleteController.signal
        });
        const currentHydration = hydratePublicTeamRosterCounts(lightweightTeams.slice(9));

        expect(dbMocks.getPublicTeamRosterCount).toHaveBeenCalledTimes(6);
        obsoleteController.abort();
        await expect(obsoleteHydration).resolves.toEqual(lightweightTeams.slice(6, 9));
        expect(dbMocks.getPublicTeamRosterCount).toHaveBeenCalledTimes(6);

        requests[0].resolve({ count: 1, isCapped: false });
        await vi.waitFor(() => expect(dbMocks.getPublicTeamRosterCount).toHaveBeenCalledTimes(7));
        expect(requests[6].teamId).toBe('queued-team-10');
        expect(maxActiveRequests).toBe(6);

        requests.slice(1, 7).forEach((request) => request.resolve({ count: 1, isCapped: false }));
        await vi.waitFor(() => expect(dbMocks.getPublicTeamRosterCount).toHaveBeenCalledTimes(8));
        expect(requests[7].teamId).toBe('queued-team-11');
        requests[7].resolve({ count: 1, isCapped: false });

        await Promise.all([blockingHydration, currentHydration]);
        expect(maxActiveRequests).toBe(6);
        expect(dbMocks.getPublicTeamRosterCount).not.toHaveBeenCalledWith('queued-team-7');
        expect(dbMocks.getPublicTeamRosterCount).not.toHaveBeenCalledWith('queued-team-8');
        expect(dbMocks.getPublicTeamRosterCount).not.toHaveBeenCalledWith('queued-team-9');
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
            isPublic: true,
            active: true,
            sport: 'Baseball',
            description: 'Community baseball team.',
            photoUrl: 'https://example.com/team.png',
            city: 'Austin',
            state: 'TX',
            zip: '78701',
            leagueUrl: 'https://league.example.test/standings',
            standingsConfig: {
                enabled: true,
                rankingMode: 'win_pct',
                points: { win: 5, tie: 2, loss: -1, overtime: 1 },
                maxGoalDiff: 7,
                tiebreakers: ['head_to_head', 'point_diff'],
                twoTeamTiebreakers: ['head_to_head'],
                multiTeamTiebreakers: ['group_head_to_head', 'point_diff'],
                privateFormula: 'do-not-expose'
            },
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
            location: 'Austin, TX',
            leagueUrl: 'https://league.example.test/standings',
            standingsConfig: {
                enabled: true,
                rankingMode: 'win_pct',
                points: { win: 5, tie: 2, loss: -1 },
                maxGoalDiff: 7,
                tiebreakers: ['head_to_head', 'point_diff'],
                twoTeamTiebreakers: ['head_to_head'],
                multiTeamTiebreakers: ['group_head_to_head', 'point_diff']
            }
        });
        expect(dbMocks.getPublicTeamProfile).toHaveBeenCalledWith('team-public-1');
    });

    it('fails closed for managed private profiles and unsafe league configuration', async () => {
        dbMocks.getPublicTeamProfile
            .mockResolvedValueOnce({
                id: 'team-private-1',
                name: 'Private Bats',
                isPublic: false,
                active: true,
                leagueUrl: 'https://league.example.test/private'
            })
            .mockResolvedValueOnce({
                id: 'team-public-1',
                name: 'Austin Bats',
                isPublic: true,
                active: true,
                leagueUrl: 'https://user:secret@league.example.test/standings',
                standingsConfig: {
                    enabled: true,
                    rankingMode: 'unexpected',
                    points: { win: '3', tie: 1, loss: 0 },
                    maxGoalDiff: -4,
                    tiebreakers: ['head_to_head', '', 42],
                    twoTeamTiebreakers: 'not-an-array'
                }
            });

        await expect(getPublicTeamDetail('team-private-1')).rejects.toThrow('Public team not found.');
        await expect(getPublicTeamDetail('team-public-1')).resolves.toEqual(expect.objectContaining({
            leagueUrl: null,
            standingsConfig: {
                enabled: true,
                rankingMode: 'points',
                points: { win: null, tie: 1, loss: 0 },
                maxGoalDiff: null,
                tiebreakers: ['head_to_head'],
                twoTeamTiebreakers: [],
                multiTeamTiebreakers: []
            }
        }));
    });

    it('rejects a public profile whose identity does not match the request', async () => {
        dbMocks.getPublicTeamProfile.mockResolvedValue({
            id: 'team-other',
            name: 'Other Team',
            isPublic: true,
            active: true
        });

        await expect(getPublicTeamDetail('team-public-1')).rejects.toThrow('Public team not found.');
    });

    it('normalizes completed public home and away games into native standings inputs', async () => {
        dbMocks.getPublicTeamGamesProjection.mockResolvedValue({
            team: { id: 'team-public-1', name: 'Austin Bats' },
            games: [
                {
                    id: 'home-final',
                    startsAt: '2026-08-01T18:00:00.000Z',
                    opponent: 'Owls',
                    isHome: true,
                    status: 'completed',
                    teamScore: 4,
                    opponentScore: 1,
                    tournament: {
                        divisionName: '10U Gold',
                        poolName: 'Pool A',
                        bracketAdminNotes: 'private'
                    },
                    summary: 'must not cross the standings boundary'
                },
                {
                    id: 'away-tie',
                    startsAt: '2026-08-02T18:00:00.000Z',
                    opponent: 'Foxes',
                    isHome: false,
                    status: 'final',
                    liveStatus: 'completed',
                    teamScore: 0,
                    opponentScore: 0,
                    tournament: { division: '10U', poolName: 'Pool B' }
                }
            ]
        });

        await expect(getPublicTeamStandingsInputs('team-public-1')).resolves.toEqual([
            {
                id: 'home-final',
                date: new Date('2026-08-01T18:00:00.000Z'),
                homeTeam: 'Austin Bats',
                awayTeam: 'Owls',
                homeScore: 4,
                awayScore: 1,
                status: 'completed',
                tournament: { divisionName: '10U Gold', poolName: 'Pool A' }
            },
            {
                id: 'away-tie',
                date: new Date('2026-08-02T18:00:00.000Z'),
                homeTeam: 'Foxes',
                awayTeam: 'Austin Bats',
                homeScore: 0,
                awayScore: 0,
                status: 'completed',
                tournament: { division: '10U', poolName: 'Pool B' }
            }
        ]);
        expect(dbMocks.getPublicTeamGamesProjection).toHaveBeenCalledWith('team-public-1');
    });

    it('excludes non-public, non-final, practice, private, mismatched, and malformed projections', async () => {
        const validGame = {
            startsAt: '2026-08-01T18:00:00.000Z',
            opponent: 'Owls',
            status: 'completed',
            teamScore: 2,
            opponentScore: 1
        };
        dbMocks.getPublicTeamGamesProjection.mockResolvedValue({
            team: { id: 'team-public-1', name: 'Austin Bats' },
            games: [
                { ...validGame, id: 'valid' },
                { ...validGame, id: 'scheduled', status: 'scheduled' },
                { ...validGame, id: 'live-status', status: 'live' },
                { ...validGame, id: 'live-marker', liveStatus: 'live' },
                { ...validGame, id: 'practice', type: 'practice' },
                { ...validGame, id: 'private-visibility', visibility: 'private' },
                { ...validGame, id: 'is-private', isPrivate: true },
                { ...validGame, id: 'private', private: true },
                { ...validGame, id: 'deleted', deleted: true },
                { ...validGame, id: 'wrong-team', teamId: 'team-other' },
                { ...validGame, id: 'bad-date', startsAt: 'not-a-date' },
                { ...validGame, id: 'no-opponent', opponent: '' },
                { ...validGame, id: 'missing-score', teamScore: null },
                { ...validGame, id: 'numeric-string', teamScore: '2' },
                { ...validGame, id: 'negative-score', teamScore: -1 },
                { ...validGame, id: 'infinite-score', teamScore: Number.POSITIVE_INFINITY }
            ]
        });

        const result = await getPublicTeamStandingsInputs('team-public-1');

        expect(result.map((game) => game.id)).toEqual(['valid']);
        expect(JSON.stringify(result)).not.toContain('private');
    });

    it('rejects mismatched and non-public team projection responses without fallback', async () => {
        dbMocks.getPublicTeamGamesProjection
            .mockResolvedValueOnce({ team: { id: 'team-other', name: 'Other Team' }, games: [] })
            .mockRejectedValueOnce(Object.assign(new Error('Public team not found.'), { code: 'functions/not-found' }));

        await expect(getPublicTeamStandingsInputs('team-public-1')).rejects.toThrow('Public team not found.');
        await expect(getPublicTeamStandingsInputs('team-private-1')).rejects.toMatchObject({ code: 'functions/not-found' });
        expect(dbMocks.getPublicTeamGamesProjection).toHaveBeenCalledTimes(2);
    });
});
