import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

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
        getGoalSportProfile: goalSportProfileStub
    });
}

function goalSportProfileStub({ sport }) {
    const normalized = String(sport || '').trim().toLowerCase();
    return ['soccer', 'hockey', 'lacrosse', 'field hockey', 'water polo'].includes(normalized)
        ? { sport: normalized }
        : null;
}

function buildTrackChoiceDomHarness({ allConfigs, currentTeam, gamesCache, currentTeamId = 'team-123' }) {
    const source = readEditSchedule();
    const helpersMatch = source.match(/let pendingTrackGameId = null;[\s\S]*?function handleTrackClick\(gameId\) \{[\s\S]*?\n\s+\}(?=\n\n\s+function renderDbGame)/);
    const handlersMatch = source.match(/document\.getElementById\('basketball-tracker-cancel'\)[\s\S]*?window\.location\.href = `track-statsheet\.html#teamId=\$\{currentTeamId\}&gameId=\$\{gameId\}`;[\s\S]*?\}\);/);
    expect(helpersMatch, 'track choice helpers should exist').toBeTruthy();
    expect(handlersMatch, 'track choice click handlers should exist').toBeTruthy();

    const dom = new JSDOM(`
        <div id="basketball-tracker-modal" class="hidden">
            <p id="tracker-choice-description"></p>
            <div id="tracker-recommended-action">
                <button id="basketball-tracker-standard" data-tracker-label="Standard Tracker">
                    <span data-tracker-label-text>Standard Tracker</span>
                </button>
            </div>
            <details id="tracker-advanced-options" open>
                <div id="tracker-advanced-actions">
                    <button id="basketball-tracker-beta" data-tracker-label="Basketball Beta">
                        <span data-tracker-label-text>Basketball Beta</span>
                    </button>
                    <button id="basketball-tracker-live" data-tracker-label="Live Broadcast Tracker">
                        <span data-tracker-label-text>Live Broadcast Tracker</span>
                    </button>
                    <button id="basketball-tracker-live-simple" data-tracker-label="Simple Live Tracker" class="hidden">
                        <span data-tracker-label-text>Simple Live Tracker</span>
                    </button>
                    <button id="basketball-tracker-photo" data-tracker-label="Photo Score Sheet">
                        <span data-tracker-label-text>Photo Score Sheet</span>
                    </button>
                </div>
            </details>
            <button id="basketball-tracker-cancel"></button>
        </div>
    `);
    const fakeWindow = { location: { href: '' } };

    const createHarness = new Function('deps', `
        const { document, window, alert, allConfigs, currentTeam, currentTeamId, getGoalSportProfile } = deps;
        ${helpersMatch[0]}
        gamesCache = deps.gamesCache;
        ${handlersMatch[0]}
        return {
            handleTrackClick,
            alert,
            getHref: () => window.location.href,
            getDescription: () => document.getElementById('tracker-choice-description').textContent,
            getRecommendedId: () => document.querySelector('#tracker-recommended-action > button')?.id,
            getTrackerLabel: (id) => document.querySelector('#' + id + ' [data-tracker-label-text]')?.textContent,
            getTrackerParentId: (id) => document.getElementById(id)?.parentElement?.id,
            getRecommendedCount: () => document.querySelectorAll('[data-recommended="true"]').length,
            isAdvancedOpen: () => document.getElementById('tracker-advanced-options').open,
            isHidden: (id) => document.getElementById(id).classList.contains('hidden'),
            click: (id) => document.getElementById(id).click()
        };
    `);

    return createHarness({
        document: dom.window.document,
        window: fakeWindow,
        alert: vi.fn(),
        allConfigs,
        currentTeam,
        currentTeamId,
        gamesCache,
        getGoalSportProfile: goalSportProfileStub
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
        expect(source).toContain('Simple Live Tracker');
        expect(source).toContain("import { getGoalSportProfile } from './js/live-sport-config.js?v=3';");
        expect(source).toContain('id="tracker-recommended-action"');
        expect(source).toContain('id="tracker-advanced-options"');
        expect(source).toContain('More tracker options');
        expect(source).toContain("const simpleBtn = document.getElementById('basketball-tracker-live-simple');");
        expect(source).toContain("if (simpleBtn) simpleBtn.classList.toggle('hidden', !supportsSimpleLive);");
        expect(source).toContain('openTrackerChoiceModal(gameId, isBasketballForGame(game), isGoalSportForGame(game));');
        expect(source).toContain('const trackingGame = {');
        expect(source).toContain('openTrackerChoiceModal(gameId, isBasketballConfig(configId), isGoalSportForGame(trackingGame));');
        expect(source).toContain('window.location.href = `track-live.html?v=2#teamId=${currentTeamId}&gameId=${gameId}`;');
        expect(source).toContain('window.location.href = `track-live.html?v=2#teamId=${currentTeamId}&gameId=${gameId}&trackerMode=simple`;');
    });

    it('opens the schedule Track chooser for basketball games and preserves team/game routing', () => {
        for (const [buttonId, expectedHref] of [
            ['basketball-tracker-standard', 'track.html#teamId=team-123&gameId=game-456'],
            ['basketball-tracker-beta', 'track-basketball.html#teamId=team-123&gameId=game-456'],
            ['basketball-tracker-live', 'live-tracker.html#teamId=team-123&gameId=game-456'],
            ['basketball-tracker-photo', 'track-statsheet.html#teamId=team-123&gameId=game-456']
        ]) {
            const harness = buildTrackChoiceDomHarness({
                allConfigs: [{ id: 'basketball-config', baseType: 'Basketball' }],
                currentTeam: { sport: 'Basketball' },
                gamesCache: {
                    'game-456': { id: 'game-456', statTrackerConfigId: 'basketball-config' }
                }
            });
            harness.handleTrackClick('game-456');
            expect(harness.isHidden('basketball-tracker-modal')).toBe(false);
            expect(harness.isHidden('basketball-tracker-beta')).toBe(false);
            expect(harness.isHidden('basketball-tracker-photo')).toBe(false);
            expect(harness.getDescription()).toContain('Basketball stat config');
            expect(harness.getRecommendedId()).toBe('basketball-tracker-live');
            expect(harness.getTrackerLabel('basketball-tracker-live')).toBe('Start Live Tracker');
            expect(harness.getRecommendedCount()).toBe(1);
            expect(harness.isAdvancedOpen()).toBe(false);
            expect(harness.getTrackerParentId('basketball-tracker-standard')).toBe('tracker-advanced-actions');
            harness.click(buttonId);
            expect(harness.getHref()).toBe(expectedHref);
        }
    });

    it('hides basketball-only chooser actions for non-basketball games and routes live tracking', () => {
        const harness = buildTrackChoiceDomHarness({
            allConfigs: [{ id: 'soccer-config', baseType: 'Soccer' }],
            currentTeam: { sport: 'Soccer' },
            gamesCache: {
                'game-789': { id: 'game-789', statTrackerConfigId: 'soccer-config' }
            }
        });

        harness.handleTrackClick('game-789');

        expect(harness.isHidden('basketball-tracker-modal')).toBe(false);
        expect(harness.isHidden('basketball-tracker-beta')).toBe(true);
        expect(harness.isHidden('basketball-tracker-photo')).toBe(true);
        expect(harness.isHidden('basketball-tracker-live-simple')).toBe(false);
        expect(harness.getRecommendedId()).toBe('basketball-tracker-live-simple');
        expect(harness.getTrackerLabel('basketball-tracker-live-simple')).toBe('Start Simple Live Tracker');
        expect(harness.getRecommendedCount()).toBe(1);
        expect(harness.getTrackerParentId('basketball-tracker-live')).toBe('tracker-advanced-actions');
        harness.click('basketball-tracker-live');
        expect(harness.getHref()).toBe('track-live.html?v=2#teamId=team-123&gameId=game-789');
    });

    it('recommends the standard tracker for a generic sport while keeping live advanced', () => {
        const harness = buildTrackChoiceDomHarness({
            allConfigs: [{ id: 'baseball-config', baseType: 'Baseball' }],
            currentTeam: { sport: 'Baseball' },
            gamesCache: {
                'game-generic': { id: 'game-generic', statTrackerConfigId: 'baseball-config' }
            }
        });

        harness.handleTrackClick('game-generic');

        expect(harness.getRecommendedId()).toBe('basketball-tracker-standard');
        expect(harness.getTrackerLabel('basketball-tracker-standard')).toBe('Start Standard Tracker');
        expect(harness.getRecommendedCount()).toBe(1);
        expect(harness.isHidden('basketball-tracker-beta')).toBe(true);
        expect(harness.isHidden('basketball-tracker-live-simple')).toBe(true);
        expect(harness.isHidden('basketball-tracker-photo')).toBe(true);
        expect(harness.getTrackerParentId('basketball-tracker-live')).toBe('tracker-advanced-actions');
        harness.click('basketball-tracker-standard');
        expect(harness.getHref()).toBe('track.html#teamId=team-123&gameId=game-generic');
    });

    it('renders completed schedule games with Report instead of Track', () => {
        const source = readEditSchedule();

        expect(source).toContain("const isCompleted = game.status === 'completed';");
        expect(source).toContain('${!isCompleted && !isCancelled ? `<button data-game-id="${game.id}" class="track-game-btn');
        expect(source).toContain('${isCompleted ? `<a href="game.html#teamId=${currentTeamId}&gameId=${game.id}"');
    });
});
