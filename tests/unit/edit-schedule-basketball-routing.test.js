import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

function buildIsBasketballConfig({ allConfigs, currentTeam }) {
    const source = readEditSchedule();
    const match = source.match(/function isBasketballConfig\(configId\) \{([\s\S]*?)\n        \}\n\n        function isBasketballForGame/);
    expect(match, 'isBasketballConfig should exist').toBeTruthy();

    const createHelper = new Function('deps', `
        const { allConfigs, currentTeam } = deps;
        return function(configId) {
${match[1]}
        };
    `);

    return createHelper({ allConfigs, currentTeam });
}

function buildTrackerRoutingHelpers({ allConfigs, currentTeam }) {
    const source = readEditSchedule();
    const match = source.match(/function isBasketballConfig\(configId\) \{([\s\S]*?)\n        \}\n\n        function closeBasketballTrackerModal/);
    expect(match, 'tracker routing helpers should exist').toBeTruthy();

    const createHelpers = new Function('deps', `
        const { allConfigs, currentTeam, getGoalSportProfile } = deps;
        ${match[0].replace('\n\n        function closeBasketballTrackerModal', '')}
        return { isBasketballConfig, isBasketballForGame, getStatConfigForGame, isGoalSportForGame };
    `);

    return createHelpers({
        allConfigs,
        currentTeam,
        getGoalSportProfile: ({ sport }) => {
            const normalized = String(sport || '').trim().toLowerCase();
            return ['soccer', 'hockey', 'lacrosse', 'field hockey', 'water polo'].includes(normalized)
                ? { sport: normalized }
                : null;
        }
    });
}

describe('edit schedule basketball tracker routing', () => {
    it('falls back to the team sport when a referenced config has no baseType', () => {
        const isBasketballConfig = buildIsBasketballConfig({
            allConfigs: [{ id: 'config-1' }],
            currentTeam: { sport: 'Basketball' }
        });

        expect(isBasketballConfig('config-1')).toBe(true);
    });

    it('still returns false when an explicit non-basketball baseType is present', () => {
        const isBasketballConfig = buildIsBasketballConfig({
            allConfigs: [{ id: 'config-2', baseType: 'Soccer' }],
            currentTeam: { sport: 'Basketball' }
        });

        expect(isBasketballConfig('config-2')).toBe(false);
    });

    it('offers simple live only for non-basketball goal sports', () => {
        const helpers = buildTrackerRoutingHelpers({
            allConfigs: [
                { id: 'soccer-config', baseType: 'Soccer' },
                { id: 'basketball-config', baseType: 'Basketball' },
                { id: 'baseball-config', baseType: 'Baseball' }
            ],
            currentTeam: { sport: 'Soccer' }
        });

        expect(helpers.isGoalSportForGame({ statTrackerConfigId: 'soccer-config' })).toBe(true);
        expect(helpers.isGoalSportForGame({ statTrackerConfigId: null })).toBe(true);
        expect(helpers.isGoalSportForGame({ statTrackerConfigId: 'basketball-config' })).toBe(false);
        expect(helpers.isGoalSportForGame({ statTrackerConfigId: 'baseball-config' })).toBe(false);
    });

    it('wires full and simple live broadcast choices without changing the full tracker route', () => {
        const source = readEditSchedule();

        expect(source).toContain('id="basketball-tracker-live-simple"');
        expect(source).toContain('Live Broadcast Simple');
        expect(source).toContain("import { getGoalSportProfile } from './js/live-sport-config.js?v=3';");
        expect(source).toContain("const simpleBtn = document.getElementById('basketball-tracker-live-simple');");
        expect(source).toContain("if (simpleBtn) simpleBtn.classList.toggle('hidden', !supportsSimpleLive);");
        expect(source).toContain('openTrackerChoiceModal(gameId, isBasketballForGame(game), isGoalSportForGame(game));');
        expect(source).toContain('const trackingGame = {');
        expect(source).toContain('openTrackerChoiceModal(gameId, isBasketballConfig(configId), isGoalSportForGame(trackingGame));');
        expect(source).toContain('window.location.href = `track-live.html?v=2#teamId=${currentTeamId}&gameId=${gameId}`;');
        expect(source).toContain('window.location.href = `track-live.html?v=2#teamId=${currentTeamId}&gameId=${gameId}&trackerMode=simple`;');
    });
});
