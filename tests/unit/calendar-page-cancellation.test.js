import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readCalendarPage() {
    return readFileSync(new URL('../../calendar.html', import.meta.url), 'utf8');
}

describe('calendar page ICS cancellation handling', () => {
    it('delegates synced ICS event mapping to the shared global calendar helper', () => {
        const source = readCalendarPage();

        expect(source).toContain('buildGlobalCalendarIcsEvent');
        expect(source).toContain('const mappedEvent = buildGlobalCalendarIcsEvent({');
        expect(source).not.toContain("status: 'scheduled'");
    });
});
