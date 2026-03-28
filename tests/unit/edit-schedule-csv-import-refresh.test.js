import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule CSV import refresh handling', () => {
    it('downgrades post-persist refresh failures to warnings instead of generic batch failure handling', () => {
        const source = readEditSchedule();

        expect(source).toContain('async function refreshScheduleAfterCsvImport(successfulRowsCount, failedRowsCount = 0)');
        expect(source).toContain("console.error('CSV import refresh failed after rows were persisted:', error);");
        expect(source).toContain('Imported ${successfulRowsCount} row(s), but the schedule refresh failed: ${error.message}.');
        expect(source).toContain('Schedule refresh also failed; reload the page before retrying the remaining rows.');
    });

    it('uses the refresh helper from both the partial-success and full-success paths', () => {
        const source = readEditSchedule();
        const matches = source.match(/refreshScheduleAfterCsvImport\(successfulRows\.length(?:, failedRows\.length)?\)/g) || [];

        expect(matches).toHaveLength(2);
        expect(source).toContain("const refreshWarning = await refreshScheduleAfterCsvImport(successfulRows.length, failedRows.length);");
        expect(source).toContain("const refreshWarning = await refreshScheduleAfterCsvImport(successfulRows.length);");
    });
});
