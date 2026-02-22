const { test, expect } = require('@playwright/test');

async function callRouting(page, fnName, args) {
  return page.evaluate(
    async ({ fnNameArg, argsArg }) => {
      const mod = await import('/js/schedule-tracker-routing.js');
      return mod[fnNameArg](...argsArg);
    },
    { fnNameArg: fnName, argsArg: args }
  );
}

// @critical
test.describe('Schedule/tracker routing suite @critical', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('isBasketballConfig returns true for basketball baseType (case-insensitive)', async ({ page }) => {
    const result = await callRouting(page, 'isBasketballConfig', [
      'cfg-1',
      [{ id: 'cfg-1', baseType: 'BasketBall' }],
      'Soccer'
    ]);

    expect(result).toBe(true);
  });

  test('isBasketballConfig returns false for non-basketball config even if team sport is basketball', async ({ page }) => {
    const result = await callRouting(page, 'isBasketballConfig', [
      'cfg-1',
      [{ id: 'cfg-1', baseType: 'Soccer' }],
      'Basketball'
    ]);

    expect(result).toBe(false);
  });

  test('isBasketballConfig falls back to team sport when config is missing', async ({ page }) => {
    const result = await callRouting(page, 'isBasketballConfig', ['missing', [], 'Girls Basketball']);

    expect(result).toBe(true);
  });

  test('isBasketballConfig returns false when config is missing and team sport is not basketball', async ({ page }) => {
    const result = await callRouting(page, 'isBasketballConfig', ['missing', [], 'Volleyball']);

    expect(result).toBe(false);
  });

  test('resolveTrackGameRouting returns noop when game is missing', async ({ page }) => {
    const result = await callRouting(page, 'resolveTrackGameRouting', [
      { gameId: 'g1', game: null, configs: [], teamSport: 'Basketball', teamId: 't1' }
    ]);

    expect(result).toEqual({ action: 'noop' });
  });

  test('resolveTrackGameRouting routes basketball games to chooser modal', async ({ page }) => {
    const result = await callRouting(page, 'resolveTrackGameRouting', [
      {
        gameId: 'g1',
        game: { statTrackerConfigId: 'cfg-1' },
        configs: [{ id: 'cfg-1', baseType: 'basketball' }],
        teamSport: 'Soccer',
        teamId: 't1'
      }
    ]);

    expect(result).toEqual({ action: 'modal', pendingGameId: 'g1' });
  });

  test('resolveTrackGameRouting routes non-basketball games to standard tracker', async ({ page }) => {
    const result = await callRouting(page, 'resolveTrackGameRouting', [
      {
        gameId: 'g1',
        game: { statTrackerConfigId: 'cfg-2' },
        configs: [{ id: 'cfg-2', baseType: 'soccer' }],
        teamSport: 'Soccer',
        teamId: 't1'
      }
    ]);

    expect(result).toEqual({ action: 'redirect', href: 'track.html#teamId=t1&gameId=g1' });
  });

  test('resolveCalendarTrackRouting routes basketball calendar games to chooser modal', async ({ page }) => {
    const result = await callRouting(page, 'resolveCalendarTrackRouting', [
      { configId: 'cfg-1', configs: [{ id: 'cfg-1', baseType: 'basketball' }], teamSport: 'Soccer', teamId: 't1', gameId: 'g1' }
    ]);

    expect(result).toEqual({ action: 'modal', pendingGameId: 'g1' });
  });

  test('resolveCalendarTrackRouting routes non-basketball calendar games to standard tracker', async ({ page }) => {
    const result = await callRouting(page, 'resolveCalendarTrackRouting', [
      { configId: 'cfg-1', configs: [{ id: 'cfg-1', baseType: 'soccer' }], teamSport: 'Soccer', teamId: 't1', gameId: 'g1' }
    ]);

    expect(result).toEqual({ action: 'redirect', href: 'track.html#teamId=t1&gameId=g1' });
  });

  test('buildTrackerHref returns beta tracker URL', async ({ page }) => {
    const result = await callRouting(page, 'buildTrackerHref', ['team-7', 'game-42', 'beta']);

    expect(result).toBe('track-basketball.html#teamId=team-7&gameId=game-42');
  });

  test('buildTrackerHref returns live tracker URL', async ({ page }) => {
    const result = await callRouting(page, 'buildTrackerHref', ['team-7', 'game-42', 'live']);

    expect(result).toBe('live-tracker.html#teamId=team-7&gameId=game-42');
  });

  test('buildTrackerHref defaults unknown choices to standard tracker URL', async ({ page }) => {
    const result = await callRouting(page, 'buildTrackerHref', ['team-7', 'game-42', 'unknown-choice']);

    expect(result).toBe('track.html#teamId=team-7&gameId=game-42');
  });
});
