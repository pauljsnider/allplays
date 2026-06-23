import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const directLegacyImportPattern = /from\s+['"](?:\.\.\/){4,}js\//;
const forbiddenServiceLegacyImportPattern = /from\s+['"](?:@legacy\/|(?:\.\.\/){4,}js\/)/;

function readRepoFile(path) {
    return readFileSync(join(repoRoot, path), 'utf8');
}

describe('app legacy adapter boundary', () => {
    it('keeps schedule and player services free of direct legacy js imports', () => {
        const scheduleServiceSource = readRepoFile('apps/app/src/lib/scheduleService.ts');
        const playerServiceSource = readRepoFile('apps/app/src/lib/playerService.ts');

        expect(forbiddenServiceLegacyImportPattern.test(scheduleServiceSource)).toBe(false);
        expect(forbiddenServiceLegacyImportPattern.test(playerServiceSource)).toBe(false);
    });

    it('routes schedule and player services through typed legacy adapters', () => {
        const scheduleServiceSource = readRepoFile('apps/app/src/lib/scheduleService.ts');
        const playerServiceSource = readRepoFile('apps/app/src/lib/playerService.ts');
        const scheduleAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyScheduleDb.ts');
        const playerAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyPlayerDb.ts');
        const playerProfileAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyPlayerProfile.ts');
        const rosterPrivacyAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyRosterPrivacy.ts');

        expect(scheduleServiceSource).toContain("from './adapters/legacyScheduleDb'");
        expect(playerServiceSource).toContain("from './adapters/legacyPlayerDb'");
        expect(playerServiceSource).toContain("from './adapters/legacyPlayerProfile'");
        expect(playerServiceSource).toContain("from './adapters/legacyRosterPrivacy'");
        expect(scheduleAdapterSource).toContain("from '@legacy/db.js'");
        expect(scheduleAdapterSource).toContain("from '@legacy/firebase.js'");
        expect(playerAdapterSource).toContain("from '@legacy/db.js'");
        expect(playerProfileAdapterSource).toContain("from '@legacy/parent-incentives.js'");
        expect(rosterPrivacyAdapterSource).toContain("from '@legacy/roster-profile-fields.js'");
        expect(scheduleAdapterSource).not.toMatch(directLegacyImportPattern);
        expect(playerAdapterSource).not.toMatch(directLegacyImportPattern);
        expect(playerProfileAdapterSource).not.toMatch(directLegacyImportPattern);
        expect(rosterPrivacyAdapterSource).not.toMatch(directLegacyImportPattern);
    });

    it('keeps migrated app service clusters behind typed legacy adapters', () => {
        const migratedClusters = [
            ['apps/app/src/lib/homeService.ts', "from './adapters/legacyHomeFees'"],
            ['apps/app/src/lib/searchService.ts', "from './adapters/legacySearchDb'"],
            ['apps/app/src/lib/chatService.ts', "from './adapters/legacyChatService'"],
            ['apps/app/src/lib/socialService.ts', "from './adapters/legacySocialDb'"],
            ['apps/app/src/lib/teamDetailService.ts', "from './adapters/legacyTeamDetail'"],
            ['apps/app/src/lib/teamFeesService.ts', "from './adapters/legacyTeamFees'"],
            ['apps/app/src/lib/parentToolsService.ts', "from './adapters/legacyParentTools'"],
            ['apps/app/src/lib/practiceTimelineService.ts', "from './adapters/legacyPracticeTimeline'"],
            ['apps/app/src/lib/gameReportService.ts', "from './adapters/legacyGameReport'"]
        ];

        migratedClusters.forEach(([path, adapterImport]) => {
            const source = readRepoFile(path);
            expect(source).toContain(adapterImport);
            expect(forbiddenServiceLegacyImportPattern.test(source), path).toBe(false);
        });

        [
            'apps/app/src/lib/adapters/legacyHomeFees.ts',
            'apps/app/src/lib/adapters/legacySearchDb.ts',
            'apps/app/src/lib/adapters/legacyChatService.ts',
            'apps/app/src/lib/adapters/legacySocialDb.ts',
            'apps/app/src/lib/adapters/legacyTeamDetail.ts',
            'apps/app/src/lib/adapters/legacyTeamFees.ts',
            'apps/app/src/lib/adapters/legacyParentTools.ts',
            'apps/app/src/lib/adapters/legacyPracticeTimeline.ts',
            'apps/app/src/lib/adapters/legacyGameReport.ts'
        ].forEach((path) => {
            const source = readRepoFile(path);
            expect(source, path).toMatch(/from\s+['"](?:@legacy\/|\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/js\/)/);
        });
    });

    it('keeps ScheduleEventDetail RSVP helpers behind the schedule helper adapter', () => {
        const detailSource = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const rsvpHookSource = readRepoFile('apps/app/src/hooks/schedule/useScheduleEventRsvp.ts');
        const scheduleServiceSource = readRepoFile('apps/app/src/lib/scheduleService.ts');
        const helperAdapterSource = readRepoFile('apps/app/src/lib/adapters/legacyScheduleHelpers.ts');

        expect(directLegacyImportPattern.test(detailSource)).toBe(false);
        expect(directLegacyImportPattern.test(rsvpHookSource)).toBe(false);
        expect(directLegacyImportPattern.test(scheduleServiceSource)).toBe(false);
        expect(detailSource).toContain("from '../lib/adapters/legacyScheduleHelpers'");
        expect(rsvpHookSource).toContain("from '../../lib/scheduleService'");
        expect(scheduleServiceSource).toContain("from './adapters/legacyScheduleHelpers'");
        expect(helperAdapterSource).toContain("from '../../../../../js/parent-dashboard-rsvp.js'");
        expect(helperAdapterSource).toContain('resolveMyRsvpByChildForGame');
        expect(helperAdapterSource).toContain('buildGameDayRsvpBreakdown');
    });
});
