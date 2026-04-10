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
});
