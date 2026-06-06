import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readScheduleEventDetailSource() {
    return readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
}

describe('React app schedule event detail add-to-calendar coverage', () => {
    it('keeps the add-to-calendar CTA in the root unit suite', () => {
        const source = readScheduleEventDetailSource();

        expect(source).toContain("import { exportCalendarIcsFile, openPublicUrl, sharePublicUrl } from '../lib/publicActions';");
        expect(source).toContain("import { buildParentScheduleEventIcs } from '../lib/parentToolsService';");
        expect(source).toContain('const addEventToCalendar = async () => {');
        expect(source).toContain('const icsTitle = `${title} | ${selectedEvent.teamName}`;');
        expect(source).toContain("const fileDate = selectedEvent.date.toISOString().slice(0, 10);");
        expect(source).toContain('const filename = `${selectedEvent.teamName}-${title}-${fileDate}.ics`;');
        expect(source).toContain('const result = await exportCalendarIcsFile(');
        expect(source).toContain('filename,');
        expect(source).toContain('buildParentScheduleEventIcs(selectedEvent, icsTitle)');
        expect(source).toContain("setStatusMessage(result === 'shared' ? 'Calendar file ready to share.' : 'Add to Calendar download started.');");
        expect(source).toContain("setError(calendarError?.message || 'Unable to export the calendar file. Try again or use another calendar option.');");
        expect(source).toContain('className="secondary-button event-calendar-button mt-1.5 w-full justify-center sm:mt-2"');
        expect(source).toContain('onClick={addEventToCalendar}');
        expect(source).toContain('Add to Calendar');
    });
});
