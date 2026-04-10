import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readCalendarPage() {
    return readFileSync(new URL('../../calendar.html', import.meta.url), 'utf8');
}

describe('global calendar ICS sync helper', () => {
    it('suppresses tracked and same-slot ICS events while keeping new imports', async () => {
        const { mergeGlobalCalendarIcsEvents } = await import('../../js/calendar-ics-sync.js');

        const existingEvents = [
            {
                id: 'db-game-1',
                teamId: 'team-1',
                source: 'db',
                date: new Date('2026-03-15T18:00:00.000Z')
            }
        ];
        const trackedEvent = {
            uid: 'tracked-uid',
            dtstart: new Date('2026-03-15T19:00:00.000Z'),
            summary: 'Tigers vs Tracked',
            location: 'Field 2'
        };
        const conflictingEvent = {
            uid: 'conflict-uid',
            dtstart: new Date('2026-03-15T18:00:00.000Z'),
            summary: 'Tigers vs Same Slot',
            location: 'Field 1'
        };
        const importedEvent = {
            uid: 'imported-uid',
            dtstart: new Date('2026-03-16T18:00:00.000Z'),
            summary: 'Tigers vs New Team',
            location: 'Field 3'
        };

        const merged = mergeGlobalCalendarIcsEvents({
            team: { id: 'team-1', name: 'Tigers' },
            teamColor: '#f97316',
            existingEvents,
            icsEvents: [trackedEvent, conflictingEvent, importedEvent],
            trackedUids: ['tracked-uid'],
            isTrackedCalendarEvent: (event, trackedUids) => trackedUids.includes(event.uid),
            buildGlobalCalendarIcsEvent: ({ team, teamColor, event }) => ({
                id: event.uid,
                teamId: team.id,
                teamName: team.name,
                teamColor,
                title: event.summary,
                date: event.dtstart,
                location: event.location,
                source: 'ics'
            })
        });

        expect(merged).toEqual([
            {
                id: 'imported-uid',
                teamId: 'team-1',
                teamName: 'Tigers',
                teamColor: '#f97316',
                title: 'Tigers vs New Team',
                date: importedEvent.dtstart,
                location: 'Field 3',
                source: 'ics'
            }
        ]);
    });
});

describe('calendar page shared schedule sync wiring', () => {
    it('routes ICS merge behavior through the shared helper', () => {
        const source = readCalendarPage();

        expect(source).toContain("import { mergeGlobalCalendarIcsEvents } from './js/calendar-ics-sync.js?v=1';");
        expect(source).toContain('events.push(...mergeGlobalCalendarIcsEvents({');
        expect(source).not.toContain('const hasTrackedConflict = events.some((existingEvent) => {');
    });
});
