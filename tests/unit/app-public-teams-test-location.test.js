import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');

describe('public teams unit test organization', () => {
    it('keeps the public teams regression suites in the root unit test workflow', () => {
        const movedSuites = [
            ['tests/unit/app-public-team-search.test.tsx', 'apps/app/src/components/PublicTeamSearch.test.tsx'],
            ['tests/unit/app-public-teams-browse.test.tsx', 'apps/app/src/pages/PublicTeamsBrowse.test.tsx'],
            ['tests/unit/app-public-teams-service.test.ts', 'apps/app/src/lib/publicTeamsService.test.ts'],
        ];

        for (const [rootSuite, colocatedSuite] of movedSuites) {
            expect(existsSync(resolve(repoRoot, rootSuite)), `${rootSuite} should exist`).toBe(true);
            expect(existsSync(resolve(repoRoot, colocatedSuite)), `${colocatedSuite} should be removed`).toBe(false);
        }
    });
});
