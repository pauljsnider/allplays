function resolveTeamId(game) {
    return game.teamId || game.team?.id || '';
}

export function applyHeroCta(user, heroCta) {
    if (!heroCta) {
        return;
    }

    if (user) {
        heroCta.textContent = 'Go to Dashboard';
        heroCta.href = 'dashboard.html';
        return;
    }

    heroCta.textContent = 'Create Your Team';
    heroCta.href = 'login.html#signup';
}

export async function loadLiveGames({
    container,
    getLiveGamesNow,
    getUpcomingLiveGames,
    formatDate,
    formatTime,
    logger = console
}) {
    if (!container) {
        return;
    }

    try {
        let liveGames = [];
        let upcomingGames = [];

        try {
            liveGames = await getLiveGamesNow();
        } catch (error) {
            logger.warn('Could not load live games:', error?.message || error);
        }

        try {
            upcomingGames = await getUpcomingLiveGames(6);
        } catch (error) {
            logger.warn('Could not load upcoming games:', error?.message || error);
        }

        const combined = [
            ...liveGames.map((game) => ({ ...game, isLive: true })),
            ...upcomingGames.filter((game) => !liveGames.find((liveGame) => liveGame.id === game.id))
        ].slice(0, 6);

        if (combined.length === 0) {
            container.innerHTML = '<div class="text-center py-8 text-gray-500 col-span-full">No upcoming live games scheduled</div>';
            return;
        }

        container.innerHTML = combined.map((game) => `
          <a href="live-game.html?teamId=${resolveTeamId(game)}&gameId=${game.id}"
             class="block bg-white rounded-xl shadow hover:shadow-lg transition border border-gray-200 p-5 ${game.isLive ? 'ring-2 ring-red-500' : ''}">
            ${game.isLive ? `
              <div class="flex items-center gap-2 mb-2">
                <span class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                <span class="text-red-600 text-xs font-semibold uppercase">Live Now</span>
                ${game.liveViewerCount ? `<span class="text-gray-400 text-xs">${game.liveViewerCount} watching</span>` : ''}
              </div>
            ` : ''}
            <div class="flex items-center gap-3 mb-2">
              ${game.team?.photoUrl
                ? `<img src="${game.team.photoUrl}" class="w-10 h-10 rounded-full object-cover" alt="${game.team?.name || 'Team'}">`
                : `<div class="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold">${game.team?.name?.[0] || '?'}</div>`
              }
              <div>
                <div class="font-semibold text-gray-900">${game.team?.name || 'Team'}</div>
                <div class="text-sm text-gray-500">vs ${game.opponent || 'Opponent'}</div>
              </div>
            </div>
            ${game.isLive ? `
              <div class="text-2xl font-bold text-center py-2">${game.homeScore || 0} - ${game.awayScore || 0}</div>
            ` : `
              <div class="text-sm text-gray-500">${formatDate(game.date)} • ${formatTime(game.date)}</div>
            `}
            <div class="mt-2 text-center text-primary-600 text-sm font-semibold">${game.isLive ? 'Watch Now →' : 'View Details →'}</div>
          </a>
        `).join('');
    } catch (error) {
        logger.error('Failed to load live games:', error);
        container.innerHTML = '<div class="text-center py-8 text-gray-500 col-span-full">Unable to load games</div>';
    }
}

export async function loadPastGames({
    container,
    getRecentLiveTrackedGames,
    formatDate,
    logger = console
}) {
    if (!container) {
        return;
    }

    try {
        const pastGames = await getRecentLiveTrackedGames(6);
        if (pastGames.length === 0) {
            container.innerHTML = '<div class="text-center py-8 text-gray-500 col-span-full">No recent replays available</div>';
            return;
        }

        container.innerHTML = pastGames.map((game) => `
          <a href="live-game.html?teamId=${resolveTeamId(game)}&gameId=${game.id}&replay=true"
             class="block bg-white rounded-xl shadow hover:shadow-lg transition border border-gray-200 p-5">
            <div class="flex items-center gap-3 mb-3">
              ${game.team?.photoUrl
                ? `<img src="${game.team.photoUrl}" class="w-10 h-10 rounded-full object-cover" alt="${game.team?.name || 'Team'}">`
                : `<div class="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold">${game.team?.name?.[0] || '?'}</div>`
              }
              <div>
                <div class="font-semibold text-gray-900">${game.team?.name || 'Team'}</div>
                <div class="text-sm text-gray-500">vs ${game.opponent || 'Opponent'}</div>
              </div>
            </div>
            <div class="text-2xl font-bold text-center py-2 text-gray-900">${game.homeScore || 0} - ${game.awayScore || 0}</div>
            <div class="text-xs text-gray-400 text-center mb-2">${formatDate(game.date)}</div>
            <div class="text-center text-teal-600 text-sm font-semibold">Watch Replay →</div>
          </a>
        `).join('');
    } catch (error) {
        logger.error('Failed to load past games:', error);
        container.innerHTML = '<div class="text-center py-8 text-gray-500 col-span-full">Unable to load replays</div>';
    }
}

export async function initHomepage({
    document = globalThis.document,
    checkAuth,
    renderHeader,
    getLiveGamesNow,
    getUpcomingLiveGames,
    getRecentLiveTrackedGames,
    formatDate,
    formatTime,
    logger = console
}) {
    const heroCta = document.getElementById('hero-cta');

    checkAuth((user) => {
        renderHeader(document.getElementById('header-container'), user);
        applyHeroCta(user, heroCta);
    });

    await Promise.all([
        loadLiveGames({
            container: document.getElementById('live-games-list'),
            getLiveGamesNow,
            getUpcomingLiveGames,
            formatDate,
            formatTime,
            logger
        }),
        loadPastGames({
            container: document.getElementById('past-games-list'),
            getRecentLiveTrackedGames,
            formatDate,
            logger
        })
    ]);
}
