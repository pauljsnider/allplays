import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildOrganizationSharedGamePayload,
    getOrganizationTeams,
    validateOrganizationMatchup
} from '../../js/organization-schedule.js';

describe('organization schedule helpers', () => {
    const accessibleTeams = [
        { id: 'team-1', name: 'Alpha', ownerId: 'org-1', photoUrl: 'alpha.png' },
        { id: 'team-2', name: 'Bravo', ownerId: 'org-1', photoUrl: 'bravo.png' },
        { id: 'team-3', name: 'Charlie', ownerId: 'org-2', photoUrl: 'charlie.png' }
    ];

    it('limits organization teams to the current owner grouping', () => {
        expect(getOrganizationTeams({
            accessibleTeams,
            organizationOwnerId: 'org-1'
        })).toEqual([
            { id: 'team-1', name: 'Alpha', ownerId: 'org-1', photoUrl: 'alpha.png' },
            { id: 'team-2', name: 'Bravo', ownerId: 'org-1', photoUrl: 'bravo.png' }
        ]);
    });

    it('rejects same-team and wrong-organization selections', () => {
        expect(validateOrganizationMatchup({
            homeTeamId: 'team-1',
            awayTeamId: 'team-1',
            organizationTeams: accessibleTeams,
            organizationOwnerId: 'org-1'
        })).toMatchObject({
            ok: false,
            error: 'Choose two different teams for the shared matchup.'
        });

        expect(validateOrganizationMatchup({
            homeTeamId: 'team-1',
            awayTeamId: 'team-3',
            organizationTeams: accessibleTeams,
            organizationOwnerId: 'org-1'
        })).toMatchObject({
            ok: false,
            error: 'Both teams must belong to the current organization.'
        });
    });

    it('builds a mirrored shared-game payload for the selected away team', () => {
        const Timestamp = {
            fromDate: (value) => ({ iso: value.toISOString() })
        };

        expect(buildOrganizationSharedGamePayload({
            awayTeam: accessibleTeams[1],
            gameDate: '2026-06-20T18:30',
            location: 'Field 2',
            arrivalTime: '2026-06-20T17:45',
            notes: 'Bring white uniforms',
            Timestamp
        })).toEqual({
            type: 'game',
            status: 'scheduled',
            date: { iso: '2026-06-20T18:30:00.000Z' },
            opponent: 'Bravo',
            opponentTeamId: 'team-2',
            opponentTeamName: 'Bravo',
            opponentTeamPhoto: 'bravo.png',
            location: 'Field 2',
            arrivalTime: { iso: '2026-06-20T17:45:00.000Z' },
            notes: 'Bring white uniforms',
            isHome: true,
            homeScore: 0,
            awayScore: 0
        });
    });

    it('exposes the organization schedule entry point from team schedule', () => {
        const source = readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');

        expect(source).toContain('id="organization-schedule-link"');
        expect(source).toContain('organization-schedule.html#teamId=${currentTeamId}');
    });

    it('renders organization schedule team options without injecting HTML strings', () => {
        const source = readFileSync(new URL('../../organization-schedule.html', import.meta.url), 'utf8');

        expect(source).toContain("const option = document.createElement('option');");
        expect(source).toContain('option.textContent = team.name;');
        expect(source).not.toContain('selectEl.innerHTML = teams.map');
    });

    it('renders shared matchup success actions without using innerHTML', () => {
        const source = readFileSync(new URL('../../organization-schedule.html', import.meta.url), 'utf8');

        expect(source).toContain('successAlert.replaceChildren();');
        expect(source).toContain("const homeLink = document.createElement('a');");
        expect(source).not.toContain('successAlert.innerHTML =');
    });
});
