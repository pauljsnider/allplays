import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const directLegacyReferencePattern = /(from\s+['"](?:\.\.\/){4,}js\/|import\(['"](?:\.\.\/){4,}js\/)/;

function readRepoFile(path) {
    return readFileSync(join(repoRoot, path), 'utf8');
}

function listSourceFiles(dir) {
    return readdirSync(join(repoRoot, dir)).flatMap((entry) => {
        const absolutePath = join(repoRoot, dir, entry);
        const relativePath = `${dir}/${entry}`;
        if (statSync(absolutePath).isDirectory()) {
            return listSourceFiles(relativePath);
        }
        return /\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)
            ? [relativePath]
            : [];
    });
}

describe('app legacy adapter initiative source contract', () => {
    it('keeps the legacy adapter inventory available for migrated app services', () => {
        const adapterFiles = readdirSync(join(repoRoot, 'apps/app/src/lib/adapters')).sort();

        expect(adapterFiles).toEqual(expect.arrayContaining([
            'legacyChatService.ts',
            'legacyGameReport.ts',
            'legacyHomeFees.ts',
            'legacyParentTools.ts',
            'legacyPlayerDb.ts',
            'legacyProfile.ts',
            'legacyScheduleDb.ts',
            'legacyScheduleHelpers.ts',
            'legacyTeamDetail.ts'
        ]));
    });

    it('keeps the @legacy Vite alias as the preferred bridge to root js modules', () => {
        const viteConfigSource = readRepoFile('apps/app/vite.config.ts');
        const parentToolsAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyParentTools.ts');
        const chatAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyChatService.ts');
        const gameReportAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyGameReport.ts');

        expect(viteConfigSource).toContain("'@legacy': path.resolve(__dirname, '../../js')");
        expect(parentToolsAdapterSource).toContain("import * as legacyDb from '@legacy/db.js';");
        expect(chatAdapterSource).toContain("import * as legacyDb from '@legacy/db.js';");
        expect(gameReportAdapterSource).toContain("from '@legacy/game-report-stats.js';");
    });

    it('keeps direct ../../../../js references limited to known app-shell exceptions and adapter shims', () => {
        const filesWithDirectLegacyReferences = listSourceFiles('apps/app/src')
            .filter((path) => directLegacyReferencePattern.test(readRepoFile(path)))
            .sort();

        expect(filesWithDirectLegacyReferences).toEqual([
            'apps/app/src/lib/adapters/legacyPlayerProfile.ts',
            'apps/app/src/lib/adapters/legacyRosterPrivacy.ts',
            'apps/app/src/lib/adapters/legacyScheduleHelpers.ts',
            'apps/app/src/lib/authService.ts',
            'apps/app/src/lib/pushService.ts',
            'apps/app/src/lib/telemetry.ts'
        ]);
    });

    it('routes migrated parent tools, chat, schedule, player, and game report services through adapters', () => {
        const servicePaths = [
            'apps/app/src/lib/parentToolsService.ts',
            'apps/app/src/lib/chatService.ts',
            'apps/app/src/lib/scheduleService.ts',
            'apps/app/src/lib/playerService.ts',
            'apps/app/src/lib/gameReportService.ts'
        ];

        servicePaths.forEach((path) => {
            expect(readRepoFile(path)).not.toMatch(directLegacyReferencePattern);
        });

        expect(readRepoFile('apps/app/src/lib/parentToolsService.ts')).toContain("from './adapters/legacyParentTools'");
        expect(readRepoFile('apps/app/src/lib/chatService.ts')).toContain("from './adapters/legacyChatService'");
        expect(readRepoFile('apps/app/src/lib/scheduleService.ts')).toContain("from './adapters/legacyScheduleDb'");
        expect(readRepoFile('apps/app/src/lib/scheduleService.ts')).toContain("from './adapters/legacyScheduleHelpers'");
        expect(readRepoFile('apps/app/src/lib/playerService.ts')).toContain("from './adapters/legacyPlayerDb'");
        expect(readRepoFile('apps/app/src/lib/gameReportService.ts')).toContain("from './adapters/legacyGameReport'");
    });
});
