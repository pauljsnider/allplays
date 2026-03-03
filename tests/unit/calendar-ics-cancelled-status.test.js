import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function getCalendarIcsMappingSection() {
    const html = readFileSync(new URL('../../calendar.html', import.meta.url), 'utf8');
    const match = html.match(/const icsEvents = await fetchAndParseCalendar\(calUrl\);[\s\S]*?events\.push\(\{[\s\S]*?source:\s*'ics'[\s\S]*?\}\);/);
    return match ? match[0] : '';
}

describe('calendar ICS cancelled status mapping', () => {
    it('derives cancelled status from ICS status or case-insensitive summary prefix marker', () => {
        const mappingSection = getCalendarIcsMappingSection();

        expect(mappingSection).toBeTruthy();
        expect(mappingSection).toMatch(/const normalizedSummary = ev\.summary\?\.trimStart\(\)\.toUpperCase\(\);/);
        expect(mappingSection).toMatch(/const isCancelled = ev\.status\?\.toUpperCase\(\) === 'CANCELLED'\s*\|\|\s*normalizedSummary\?\.startsWith\('\[CANCELED\]'\)\s*\|\|\s*normalizedSummary\?\.startsWith\('\[CANCELLED\]'\);/);
        expect(mappingSection).toMatch(/status:\s*isCancelled\s*\?\s*'cancelled'\s*:\s*'scheduled'\s*,/);
        expect(mappingSection).not.toMatch(/^\s*status:\s*'scheduled'\s*,/m);
    });
});
