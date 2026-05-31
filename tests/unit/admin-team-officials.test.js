import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAdminTeamOfficialsSummary } from '../../js/admin-team-officials.js';

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
            ]
        );

        expect(summary).toMatchObject({
            officialCount: 0,
            badgeTone: 'missing',
            badgeLabel: 'No officials',
            upcomingGameCount: 1,
            attentionGameCount: 1,
            detailTone: 'warning',
            detailLabel: '1 of 1 upcoming game needs attention'
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
            ]
        );

        expect(summary).toMatchObject({
            officialCount: 2,
            badgeTone: 'good',
            badgeLabel: '2 officials',
            upcomingGameCount: 2,
            coveredGameCount: 2,
            detailTone: 'good',
            detailLabel: '2 upcoming games covered'
        });
    });

    it('wires the admin teams table and manage officials entrypoint', () => {
        const adminHtml = readSource('admin.html');
        const adminJs = readSource('js/admin.js');
        const helperJs = readSource('js/admin-team-officials.js');
        const scheduleHtml = readSource('edit-schedule.html');

        expect(adminHtml).toContain('Officials</th>');
        expect(adminJs).toContain("import { buildAdminTeamOfficialsSummary } from './admin-team-officials.js?v=1';");
        expect(adminJs).toContain('Manage Officials');
        expect(adminJs).toContain("edit-schedule.html?teamId=${encodeURIComponent(team.id)}#officials");
        expect(helperJs).toContain('No officials');
        expect(scheduleHtml).toContain("if (window.location.hash === '#officials') {");
        expect(scheduleHtml).toContain('window.addEventListener(\'hashchange\', switchTabFromHash);');
    });
});
