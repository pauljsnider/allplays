import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    ADMIN_TEAM_OFFICIALS_COVERAGE_DAYS,
    buildAdminTeamOfficialsCoverageWindow,
    buildAdminTeamOfficialsSummary,
    loadAdminTeamOfficialsCoverageGames
} from '../../js/admin-team-officials.js';

function ts(date) {
    return { toDate: () => new Date(date) };
}

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('admin team officials summary', () => {
    it('marks teams without a directory and flags uncovered upcoming games', () => {
        const summary = buildAdminTeamOfficialsSummary(
            { id: 'team-1' },
            [],
            [
                {
                    id: 'game-1',
                    teamId: 'team-1',
                    date: ts('2099-05-01T10:00:00Z'),
                    officiatingSlots: [
                        { position: 'Referee', officialEmail: 'ref@example.com', status: 'accepted' },
                        { position: 'AR1', status: 'open' }
                    ]
                }
            ],
            { referenceDate: new Date('2099-04-01T00:00:00Z') }
        );

        expect(summary).toMatchObject({
            officialCount: 0,
            badgeTone: 'missing',
            badgeLabel: 'No officials',
            upcomingGameCount: 1,
            attentionGameCount: 1,
            detailTone: 'warning',
            detailLabel: 'Next 90 days: 1 of 1 upcoming game needs attention'
        });
    });

    it('shows covered upcoming games when staffing is complete', () => {
        const summary = buildAdminTeamOfficialsSummary(
            { id: 'team-2' },
            [{ id: 'official-1' }, { id: 'official-2' }],
            [
                {
                    id: 'game-1',
                    teamId: 'team-2',
                    date: ts('2099-05-01T10:00:00Z'),
                    officiatingSlots: [
                        { position: 'Referee', officialEmail: 'ref@example.com', status: 'accepted' }
                    ]
                },
                {
                    id: 'game-2',
                    teamId: 'team-2',
                    date: ts('2099-05-02T10:00:00Z'),
                    officiatingCoverageStatus: 'covered',
                    officiatingSlots: [
                        { position: 'Referee', officialEmail: 'ref2@example.com', status: 'accepted' }
                    ]
                }
            ],
            { referenceDate: new Date('2099-04-01T00:00:00Z') }
        );

        expect(summary).toMatchObject({
            officialCount: 2,
            badgeTone: 'good',
            badgeLabel: '2 officials',
            upcomingGameCount: 2,
            coveredGameCount: 2,
            detailTone: 'good',
            detailLabel: 'Next 90 days: 2 upcoming games covered'
        });
    });

    it('excludes games outside the declared coverage horizon and communicates the window', () => {
        const referenceDate = new Date('2099-04-01T00:00:00Z');
        const historicalGames = Array.from({ length: 250 }, (_, index) => ({
            id: `historical-${index}`,
            teamId: 'team-3',
            date: ts(`20${String(index % 50).padStart(2, '0')}-01-01T00:00:00Z`),
            officiatingSlots: [{ position: 'Referee', status: 'open' }]
        }));
        const summary = buildAdminTeamOfficialsSummary(
            { id: 'team-3' },
            [{ id: 'official-1' }],
            [
                ...historicalGames,
                {
                    id: 'covered-in-window',
                    teamId: 'team-3',
                    date: ts('2099-05-01T10:00:00Z'),
                    officiatingCoverageStatus: 'covered',
                    officiatingSlots: [{ position: 'Referee', status: 'accepted' }]
                },
                {
                    id: 'uncovered-outside-window',
                    teamId: 'team-3',
                    date: ts('2099-07-15T10:00:00Z'),
                    officiatingSlots: [{ position: 'Referee', status: 'open' }]
                },
                {
                    id: 'cancelled-in-window',
                    teamId: 'team-3',
                    date: ts('2099-05-02T10:00:00Z'),
                    status: 'cancelled',
                    officiatingSlots: [{ position: 'Referee', status: 'open' }]
                }
            ],
            { referenceDate }
        );

        expect(ADMIN_TEAM_OFFICIALS_COVERAGE_DAYS).toBe(90);
        expect(buildAdminTeamOfficialsCoverageWindow(referenceDate)).toEqual({
            startDate: referenceDate,
            endDate: new Date('2099-06-30T00:00:00Z')
        });
        expect(summary).toMatchObject({
            upcomingGameCount: 1,
            coveredGameCount: 1,
            attentionGameCount: 0,
            detailTone: 'good',
            detailLabel: 'Next 90 days: 1 upcoming game covered'
        });
    });

    it('loads multiple teams through bounded requests while preserving coverage totals', async () => {
        const referenceDate = new Date('2099-04-01T00:00:00Z');
        const teams = [
            { id: 'team-1', name: 'Tigers' },
            { id: 'team-2', name: 'Bears' }
        ];
        const historicalGames = Array.from({ length: 200 }, (_, index) => ({
            id: `historical-${index}`,
            date: ts(`20${String(index % 50).padStart(2, '0')}-01-01T00:00:00Z`),
            officiatingSlots: [{ position: 'Referee', status: 'open' }]
        }));
        const fixtures = new Map([
            ['team-1', [
                ...historicalGames,
                {
                    id: 'team-1-covered',
                    date: ts('2099-05-01T10:00:00Z'),
                    officiatingCoverageStatus: 'covered',
                    officiatingSlots: [{ position: 'Referee', status: 'accepted' }]
                }
            ]],
            ['team-2', [
                ...historicalGames,
                {
                    id: 'team-2-open',
                    date: ts('2099-05-02T10:00:00Z'),
                    officiatingSlots: [{ position: 'Referee', status: 'open' }]
                },
                {
                    id: 'team-2-beyond-horizon',
                    date: ts('2099-07-15T10:00:00Z'),
                    officiatingSlots: [{ position: 'Referee', status: 'open' }]
                }
            ]]
        ]);
        const requests = [];
        const games = await loadAdminTeamOfficialsCoverageGames(teams, async (teamId, options) => {
            requests.push({ teamId, options });
            return fixtures.get(teamId).filter((game) => {
                const date = game.date.toDate();
                return date >= options.startDate && date <= options.endDate;
            });
        }, { referenceDate });

        expect(requests).toEqual(teams.map((team) => ({
            teamId: team.id,
            options: {
                startDate: referenceDate,
                endDate: new Date('2099-06-30T00:00:00Z')
            }
        })));
        expect(games).toHaveLength(2);
        expect(buildAdminTeamOfficialsSummary(teams[0], [], games, { referenceDate })).toMatchObject({
            upcomingGameCount: 1,
            coveredGameCount: 1,
            attentionGameCount: 0
        });
        expect(buildAdminTeamOfficialsSummary(teams[1], [], games, { referenceDate })).toMatchObject({
            upcomingGameCount: 1,
            coveredGameCount: 0,
            attentionGameCount: 1
        });
    });

    it('wires the admin teams table and manage officials entrypoint', () => {
        const adminHtml = readSource('admin.html');
        const adminJs = readSource('js/admin.js');
        const helperJs = readSource('js/admin-team-officials.js');
        const scheduleHtml = readSource('edit-schedule.html');

        expect(adminHtml).toContain('Officials</th>');
        expect(adminJs).toContain("import { buildAdminTeamOfficialsSummary, loadAdminTeamOfficialsCoverageGames } from './admin-team-officials.js?v=3';");
        expect(adminJs).toContain('Manage Officials');
        expect(adminJs).toContain("edit-schedule.html?teamId=${encodeURIComponent(team.id)}#officials");
        expect(helperJs).toContain('No officials');
        expect(scheduleHtml).toContain("if (window.location.hash === '#officials') {");
        expect(scheduleHtml).toContain('window.addEventListener(\'hashchange\', switchTabFromHash);');
    });
});
