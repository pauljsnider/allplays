const TRACKER_PAGE_BY_CHOICE = {
  standard: 'track.html',
  beta: 'track-basketball.html',
  live: 'live-tracker.html',
  photo: 'track-statsheet.html'
};

export function isBasketballConfig(configId, configs = [], teamSport = '') {
  if (configId) {
    const config = (configs || []).find(item => item.id === configId);
    if (config) {
      return (config.baseType || '').toLowerCase() === 'basketball';
    }
  }
  return (teamSport || '').toLowerCase().includes('basketball');
}

export function getTrackerPage(choice = 'standard') {
  return TRACKER_PAGE_BY_CHOICE[choice] || TRACKER_PAGE_BY_CHOICE.standard;
}

export function buildTrackerHref(teamId, gameId, choice = 'standard') {
  return `${getTrackerPage(choice)}#teamId=${teamId}&gameId=${gameId}`;
}

export function resolveTrackGameRouting({ gameId, game, configs = [], teamSport = '', teamId }) {
  if (!game || !gameId || !teamId) {
    return { action: 'noop' };
  }

  const basketball = isBasketballConfig(game.statTrackerConfigId, configs, teamSport);
  if (basketball) {
    return { action: 'modal', pendingGameId: gameId };
  }

  return { action: 'redirect', href: buildTrackerHref(teamId, gameId, 'standard') };
}

export function resolveCalendarTrackRouting({ configId, configs = [], teamSport = '', teamId, gameId }) {
  if (!gameId || !teamId) {
    return { action: 'noop' };
  }

  if (isBasketballConfig(configId, configs, teamSport)) {
    return { action: 'modal', pendingGameId: gameId };
  }

  return { action: 'redirect', href: buildTrackerHref(teamId, gameId, 'standard') };
}
