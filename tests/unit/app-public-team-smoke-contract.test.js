import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public team browser smoke module contract', () => {
    it('provides every service export imported by the public detail route', () => {
        const page = readFileSync(new URL('../../apps/app/src/pages/PublicTeamDetail.tsx', import.meta.url), 'utf8');
        const smoke = readFileSync(new URL('../smoke/app-teams.spec.js', import.meta.url), 'utf8');
        const serviceImport = page.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/lib\/publicTeamsService['"]/);
        expect(serviceImport, 'public detail service imports must be discoverable').not.toBeNull();
        const names = serviceImport[1].split(',')
            .map((name) => name.trim())
            .filter((name) => !name.startsWith('type '))
            .map((name) => name.split(/\s+as\s+/)[0]);
        const mock = smoke.split('async function mockPublicTeamsBrowseModule(')[1]
            ?.split('async function mockTeamCreationModule(')[0];
        expect(mock, 'the public teams service browser stub must exist').toBeTruthy();
        for (const name of names) {
            expect(mock, `browser stub is missing named service export ${name}`)
                .toMatch(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(`));
        }
    });
});
