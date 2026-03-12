import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLinkedPlayersByTeam, resolveCalendarRsvpSubmission } from '../../js/calendar-rsvp.js';

describe('calendar RSVP linked player scope', () => {
    it('groups linked children by team without duplicate player ids', () => {
        const result = buildLinkedPlayersByTeam([
            { teamId: 'team-1', playerId: 'child-a', playerName: 'Alex' },
            { teamId: 'team-1', playerId: 'child-a', playerName: 'Alex Duplicate' },
            { teamId: 'team-1', playerId: 'child-b', playerName: 'Blake' },
            { teamId: 'team-2', playerId: 'child-z', playerName: 'Zoe' }
        ]);

        expect(result.get('team-1')).toEqual([
            { playerId: 'child-a', playerName: 'Alex' },
            { playerId: 'child-b', playerName: 'Blake' }
        ]);
        expect(result.get('team-2')).toEqual([
            { playerId: 'child-z', playerName: 'Zoe' }
        ]);
    });

    it('keeps one-click user-scoped submission for teams with one linked child', () => {
        const linkedPlayersByTeam = buildLinkedPlayersByTeam([
            { teamId: 'team-1', playerId: 'child-a', playerName: 'Alex' }
        ]);

        expect(resolveCalendarRsvpSubmission(linkedPlayersByTeam, 'team-1')).toEqual({
            playerIds: ['child-a'],
            submitMode: 'user'
        });
    });

    it('requires explicit child selection for teams with multiple linked children', () => {
        const linkedPlayersByTeam = buildLinkedPlayersByTeam([
            { teamId: 'team-1', playerId: 'child-a', playerName: 'Alex' },
            { teamId: 'team-1', playerId: 'child-b', playerName: 'Blake' }
        ]);

        expect(() => resolveCalendarRsvpSubmission(linkedPlayersByTeam, 'team-1'))
            .toThrow('Select a child for this team before submitting RSVP.');
    });

    it('routes selected sibling submissions through the per-player path', () => {
        const linkedPlayersByTeam = buildLinkedPlayersByTeam([
            { teamId: 'team-1', playerId: 'child-a', playerName: 'Alex' },
            { teamId: 'team-1', playerId: 'child-b', playerName: 'Blake' }
        ]);

        expect(resolveCalendarRsvpSubmission(linkedPlayersByTeam, 'team-1', 'child-b')).toEqual({
            playerIds: ['child-b'],
            submitMode: 'player'
        });
    });

    it('rejects child ids that are not linked to the selected team', () => {
        const linkedPlayersByTeam = buildLinkedPlayersByTeam([
            { teamId: 'team-1', playerId: 'child-a', playerName: 'Alex' },
            { teamId: 'team-1', playerId: 'child-b', playerName: 'Blake' }
        ]);

        expect(() => resolveCalendarRsvpSubmission(linkedPlayersByTeam, 'team-1', 'child-z'))
            .toThrow('Select a linked child for this team before submitting RSVP.');
    });
});

describe('calendar.html RSVP wiring', () => {
    const calendarSource = fs.readFileSync(
        path.resolve(process.cwd(), 'calendar.html'),
        'utf8'
    );

    it('uses the sibling-safe calendar RSVP helpers and per-player submit path', () => {
        expect(calendarSource).toContain("import { buildLinkedPlayersByTeam, resolveCalendarRsvpSubmission } from './js/calendar-rsvp.js?v=1';");
        expect(calendarSource).toContain('submitRsvpForPlayer');
        expect(calendarSource).toContain('data-rsvp-child-id');
        expect(calendarSource).toContain('data-rsvp-child-selector="true"');
    });
});
