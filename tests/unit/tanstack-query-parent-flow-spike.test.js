import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath) {
    return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('TanStack Query parent flow spike', () => {
    it('documents the parent Home/Schedule recommendation before adding a query dependency', () => {
        const doc = readRepoFile('docs/tanstack-query-parent-flow-spike.md');
        const packageJson = JSON.parse(readRepoFile('package.json'));
        const home = readRepoFile('apps/app/src/pages/Home.tsx');
        const homeService = readRepoFile('apps/app/src/lib/homeService.ts');
        const scheduleService = readRepoFile('apps/app/src/lib/scheduleService.ts');

        expect(doc).toContain('Do not add TanStack Query for this slice yet.');
        expect(doc).toContain('Home primary and secondary loads are already routed through `useAsyncOperation`.');
        expect(doc).toContain('Schedule summary data is cached through `appDataCache`');
        expect(doc).toContain('Introduce a query client at the app shell only after measuring the bundle and startup impact.');

        expect(packageJson.dependencies || {}).not.toHaveProperty('@tanstack/react-query');
        expect(packageJson.devDependencies || {}).not.toHaveProperty('@tanstack/react-query');
        expect(home).toContain("import { useAsyncOperation } from '../lib/useAsyncOperation';");
        expect(homeService).toContain('loadCachedAppData(');
        expect(scheduleService).toContain('getParentScheduleSummaryCacheKey');
    });
});
