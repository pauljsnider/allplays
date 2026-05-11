import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildBlackoutDatePayload,
    buildOrganizationScheduleCsvTemplate,
    buildOrganizationScheduleImportPreview,
    buildOrganizationSharedGamePayload,
    buildVenueAvailabilityPayload,
    formatBlackoutDateRecord,
    formatVenueAvailabilityRecord,
    getOrganizationTeams,
    inferOrganizationScheduleCsvMapping,
    validateOrganizationMatchup
} from '../../js/organization-schedule.js';

describe('organization schedule helpers', () => {

    it('validates venue availability time windows before saving', () => {
        expect(buildVenueAvailabilityPayload({
            venueName: 'Main Field',
            subVenueName: 'North',
            dayOfWeek: 'monday',
            startTime: '18:00',
            endTime: '20:00',
            notes: 'Lights available'
        })).toEqual({
            venueName: 'Main Field',
            subVenueName: 'North',
            dayOfWeek: 'monday',
            startTime: '18:00',
            endTime: '20:00',
            notes: 'Lights available'
        });

        expect(() => buildVenueAvailabilityPayload({
            venueName: 'Main Field',
            dayOfWeek: 'monday',
            startTime: '',
            endTime: '20:00'
        })).toThrow('Enter a start and end time for the availability window.');

        expect(() => buildVenueAvailabilityPayload({
            venueName: 'Main Field',
            dayOfWeek: 'monday',
            startTime: '20:00',
            endTime: '18:00'
        })).toThrow('Availability end time must be after the start time.');
    });

    it('validates blackout date ranges before saving', () => {
        expect(buildBlackoutDatePayload({
            scope: 'organization',
            startDate: '2026-07-04',
            endDate: '2026-07-05',
            reason: 'Holiday'
        })).toEqual({
            scope: 'organization',
            venueName: null,
            subVenueName: null,
            startDate: '2026-07-04',
            endDate: '2026-07-05',
            reason: 'Holiday'
        });

        expect(() => buildBlackoutDatePayload({
            scope: 'venue',
            startDate: '2026-07-05',
            endDate: '2026-07-04'
        })).toThrow('Venue or sub-venue name is required for venue-specific blackouts.');

        expect(() => buildBlackoutDatePayload({
            scope: 'organization',
            startDate: '2026-07-05',
            endDate: '2026-07-04'
        })).toThrow('Blackout end date cannot be before the start date.');
    });

    it('formats venue controls for the review list', () => {
        expect(formatVenueAvailabilityRecord({
            venueName: 'Main Field',
            subVenueName: 'North',
            dayOfWeek: 'monday',
            startTime: '18:00',
            endTime: '20:00'
        })).toBe('Main Field / North · Monday · 18:00–20:00');

        expect(formatBlackoutDateRecord({
            scope: 'venue',
            venueName: 'Main Field',
            startDate: '2026-07-04',
            endDate: '2026-07-05'
        })).toBe('Main Field · 2026-07-04 through 2026-07-05');
    });
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

    it('previews organization schedule CSV rows against exact organization team matches', () => {
        const headers = ['Home Team', 'Away Team', 'Date & Time', 'Location', 'Arrival Time', 'Notes'];
        const mapping = inferOrganizationScheduleCsvMapping(headers);

        const preview = buildOrganizationScheduleImportPreview({
            rows: [
                {
                    'Home Team': 'Alpha',
                    'Away Team': 'Bravo',
                    'Date & Time': '2026-06-20 18:30',
                    Location: 'Field 2',
                    'Arrival Time': '2026-06-20 17:45',
                    Notes: 'Bring white uniforms'
                },
                {
                    'Home Team': 'Alpha',
                    'Away Team': 'Charlie',
                    'Date & Time': '2026-06-21 18:30',
                    Location: 'Field 3'
                }
            ],
            mapping,
            organizationTeams: getOrganizationTeams({ accessibleTeams, organizationOwnerId: 'org-1' }),
            accessibleTeams,
            organizationOwnerId: 'org-1'
        });

        expect(preview.validRows).toHaveLength(1);
        expect(preview.validRows[0]).toMatchObject({
            homeTeam: { id: 'team-1' },
            awayTeam: { id: 'team-2' },
            normalized: {
                location: 'Field 2',
                notes: 'Bring white uniforms'
            },
            valid: true
        });
        expect(preview.invalidRows).toHaveLength(1);
        expect(preview.invalidRows[0].errors).toContain('Away team is outside the current organization.');
    });

    it('builds the organization schedule CSV template headers', () => {
        expect(buildOrganizationScheduleCsvTemplate().split('\n')[0]).toBe('Home Team,Away Team,Date & Time,Location,Arrival Time,Notes');
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
            date: { iso: new Date('2026-06-20T18:30').toISOString() },
            opponent: 'Bravo',
            opponentTeamId: 'team-2',
            opponentTeamName: 'Bravo',
            opponentTeamPhoto: 'bravo.png',
            location: 'Field 2',
            arrivalTime: { iso: new Date('2026-06-20T17:45').toISOString() },
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

    it('wires the organization schedule bulk import UI', () => {
        const source = readFileSync(new URL('../../organization-schedule.html', import.meta.url), 'utf8');

        expect(source).toContain('id="bulk-import-tab"');
        expect(source).toContain('id="download-organization-schedule-template"');
        expect(source).toContain('id="download-organization-team-list"');
        expect(source).toContain('id="organization-schedule-csv-input"');
        expect(source).toContain('buildOrganizationScheduleImportPreview');
        expect(source).toContain('createdVia: \'organizationScheduleCsvImport\'');
    });

    it('caps organization schedule CSV imports before preview and import', () => {
        const source = readFileSync(new URL('../../organization-schedule.html', import.meta.url), 'utf8');

        expect(source).toContain('const ORGANIZATION_CSV_IMPORT_ROW_LIMIT = 500;');
        expect(source).toContain('parsed.rows.length > ORGANIZATION_CSV_IMPORT_ROW_LIMIT');
        expect(source).toContain('preview.validRows.length > ORGANIZATION_CSV_IMPORT_ROW_LIMIT');
    });

    it('loads all active teams for platform admins before organization filtering', () => {
        const source = readFileSync(new URL('../../organization-schedule.html', import.meta.url), 'utf8');

        expect(source).toContain('getTeam, getTeams, getUserTeamsWithAccess, listOrganizationScheduleControls');
        expect(source).toContain('accessibleTeams = currentUser.isAdmin === true');
        expect(source).toContain('? await getTeams()');
        expect(source).toContain(': await getUserTeamsWithAccess(currentUser.uid, currentUser.email);');
    });

    it('fails shared matchup publishes when the mirror write fails', () => {
        const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

        expect(source).toContain('await syncSharedScheduleCounterpart(teamId, docRef.id, { ...gameData, id: docRef.id });');
        expect(source).toContain("await deleteDoc(docRef);");
        expect(source).toContain('throw new Error(`Shared matchup was not fully published.${detail}`);');
    });

    it('renders shared matchup success actions without using innerHTML', () => {
        const source = readFileSync(new URL('../../organization-schedule.html', import.meta.url), 'utf8');

        expect(source).toContain('successAlert.replaceChildren();');
        expect(source).toContain("const homeLink = document.createElement('a');");
        expect(source).not.toContain('successAlert.innerHTML =');
    });
    it('wires venue availability and blackout controls on the organization schedule page', () => {
        const source = readFileSync(new URL('../../organization-schedule.html', import.meta.url), 'utf8');

        expect(source).toContain('id="venue-availability-form"');
        expect(source).toContain('id="blackout-date-form"');
        expect(source).toContain('id="venue-controls-list"');
        expect(source).toContain('buildVenueAvailabilityPayload');
        expect(source).toContain('buildBlackoutDatePayload');
        expect(source).toContain('listOrganizationScheduleControls');
    });

    it('allows team admins to manage venue schedule control collections', () => {
        const source = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

        expect(source).toContain('match /venueAvailability/{availabilityId}');
        expect(source).toContain('match /organizationBlackouts/{blackoutId}');
        expect(source).toContain('match /venueBlackouts/{blackoutId}');
    });

});
