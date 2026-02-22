import { describe, it, expect } from 'vitest';
import {
  isBasketballConfig,
  getTrackerPage,
  buildTrackerHref,
  resolveTrackGameRouting,
  resolveCalendarTrackRouting
} from '../../js/schedule-tracker-routing.js';

describe('schedule tracker routing helpers', () => {
  it('isBasketballConfig returns true for matching basketball config', () => {
    expect(
      isBasketballConfig('cfg-1', [{ id: 'cfg-1', baseType: 'BASKETBALL' }], 'soccer')
    ).toBe(true);
  });

  it('isBasketballConfig respects explicit non-basketball config over team sport fallback', () => {
    expect(
      isBasketballConfig('cfg-1', [{ id: 'cfg-1', baseType: 'soccer' }], 'basketball')
    ).toBe(false);
  });

  it('isBasketballConfig falls back to team sport when configId is missing', () => {
    expect(isBasketballConfig('', [], 'Girls Basketball')).toBe(true);
  });

  it('getTrackerPage returns mapped tracker page for known choice', () => {
    expect(getTrackerPage('live')).toBe('live-tracker.html');
  });

  it('getTrackerPage falls back to standard tracker page for unknown choice', () => {
    expect(getTrackerPage('unknown')).toBe('track.html');
  });

  it('buildTrackerHref builds hash URL with team and game ids', () => {
    expect(buildTrackerHref('team-9', 'game-4', 'beta')).toBe('track-basketball.html#teamId=team-9&gameId=game-4');
  });

  it('resolveTrackGameRouting returns noop when required fields are missing', () => {
    expect(resolveTrackGameRouting({ gameId: '', game: null, teamId: 'team-1' })).toEqual({ action: 'noop' });
  });

  it('resolveTrackGameRouting returns modal action for basketball games', () => {
    expect(
      resolveTrackGameRouting({
        gameId: 'game-2',
        teamId: 'team-1',
        game: { statTrackerConfigId: 'cfg-bb' },
        configs: [{ id: 'cfg-bb', baseType: 'basketball' }],
        teamSport: 'soccer'
      })
    ).toEqual({ action: 'modal', pendingGameId: 'game-2' });
  });

  it('resolveTrackGameRouting returns redirect action for non-basketball games', () => {
    expect(
      resolveTrackGameRouting({
        gameId: 'game-3',
        teamId: 'team-1',
        game: { statTrackerConfigId: 'cfg-soc' },
        configs: [{ id: 'cfg-soc', baseType: 'soccer' }],
        teamSport: 'soccer'
      })
    ).toEqual({ action: 'redirect', href: 'track.html#teamId=team-1&gameId=game-3' });
  });

  it('resolveCalendarTrackRouting returns modal action for basketball calendar game', () => {
    expect(
      resolveCalendarTrackRouting({
        gameId: 'game-5',
        teamId: 'team-1',
        configId: 'cfg-bb',
        configs: [{ id: 'cfg-bb', baseType: 'basketball' }]
      })
    ).toEqual({ action: 'modal', pendingGameId: 'game-5' });
  });

  it('resolveCalendarTrackRouting returns redirect action for non-basketball calendar game', () => {
    expect(
      resolveCalendarTrackRouting({
        gameId: 'game-6',
        teamId: 'team-1',
        configId: 'cfg-soc',
        configs: [{ id: 'cfg-soc', baseType: 'soccer' }],
        teamSport: 'soccer'
      })
    ).toEqual({ action: 'redirect', href: 'track.html#teamId=team-1&gameId=game-6' });
  });

  it('resolveCalendarTrackRouting returns noop when teamId is missing', () => {
    expect(
      resolveCalendarTrackRouting({
        gameId: 'game-6',
        teamId: '',
        configId: 'cfg-soc',
        configs: [{ id: 'cfg-soc', baseType: 'soccer' }]
      })
    ).toEqual({ action: 'noop' });
  });
});
