import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

function createCombinedScheduleHarness() {
    const source = readFamilyPageSource();
    const buildCombinedScheduleSource = extractFunction(source, 'buildCombinedSchedule');

    const buildCombinedSchedule = new Function(`
const expandRecurrence = () => [];
const toDateSafe = value => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};
async ${buildCombinedScheduleSource}
return buildCombinedSchedule;
`)();

    return { buildCombinedSchedule };
}

describe('family page extra calendar deduplication', () => {
    it('combines stored and external events supplied by the server projection', async () => {
        const { buildCombinedSchedule } = createCombinedScheduleHarness();
        const projection = {
            teams: [{
                teamId: 'team-1',
                teamName: 'Falcons',
                games: [{
                    id: 'db-game-1',
                    date: '2026-06-15T17:00:00Z',
                    opponent: 'Lions',
                    location: 'Home Field',
                    status: 'scheduled'
                }]
            }],
            externalEvents: [{
                id: 'external-1',
                teamId: 'team-1',
                teamName: 'Falcons',
                date: '2026-06-16T18:00:00Z',
                opponent: 'Tigers',
                location: 'North Field',
                childIds: ['player-1'],
                childNames: ['Avery']
            }]
        };

        const events = await buildCombinedSchedule([{
            teamId: 'team-1',
            teamName: 'Falcons',
            playerId: 'player-1',
            playerName: 'Avery'
        }], projection);

        expect(events).toHaveLength(2);
        expect(events.find(event => event.id === 'db-game-1')).toMatchObject({
            opponent: 'Lions',
            isDbGame: true
        });
        expect(events.find(event => event.id === 'external-1')).toMatchObject({
            opponent: 'Tigers',
            isDbGame: false,
            isShareExtraCalendar: true
        });
    });

    it('contains no anonymous raw token, team, game, or calendar-source fallback', () => {
        const source = readFamilyPageSource();

        expect(source).not.toContain('getFamilyShareToken');
        expect(source).not.toContain('resolveFamilyShareTokenChildren');
        expect(source).not.toContain('getTeam(');
        expect(source).not.toContain('getGames(');
        expect(source).not.toContain('fetchAndParseCalendar');
        expect(source).not.toContain('extraCalendarUrls');
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

    it('uses projected extra events and reuses the shared dedup helper in list rendering', () => {
        const source = readFamilyPageSource();

        expect(source).toContain('isShareExtraCalendar: true');
        expect(source).toContain("id: String(rawEvent.id || rawEvent.eventKey || '')");
        expect(source).toContain("sourceLabel: String(rawEvent.sourceLabel || 'Shared calendar')");
        expect(source).not.toContain('sourceCalendarUrl:');
        expect(source).toContain('const key = getScheduleEventDedupKey(game, d);');
        expect(source).toContain('const key = getScheduleEventDedupKey(event, d);');
    });
});
