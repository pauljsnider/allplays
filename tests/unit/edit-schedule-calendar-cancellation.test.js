import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

function readCalendarImportHelper() {
    return readFileSync(new URL('../../js/edit-schedule-calendar-import.js', import.meta.url), 'utf8');
}

describe('edit schedule calendar cancellation handling', () => {
    it('uses shared calendar cancellation handling instead of inline brittle checks', () => {
        const source = readEditSchedule();
        const helperSource = readCalendarImportHelper();

        expect(source).toContain('getCalendarEventStatus');
        expect(source).toContain('mergeCalendarImportEvents');
        expect(helperSource).toContain("isCancelled: getCalendarEventStatus(event) === 'cancelled'");
        expect(source).not.toContain("event.status?.toUpperCase() === 'CANCELLED'");
        expect(source).not.toContain("event.summary?.includes('[CANCELED]')");
    });

    it('strips both cancelled summary prefixes before opponent extraction', () => {
        const helperSource = readCalendarImportHelper();

        expect(helperSource).toContain("replace(/\\[(?:CANCELED|CANCELLED)\\]\\s*/gi, '')");
    });
});
