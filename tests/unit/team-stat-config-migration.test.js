import { describe, expect, it } from 'vitest';
import { buildTeamSportConfigMigrationPlan } from '../../js/team-stat-config-migration.js';

describe('team stat config migration', () => {
    it('creates a matching config and remaps incomplete games when the team sport changes', () => {
        const plan = buildTeamSportConfigMigrationPlan({
            previousSport: 'Basketball',
            nextSport: 'Soccer',
            configs: [
                { id: 'cfg-basketball', baseType: 'Basketball', columns: ['PTS', 'REB', 'AST'] }
            ],
            games: [
                { id: 'game-upcoming', status: 'scheduled', statTrackerConfigId: 'cfg-basketball' },
                { id: 'game-history', status: 'completed', statTrackerConfigId: 'cfg-basketball' }
            ]
        });

        expect(plan.sportChanged).toBe(true);
        expect(plan.shouldCreateTargetConfig).toBe(true);
        expect(plan.targetConfigId).toBeNull();
        expect(plan.targetConfigData).toMatchObject({
            baseType: 'Soccer',
            columns: ['GOALS', 'SHOTS', 'SHOTS_ON_TARGET', 'ASSISTS', 'SAVES']
        });
        expect(plan.gameIdsToUpdate).toEqual(['game-upcoming']);
    });

    it('reuses an existing matching config instead of creating a duplicate', () => {
        const plan = buildTeamSportConfigMigrationPlan({
            previousSport: 'Basketball',
            nextSport: 'Soccer',
            configs: [
                { id: 'cfg-basketball', baseType: 'Basketball', columns: ['PTS', 'REB', 'AST'] },
                { id: 'cfg-soccer', baseType: 'Soccer', columns: ['GOALS', 'SHOTS'] }
            ],
            games: [
                { id: 'game-upcoming', status: 'scheduled', statTrackerConfigId: 'cfg-basketball' }
            ]
        });

        expect(plan.shouldCreateTargetConfig).toBe(false);
        expect(plan.targetConfigId).toBe('cfg-soccer');
        expect(plan.gameIdsToUpdate).toEqual(['game-upcoming']);
    });

    it('does not remap historical games or unchanged sports', () => {
        const unchangedPlan = buildTeamSportConfigMigrationPlan({
            previousSport: 'Soccer',
            nextSport: 'Soccer',
            configs: [
                { id: 'cfg-soccer', baseType: 'Soccer', columns: ['GOALS'] }
            ],
            games: [
                { id: 'game-upcoming', status: 'scheduled', statTrackerConfigId: 'cfg-soccer' }
            ]
        });
        expect(unchangedPlan).toMatchObject({
            sportChanged: false,
            shouldCreateTargetConfig: false,
            gameIdsToUpdate: []
        });

        const historicalPlan = buildTeamSportConfigMigrationPlan({
            previousSport: 'Basketball',
            nextSport: 'Soccer',
            configs: [
                { id: 'cfg-basketball', baseType: 'Basketball', columns: ['PTS'] }
            ],
            games: [
                { id: 'game-final', status: 'final', statTrackerConfigId: 'cfg-basketball' },
                { id: 'game-live-complete', liveStatus: 'completed', statTrackerConfigId: 'cfg-basketball' }
            ]
        });

        expect(historicalPlan.gameIdsToUpdate).toEqual([]);
    });
});
