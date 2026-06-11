import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scheduleSource = readFileSync(new URL('../../apps/app/src/pages/Schedule.tsx', import.meta.url), 'utf8');

describe('Schedule lazy-load guards', () => {
    it('does not statically import staff AI or CSV helpers at the route level', () => {
        expect(scheduleSource).not.toContain("from '../lib/scheduleAiImport'");
        expect(scheduleSource).not.toContain("from '../lib/scheduleCsvImport'");
    });

    it('loads staff AI and CSV helpers through on-demand dynamic imports', () => {
        expect(scheduleSource).toContain("scheduleCsvImportModulePromise = import('../lib/scheduleCsvImport')");
        expect(scheduleSource).toContain("scheduleAiImportModulePromise = import('../lib/scheduleAiImport')");
        expect(scheduleSource).toContain("const { parseCsvText, inferScheduleCsvMapping } = await loadScheduleCsvImportModule();");
        expect(scheduleSource).toContain("const { buildScheduleImportPreview } = await loadScheduleCsvImportModule();");
        expect(scheduleSource).toContain("const { generateScheduleAiImportRows } = await loadScheduleAiImportModule();");
    });
});
