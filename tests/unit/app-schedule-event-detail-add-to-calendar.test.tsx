import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readScheduleEventDetailSource() {
    return readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
}

describe('React app schedule event detail add-to-calendar coverage', () => {
    it('keeps the add-to-calendar CTA in the root unit suite', () => {
        const source = readScheduleEventDetailSource();

        expect(source).toContain("import { buildParentScheduleEventIcs, downloadIcs } from '../lib/parentToolsService';");
        expect(source).toContain('const addEventToCalendar = () => {');
        expect(source).toContain('const icsTitle = `${title} | ${selectedEvent.teamName}`;');
        expect(source).toContain("const fileDate = selectedEvent.date.toISOString().slice(0, 10);");
        expect(source).toContain('downloadIcs(');
        expect(source).toContain('`${selectedEvent.teamName}-${title}-${fileDate}.ics`,');
        expect(source).toContain('buildParentScheduleEventIcs(selectedEvent, icsTitle)');
        expect(source).toContain("setStatusMessage('Add to Calendar download started.');");
        expect(source).toContain('className="secondary-button event-calendar-button mt-1.5 w-full justify-center sm:mt-2"');
        expect(source).toContain('onClick={addEventToCalendar}');
        expect(source).toContain('Add to Calendar');
    });
});
