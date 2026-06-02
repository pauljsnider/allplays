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

describe('family page extra calendar deduplication', () => {
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

    it('marks share-token extra calendar events and reuses the shared dedup helper in list rendering', () => {
        const source = readFamilyPageSource();

        expect(source).toContain('isShareExtraCalendar: true');
        expect(source).toContain('const key = getScheduleEventDedupKey(game, d);');
        expect(source).toContain('const key = getScheduleEventDedupKey(event, d);');
    });
});
