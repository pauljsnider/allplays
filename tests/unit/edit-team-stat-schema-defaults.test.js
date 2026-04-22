import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditTeamSource() {
    return readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');
}

describe('edit team stat schema defaults', () => {
    it('uses the shared preset catalog when seeding a new team config', () => {
        const source = readEditTeamSource();

        expect(source).toContain("from './js/stat-config-presets.js?v=1'");
        expect(source).toContain('const defaultStatConfig = getDefaultStatConfigForSport(teamData.sport);');
        expect(source).toContain('const configId = await addConfig(newTeamId, defaultStatConfig);');
    });
});
