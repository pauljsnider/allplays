import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule calendar cancellation handling', () => {
    it('uses the shared calendar cancellation helper instead of inline brittle checks', () => {
        const source = readEditSchedule();

        expect(source).toContain('getCalendarEventStatus');
        expect(source).toContain("const isCancelled = getCalendarEventStatus(event) === 'cancelled';");
        expect(source).not.toContain("event.status?.toUpperCase() === 'CANCELLED'");
        expect(source).not.toContain("event.summary?.includes('[CANCELED]')");
    });

    it('strips both cancelled summary prefixes before opponent extraction', () => {
        const source = readEditSchedule();

        expect(source).toContain("replace(/\\[(?:CANCELED|CANCELLED)\\]\\s*/gi, '')");
    });
});
