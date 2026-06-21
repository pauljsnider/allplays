import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const appLibDir = join(repoRoot, 'apps/app/src/lib');
const adapterDir = join(appLibDir, 'adapters');
const directLegacyImportPattern = /from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/js\//;

function collectSourceFiles(dir) {
    return readdirSync(dir).flatMap((entry) => {
        const fullPath = join(dir, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
            return collectSourceFiles(fullPath);
        }
        return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
    });
}

function readRepoFile(path) {
    return readFileSync(join(repoRoot, path), 'utf8');
}

describe('app legacy adapter boundary', () => {
    it('keeps direct legacy js imports inside adapter modules', () => {
        const nonAdapterLegacyImports = collectSourceFiles(appLibDir)
            .filter((filePath) => !filePath.startsWith(adapterDir))
            .filter((filePath) => directLegacyImportPattern.test(readFileSync(filePath, 'utf8')))
            .map((filePath) => relative(repoRoot, filePath));

        expect(nonAdapterLegacyImports).toEqual([]);
    });

    it('routes schedule and player services through typed legacy adapters', () => {
        const scheduleServiceSource = readRepoFile('apps/app/src/lib/scheduleService.ts');
        const playerServiceSource = readRepoFile('apps/app/src/lib/playerService.ts');
        const scheduleAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyScheduleDb.ts');
        const playerAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyPlayerDb.ts');

        expect(scheduleServiceSource).toContain("from './adapters/legacyScheduleDb'");
        expect(playerServiceSource).toContain("from './adapters/legacyPlayerDb'");
        expect(scheduleAdapterSource).toContain("from '../../../../../js/db.js'");
        expect(playerAdapterSource).toContain("from '../../../../../js/db.js'");
    });
});
