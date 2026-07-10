import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

function readFamilyPageSource() {
    return readFileSync(new URL('../../family.html', import.meta.url), 'utf8');
}

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}`);
    if (start === -1) {
        throw new Error(`Function ${name} not found`);
    }

    const bodyStart = source.indexOf('{', start);
    let depth = 0;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Function ${name} did not terminate`);
}

function createFamilyHooks() {
    const source = readFamilyPageSource();
    const getScheduleEventDedupKeySource = extractFunction(source, 'getScheduleEventDedupKey');
    const getCalendarEntriesSource = extractFunction(source, 'getCalendarEntries');
    const formatIcsDateSource = extractFunction(source, 'formatIcsDate');
    const buildIcsSource = extractFunction(source, 'buildIcs');

    return new Function(`
${getScheduleEventDedupKeySource}
${getCalendarEntriesSource}
${formatIcsDateSource}
${buildIcsSource}
return { getScheduleEventDedupKey, getCalendarEntries, buildIcs };
`)();
}

function createCombinedScheduleHarness({ calendarsByUrl = {}, failures = [] } = {}) {
    const source = readFamilyPageSource();
    const buildCombinedScheduleSource = extractFunction(source, 'buildCombinedSchedule');

    return new Function('deps', `
const {
    getTeam,
    getGames,
    getTrackedCalendarEventUids,
    fetchAndParseCalendar,
    recordExternalCalendarFailure
} = deps;
const expandRecurrence = () => [];
const isTrackedCalendarEvent = () => false;
const isPracticeEvent = summary => /practice/i.test(String(summary || ''));
const extractOpponent = summary => String(summary || '').replace(/^vs\\.?\\s*/i, '') || 'TBD';
const getCalendarEventTrackingId = event => event.uid || null;
const getCalendarFailureLabel = url => new URL(url).hostname;
async ${buildCombinedScheduleSource}
return buildCombinedSchedule;
`)({
        getTeam: async () => ({ name: 'Falcons', calendarUrls: [] }),
        getGames: async () => [{
            id: 'db-game-1',
            date: new Date('2026-06-15T17:00:00Z'),
            opponent: 'Lions',
            location: 'Home Field',
            status: 'scheduled'
        }],
        getTrackedCalendarEventUids: async () => [],
        fetchAndParseCalendar: async url => {
            const result = calendarsByUrl[url];
            if (result instanceof Error) throw result;
            return result || [];
        },
        recordExternalCalendarFailure: failure => failures.push(failure)
    });
}

describe('family page extra calendar deduplication', () => {
    it('loads share-token calendar events without losing each source URL across async fetches', async () => {
        const firstUrl = 'https://calendar.example.com/one.ics';
        const secondUrl = 'https://calendar.example.com/two.ics';
        const buildCombinedSchedule = createCombinedScheduleHarness({
            calendarsByUrl: {
                [firstUrl]: [{
                    uid: 'extra-1',
                    dtstart: new Date('2026-06-16T18:00:00Z'),
                    summary: 'vs. Tigers',
                    location: 'North Field'
                }],
                [secondUrl]: [{
                    uid: 'extra-2',
                    dtstart: new Date('2026-06-17T18:00:00Z'),
                    summary: 'Summer Practice',
                    location: 'South Field'
                }]
            }
        });

        const events = await buildCombinedSchedule([{
            teamId: 'team-1',
            teamName: 'Falcons',
            playerId: 'player-1',
            playerName: 'Avery'
        }], [firstUrl, secondUrl]);

        expect(events).toHaveLength(3);
        expect(events.find(event => event.id === 'db-game-1')).toMatchObject({
            opponent: 'Lions',
            isDbGame: true
        });
        expect(events.find(event => event.id === 'extra-1')).toMatchObject({
            sourceCalendarUrl: firstUrl,
            isShareExtraCalendar: true,
            childName: 'Avery'
        });
        expect(events.find(event => event.id === 'extra-2')).toMatchObject({
            sourceCalendarUrl: secondUrl,
            isShareExtraCalendar: true,
            type: 'practice'
        });
    });

    it('keeps valid family schedule events when one share-token calendar fails', async () => {
        const failedUrl = 'https://calendar.example.com/broken.ics';
        const failures = [];
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const buildCombinedSchedule = createCombinedScheduleHarness({
            calendarsByUrl: { [failedUrl]: new Error('calendar unavailable') },
            failures
        });

        try {
            const events = await buildCombinedSchedule([{
                teamId: 'team-1',
                teamName: 'Falcons',
                playerId: 'player-1',
                playerName: 'Avery'
            }], [failedUrl]);

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({ id: 'db-game-1', isDbGame: true });
            expect(failures).toEqual([{
                url: failedUrl,
                label: 'calendar.example.com'
            }]);
            expect(warnSpy).toHaveBeenCalledWith(
                '[family] Error fetching extra calendar:',
                failedUrl,
                expect.any(Error)
            );
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('collapses share-token extra calendar events across shared children on different teams', () => {
        const { getCalendarEntries } = createFamilyHooks();
        const sharedDate = new Date('2026-06-15T18:00:00Z');

        const entries = getCalendarEntries([
            {
                teamId: 'team-1',
                id: 'calendar-event-1',
                type: 'game',
                date: sharedDate,
                childId: 'child-1',
                childName: 'Avery',
                isShareExtraCalendar: true
            },
            {
                teamId: 'team-2',
                id: 'calendar-event-1',
                type: 'game',
                date: new Date(sharedDate),
                childId: 'child-2',
                childName: 'Blake',
                isShareExtraCalendar: true
            }
        ]);

        expect(entries).toHaveLength(1);
        expect(entries[0].childNames).toEqual(['Avery', 'Blake']);
        expect(entries[0].childIds).toEqual(['child-1', 'child-2']);
    });

    it('keeps team-scoped events distinct when they are not share-token extra calendars', () => {
        const { getCalendarEntries } = createFamilyHooks();
        const sharedDate = new Date('2026-06-15T18:00:00Z');

        const entries = getCalendarEntries([
            {
                teamId: 'team-1',
                id: 'calendar-event-1',
                type: 'game',
                date: sharedDate,
                childId: 'child-1',
                childName: 'Avery'
            },
            {
                teamId: 'team-2',
                id: 'calendar-event-1',
                type: 'game',
                date: new Date(sharedDate),
                childId: 'child-2',
                childName: 'Blake'
            }
        ]);

        expect(entries).toHaveLength(2);
    });

    it('deduplicates exported ICS events and preserves all child names', () => {
        const { buildIcs } = createFamilyHooks();
        const sharedDate = new Date('2026-06-15T18:00:00Z');

        const ics = buildIcs([
            {
                teamId: 'team-1',
                id: 'calendar-event-1',
                type: 'game',
                date: sharedDate,
                opponent: 'Lions',
                location: 'North Field',
                childId: 'child-1',
                childName: 'Avery',
                isShareExtraCalendar: true
            },
            {
                teamId: 'team-2',
                id: 'calendar-event-1',
                type: 'game',
                date: new Date(sharedDate),
                opponent: 'Lions',
                location: 'North Field',
                childId: 'child-2',
                childName: 'Blake',
                isShareExtraCalendar: true
            }
        ]);

        expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
        expect(ics).toContain('SUMMARY:Avery\\, Blake vs Lions');
        expect(ics).toContain('DESCRIPTION:For Avery\\, Blake');
    });

    it('keeps share-token extra calendar events from different sources distinct when tracking ids are missing', () => {
        const { getCalendarEntries, buildIcs } = createFamilyHooks();
        const sharedDate = new Date('2026-06-15T18:00:00Z');
        const events = [
            {
                type: 'practice',
                date: sharedDate,
                location: 'North Field',
                teamId: 'team-1',
                teamName: 'Falcons',
                id: null,
                calendarEventUid: null,
                sourceCalendarUrl: 'https://calendar.example.com/one.ics',
                isDbGame: false,
                isShareExtraCalendar: true,
                childId: 'child-1',
                childName: 'Avery',
                title: 'Summer Practice'
            },
            {
                type: 'practice',
                date: new Date(sharedDate),
                location: 'North Field',
                teamId: 'team-2',
                teamName: 'Falcons',
                id: null,
                calendarEventUid: null,
                sourceCalendarUrl: 'https://calendar.example.com/two.ics',
                isDbGame: false,
                isShareExtraCalendar: true,
                childId: 'child-2',
                childName: 'Blake',
                title: 'Summer Practice'
            }
        ];

        expect(getCalendarEntries(events)).toHaveLength(2);
        expect(buildIcs(events).match(/BEGIN:VEVENT/g)).toHaveLength(2);
    });

    it('marks share-token extra calendar events and reuses the shared dedup helper in list rendering', () => {
        const source = readFamilyPageSource();

        expect(source).toContain('isShareExtraCalendar: true');
        expect(source).toContain('sourceCalendarUrl: calUrl');
        expect(source).toContain('const key = getScheduleEventDedupKey(game, d);');
        expect(source).toContain('const key = getScheduleEventDedupKey(event, d);');
    });
});
