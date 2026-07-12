import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getSportTemplateOptions } from '../../js/sport-templates.js';

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

    it('migrates stat config selection when an existing team changes sports', () => {
        const source = readEditTeamSource();

        expect(source).toContain("from './js/team-stat-config-migration.js?v=1'");
        expect(source).toContain('const [existingConfigs, existingGames] = await Promise.all([');
        expect(source).toContain('getConfigs(currentTeamId),');
        expect(source).toContain('getGames(currentTeamId)');
        expect(source).toContain('const migrationPlan = buildTeamSportConfigMigrationPlan({');
        expect(source).toContain('configs: existingConfigs,');
        expect(source).toContain('games: existingGames');
        expect(source).toContain('statTrackerConfigId: targetConfigId');
        expect(source).toContain('sport: teamData.sport');
        expect(source).toContain('await updateTeam(currentTeamId, teamData);');
    });

    it('offers every built-in sport template in the required sport select', () => {
        const source = readEditTeamSource();
        const selectMatch = source.match(/<select id="sport" required[\s\S]*?<\/select>/);

        expect(selectMatch).not.toBeNull();

        const sportSelect = selectMatch[0];
        const optionValues = [...sportSelect.matchAll(/<option value="([^"]+)"/g)]
            .map(match => match[1])
            .filter(Boolean);

        expect(optionValues).toEqual(getSportTemplateOptions().map(template => template.sport));
    });
});
