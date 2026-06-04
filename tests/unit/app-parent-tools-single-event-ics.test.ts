import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readParentToolsSource() {
    return readFileSync(new URL('../../apps/app/src/lib/parentToolsService.ts', import.meta.url), 'utf8');
}

describe('React app parent tools single-event ICS coverage', () => {
    it('keeps single-event calendar exports in the root unit suite', () => {
        const source = readParentToolsSource();

        expect(source).toContain("export function buildParentScheduleEventIcs(event: ParentScheduleEvent, calendarName = 'ALL PLAYS Schedule') {");
        expect(source).toContain('  return buildParentScheduleIcs(event ? [event] : [], calendarName);');
        expect(source).toContain("const end = toDate(event.endDate) || new Date(start.getTime() + 60 * 60 * 1000);");
        expect(source).toContain("event.type === 'practice' ? 'Practice' : 'Game'");
        expect(source).toContain("event.childName ? `Player: ${event.childName}` : ''");
        expect(source).toContain('`SUMMARY:${escapeIcs(title)}`');
        expect(source).toContain('`LOCATION:${escapeIcs(event.location || \'TBD\')}`');
        expect(source).toContain('`DESCRIPTION:${escapeIcs(description)}`');
    });
});
