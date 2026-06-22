import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const directLegacyImportPattern = /from\s+['"](?:\.\.\/){4,}js\//;

function readRepoFile(path) {
    return readFileSync(join(repoRoot, path), 'utf8');
}

describe('app legacy adapter boundary', () => {
    it('keeps schedule and player services free of direct legacy js imports', () => {
        const scheduleServiceSource = readRepoFile('apps/app/src/lib/scheduleService.ts');
        const playerServiceSource = readRepoFile('apps/app/src/lib/playerService.ts');

        expect(directLegacyImportPattern.test(scheduleServiceSource)).toBe(false);
        expect(directLegacyImportPattern.test(playerServiceSource)).toBe(false);
    });

    it('routes schedule and player services through typed legacy adapters', () => {
        const scheduleServiceSource = readRepoFile('apps/app/src/lib/scheduleService.ts');
        const playerServiceSource = readRepoFile('apps/app/src/lib/playerService.ts');
        const scheduleAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyScheduleDb.ts');
        const playerAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyPlayerDb.ts');

        expect(scheduleServiceSource).toContain("from './adapters/legacyScheduleDb'");
        expect(playerServiceSource).toContain("from './adapters/legacyPlayerDb'");
        expect(scheduleAdapterSource).toContain("from '@legacy/db.js'");
        expect(scheduleAdapterSource).toContain("from '@legacy/firebase.js'");
        expect(playerAdapterSource).toContain("from '@legacy/db.js'");
        expect(scheduleAdapterSource).not.toMatch(directLegacyImportPattern);
        expect(playerAdapterSource).not.toMatch(directLegacyImportPattern);
    });
});
