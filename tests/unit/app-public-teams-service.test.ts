import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    discoverPublicTeams: vi.fn(),
    getPublicLeagueStandingsProjection: vi.fn(),
    getPublicTeamGamesProjection: vi.fn(),
    getPublicTeamProfile: vi.fn(),
    getPublicTeamRosterCount: vi.fn()
}));

vi.mock('../../apps/app/src/lib/adapters/legacyPublicTeamsDb', () => dbMocks);

import { getPublicTeamDetail, getPublicTeamResults, getPublicTeamsByLocation, getPublicTeamsPage, hydratePublicTeamRosterCounts } from '../../apps/app/src/lib/publicTeamsService';

describe('publicTeamsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMocks.getPublicTeamRosterCount.mockResolvedValue({ count: 0, isCapped: false });
        dbMocks.getPublicLeagueStandingsProjection.mockResolvedValue(null);
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
                points: { win: 5, tie: 2, loss: -1 },
                maxGoalDiff: 7,
                tiebreakers: ['head_to_head', 'point_diff'],
                twoTeamTiebreakers: ['head_to_head'],
                multiTeamTiebreakers: ['group_head_to_head', 'point_diff'],
                seasonLabel: 'Fall 2026',
                seasonStart: '2026-07-15',
                seasonEnd: '2026-11-30',
                leagueTeamIds: ['team-public-1', 'team-owls', 'team-foxes']
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
                multiTeamTiebreakers: ['group_head_to_head', 'point_diff'],
                seasonLabel: 'Fall 2026',
                seasonStart: '2026-07-15',
                seasonEnd: '2026-11-30',
                leagueTeamIds: ['team-public-1', 'team-owls', 'team-foxes']
            }
        });
        expect(dbMocks.getPublicTeamProfile).toHaveBeenCalledWith('team-public-1');
    });

    it('drops unsafe league links and normalizes malformed standings metadata', async () => {
        dbMocks.getPublicTeamProfile.mockResolvedValue({
            id: 'team-public-1',
            name: 'Austin Bats',
            leagueUrl: 'javascript:alert(1)',
            standingsConfig: {
                enabled: true,
                rankingMode: 'unexpected',
                points: { win: 'bad', tie: 1, loss: 0 },
                maxGoalDiff: -2,
                tiebreakers: ['head_to_head', '', 42]
            }
        });

        await expect(getPublicTeamDetail('team-public-1')).resolves.toEqual(expect.objectContaining({
            leagueUrl: null,
            standingsConfig: {
                enabled: true,
                rankingMode: 'points',
                points: { win: null, tie: 1, loss: 0 },
                maxGoalDiff: null,
                tiebreakers: ['head_to_head'],
                twoTeamTiebreakers: [],
                multiTeamTiebreakers: [],
                seasonLabel: null,
                seasonStart: null,
                seasonEnd: null,
                leagueTeamIds: []
            }
        }));
    });

    it('computes season-bounded standings from a complete league schedule and keeps five recent team results', async () => {
        const team = {
            id: 'team-public-1',
            name: 'Austin Bats',
            sport: 'Baseball',
            description: null,
            photoUrl: null,
            city: 'Austin',
            state: 'TX',
            zip: '78701',
            location: 'Austin, TX',
            leagueUrl: null,
            standingsConfig: {
                enabled: true,
                rankingMode: 'points' as const,
                points: { win: 4, tie: 2, loss: 0 },
                maxGoalDiff: 5,
                tiebreakers: ['point_diff'],
                twoTeamTiebreakers: ['head_to_head'],
                multiTeamTiebreakers: ['group_head_to_head'],
                seasonLabel: 'Fall 2026',
                seasonStart: '2026-07-15',
                seasonEnd: '2026-11-30',
                leagueTeamIds: ['team-public-1', 'team-owls', 'team-foxes']
            }
        };
        const qualifyingGames = Array.from({ length: 6 }, (_, index) => ({
            id: `final-${index + 1}`,
            startsAt: `2026-08-${String(index + 1).padStart(2, '0')}T18:00:00.000Z`,
            opponent: `Opponent ${index + 1}`,
            isHome: index % 2 === 0,
            status: 'completed',
            teamScore: index + 3,
            opponentScore: index + 1,
            result: 'loss'
        }));
        dbMocks.getPublicTeamGamesProjection.mockResolvedValue({
            range: { truncated: false },
            games: [
                ...qualifyingGames,
                { id: 'scheduled', startsAt: '2026-08-10T18:00:00.000Z', opponent: 'Scheduled Team', status: 'scheduled', teamScore: 9, opponentScore: 1 },
                { id: 'live', startsAt: '2026-08-11T18:00:00.000Z', opponent: 'Live Team', status: 'live', teamScore: 3, opponentScore: 2 },
                { id: 'practice', type: 'practice', startsAt: '2026-08-12T18:00:00.000Z', opponent: 'Practice Team', status: 'completed', teamScore: 4, opponentScore: 1 },
                { id: 'private', visibility: 'private', startsAt: '2026-08-13T18:00:00.000Z', opponent: 'Private Team', status: 'completed', teamScore: 4, opponentScore: 1 },
                { id: 'deleted', deleted: true, startsAt: '2026-08-13T19:00:00.000Z', opponent: 'Deleted Team', status: 'completed', teamScore: 4, opponentScore: 1 },
                { id: 'missing-score', startsAt: '2026-08-14T18:00:00.000Z', opponent: 'Missing Score', status: 'completed', teamScore: 4, opponentScore: null },
                { id: 'bad-date', startsAt: 'not-a-date', opponent: 'Bad Date', status: 'completed', teamScore: 4, opponentScore: 1 },
                { id: 'negative', startsAt: '2026-08-14T18:00:00.000Z', opponent: 'Negative Score', status: 'completed', teamScore: -1, opponentScore: 1 },
                { id: 'friendly', startsAt: '2026-08-14T17:00:00.000Z', opponent: 'Friendly FC', status: 'completed', teamScore: 2, opponentScore: 2, countsTowardSeasonRecord: false }
            ]
        });
        dbMocks.getPublicLeagueStandingsProjection.mockResolvedValue({
            range: { from: '2026-07-15', to: '2026-11-30', truncated: false },
            seasonLabel: 'Fall 2026',
            games: [
                { id: 'bats-owls', startsAt: '2026-08-01T18:00:00.000Z', homeTeam: 'Austin Bats', awayTeam: 'Owls', homeScore: 3, awayScore: 1, status: 'completed', countsTowardSeasonRecord: true },
                { id: 'foxes-bats', startsAt: '2026-08-08T18:00:00.000Z', homeTeam: 'Foxes', awayTeam: 'Austin Bats', homeScore: 2, awayScore: 4, status: 'completed', countsTowardSeasonRecord: true },
                { id: 'owls-foxes', startsAt: '2026-08-12T18:00:00.000Z', homeTeam: 'Owls', awayTeam: 'Foxes', homeScore: 5, awayScore: 0, status: 'completed', countsTowardSeasonRecord: true },
                { id: 'prior-season', startsAt: '2026-06-30T18:00:00.000Z', homeTeam: 'Owls', awayTeam: 'Foxes', homeScore: 0, awayScore: 9, status: 'completed', countsTowardSeasonRecord: true },
                { id: 'exhibition', startsAt: '2026-08-20T18:00:00.000Z', homeTeam: 'Foxes', awayTeam: 'Owls', homeScore: 9, awayScore: 0, status: 'completed', countsTowardSeasonRecord: false }
            ]
        });

        const result = await getPublicTeamResults(team, new Date('2026-08-14T22:00:00.000Z'));

        expect(dbMocks.getPublicTeamGamesProjection).toHaveBeenCalledWith('team-public-1', {
            from: '2026-07-15',
            to: '2026-11-30',
            limit: 500
        });
        expect(dbMocks.getPublicLeagueStandingsProjection).toHaveBeenCalledWith('team-public-1');
        expect(result.standings).toEqual(expect.objectContaining({
            enabled: true,
            label: 'Points table',
            currentRow: expect.objectContaining({ rank: 1, team: 'Austin Bats', record: '2-0', points: 8 })
        }));
        expect(result.standings.rows.map((row) => [row.rank, row.team, row.record, row.points])).toEqual([
            [1, 'Austin Bats', '2-0', 8],
            [2, 'Owls', '1-1', 4],
            [3, 'Foxes', '0-2', 0]
        ]);
        expect(result.recentResults).toHaveLength(5);
        expect(result.recentResults.map((game) => game.opponent)).toEqual([
            'Friendly FC',
            'Opponent 6',
            'Opponent 5',
            'Opponent 4',
            'Opponent 3'
        ]);
        expect(result.recentResults[0]).toEqual(expect.objectContaining({
            teamScore: 2,
            opponentScore: 2,
            result: 'Tie'
        }));
        expect(JSON.stringify(result)).not.toContain('Private Team');
        expect(JSON.stringify(result)).not.toContain('Deleted Team');
        expect(JSON.stringify(result)).not.toContain('Practice Team');
        expect(JSON.stringify(result)).not.toContain('Scheduled Team');
        expect(JSON.stringify(result)).not.toContain('Live Team');
    });

    it('rejects truncated projections instead of presenting partial standings', async () => {
        dbMocks.getPublicTeamGamesProjection.mockResolvedValue({
            range: { truncated: true },
            games: [{
                id: 'partial-final',
                startsAt: '2026-08-01T18:00:00.000Z',
                opponent: 'Partial Team',
                status: 'completed',
                teamScore: 2,
                opponentScore: 1
            }]
        });

        await expect(getPublicTeamResults({
            id: 'team-public-1',
            name: 'Austin Bats',
            sport: null,
            description: null,
            photoUrl: null,
            city: null,
            state: null,
            zip: null,
            location: null,
            leagueUrl: null,
            standingsConfig: null
        }, new Date('2026-08-14T22:00:00.000Z'))).rejects.toThrow('complete public results');
        expect(dbMocks.getPublicLeagueStandingsProjection).not.toHaveBeenCalled();
    });
});
