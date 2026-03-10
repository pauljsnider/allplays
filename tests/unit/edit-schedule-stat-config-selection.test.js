import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule stat config selection', () => {
    it('preserves an explicit None selection instead of resolving a fallback on submit', () => {
        const source = readEditSchedule();

        const helperStart = source.indexOf('function getSelectedConfigId() {');
        const helperEnd = source.indexOf('        async function ensureTeamsCache() {');
        expect(helperStart).toBeGreaterThanOrEqual(0);
        expect(helperEnd).toBeGreaterThan(helperStart);

        const helperBlock = source.slice(helperStart, helperEnd);
        expect(helperBlock).toContain("return document.getElementById('statConfig').value || null;");
        expect(helperBlock).not.toContain('resolvePreferredStatConfigId');

        const submitStart = source.indexOf("document.getElementById('add-game-form').addEventListener('submit', async (e) => {");
        const submitEnd = source.indexOf('        function setScheduleFilter(nextFilter) {');
        expect(submitStart).toBeGreaterThanOrEqual(0);
        expect(submitEnd).toBeGreaterThan(submitStart);

        const submitBlock = source.slice(submitStart, submitEnd);
        expect(submitBlock).toContain('const configId = getSelectedConfigId();');
        expect(submitBlock).toContain('statTrackerConfigId: configId || null,');
        expect(submitBlock).not.toContain('getSelectedOrDefaultConfigId');
    });

    it('uses the raw select value when tracking a calendar event', () => {
        const source = readEditSchedule();

        const trackStart = source.indexOf('window.trackCalendarEvent = async (calendarEvent) => {');
        const trackEnd = source.indexOf('        // ===== BULK AI UPDATE FUNCTIONALITY =====');
        expect(trackStart).toBeGreaterThanOrEqual(0);
        expect(trackEnd).toBeGreaterThan(trackStart);

        const trackBlock = source.slice(trackStart, trackEnd);
        expect(trackBlock).toContain('const configId = getSelectedConfigId();');
        expect(trackBlock).toContain('statTrackerConfigId: configId || null,');
        expect(trackBlock).not.toContain('getSelectedOrDefaultConfigId');
    });
});
