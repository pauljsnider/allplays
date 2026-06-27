import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readCalendarPage() {
    return readFileSync(new URL('../../calendar.html', import.meta.url), 'utf8');
}

describe('global calendar ICS sync helper', () => {
    it('reuses the loaded game list when resolving tracked calendar UIDs', () => {
        const source = readCalendarPage();

        expect(source).toContain('const games = await getGames(team.id);');
        expect(source).toContain('const trackedUids = await getTrackedCalendarEventUids(team.id, games);');
    });

    it('suppresses tracked and already imported ICS events while keeping distinct same-slot imports', async () => {
        const { mergeGlobalCalendarIcsEvents } = await import('../../js/calendar-ics-sync.js');

        const team = { id: 'team-1', name: 'Tigers' };
        const teamColor = '#f97316';
        const existingEvents = [
            {
                id: 'db-game-1',
                teamId: 'team-1',
                source: 'db',
                date: new Date('2026-03-15T18:00:00.000Z')
            },
            {
                id: 'db-game-2',
                teamId: 'team-1',
                source: 'db',
                date: new Date('2026-03-16T18:00:00.000Z'),
                calendarEventUid: 'db-linked-uid'
            }
        ];
        const trackedEvent = {
            uid: 'tracked-uid',
            dtstart: new Date('2026-03-15T19:00:00.000Z'),
            summary: 'Tigers vs Tracked',
            location: 'Field 2'
        };
        const sameSlotEvent = {
            uid: 'same-slot-uid',
            dtstart: new Date('2026-03-15T18:00:00.000Z'),
            summary: 'Tigers vs Same Slot',
            location: 'Field 1'
        };
        const dbLinkedEvent = {
            uid: 'db-linked-uid',
            dtstart: new Date('2026-03-16T18:00:00.000Z'),
            summary: 'Tigers vs Linked DB Game',
            location: 'Field 3'
        };
        const importedEvent = {
            uid: 'imported-uid',
            dtstart: new Date('2026-03-17T18:00:00.000Z'),
            summary: 'Tigers vs New Team',
            location: 'Field 4'
        };

        const buildGlobalCalendarIcsEvent = ({ team, teamColor, event }) => ({
            id: event.uid,
            teamId: team.id,
            teamName: team.name,
            teamColor,
            title: event.summary,
            date: event.dtstart,
            location: event.location,
            source: 'ics'
        });
        const mergeOptions = {
            team,
            teamColor,
            trackedUids: ['tracked-uid'],
            isTrackedCalendarEvent: (event, currentTrackedUids) => currentTrackedUids.includes(event.uid),
            buildGlobalCalendarIcsEvent
        };

        const firstMerged = mergeGlobalCalendarIcsEvents({
            ...mergeOptions,
            existingEvents,
            icsEvents: [trackedEvent, sameSlotEvent, dbLinkedEvent, importedEvent]
        });

        expect(firstMerged).toEqual([
            {
                id: 'same-slot-uid',
                teamId: 'team-1',
                teamName: 'Tigers',
                teamColor: '#f97316',
                title: 'Tigers vs Same Slot',
                date: sameSlotEvent.dtstart,
                location: 'Field 1',
                source: 'ics'
            },
            {
                id: 'imported-uid',
                teamId: 'team-1',
                teamName: 'Tigers',
                teamColor: '#f97316',
                title: 'Tigers vs New Team',
                date: importedEvent.dtstart,
                location: 'Field 4',
                source: 'ics'
            }
        ]);

        const secondMerged = mergeGlobalCalendarIcsEvents({
            ...mergeOptions,
            existingEvents: [...existingEvents, ...firstMerged],
            icsEvents: [
                {
                    uid: 'imported-uid',
                    dtstart: new Date('2026-03-17T18:00:00.000Z'),
                    summary: 'Tigers vs New Team',
                    location: 'Field 4'
                },
                {
                    uid: 'second-feed-unique',
                    dtstart: new Date('2026-03-18T18:00:00.000Z'),
                    summary: 'Tigers vs Fresh Feed Opponent',
                    location: 'Field 5'
                }
            ]
        });

        expect(secondMerged).toEqual([
            {
                id: 'second-feed-unique',
                teamId: 'team-1',
                teamName: 'Tigers',
                teamColor: '#f97316',
                title: 'Tigers vs Fresh Feed Opponent',
                date: new Date('2026-03-18T18:00:00.000Z'),
                location: 'Field 5',
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
