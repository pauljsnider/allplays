import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule CSV import wiring', () => {
    it('adds a dedicated CSV import tab with mapping and preview controls', () => {
        const source = readEditSchedule();

        expect(source).toContain('tab-csv-import');
        expect(source).toContain('content-csv-import');
        expect(source).toContain('schedule-csv-file-input');
        expect(source).toContain('csv-import-mapping-fields');
        expect(source).toContain('csv-import-preview-list');
        expect(source).toContain('import-csv-btn');
    });

    it('loads the deterministic CSV import helper module', () => {
        const source = readEditSchedule();

        expect(source).toContain("from './js/schedule-csv-import.js?v=2'");
        expect(source).toContain('buildScheduleImportPreview');
        expect(source).toContain('inferScheduleCsvMapping');
        expect(source).toContain('parseCsvText');
    });
});
