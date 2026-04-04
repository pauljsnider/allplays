function resolveTeamId(game) {
    return game.teamId || game.team?.id || '';
}

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function buildLiveGameHref(game, replay = false) {
    const params = new URLSearchParams({
        teamId: String(resolveTeamId(game) ?? ''),
        gameId: String(game?.id ?? '')
    });

    if (replay) {
        params.set('replay', 'true');
    }

    return `live-game.html?${params.toString()}`;
}

function renderTeamAvatar(game) {
    const teamName = escapeHtml(game.team?.name || 'Team');
    const teamPhotoUrl = game.team?.photoUrl ? escapeHtml(game.team.photoUrl) : '';
    const teamInitial = escapeHtml(game.team?.name?.[0] || '?');

    if (teamPhotoUrl) {
        return `<img src="${teamPhotoUrl}" class="w-10 h-10 rounded-full object-cover" alt="${teamName}">`;
    }

    return `<div class="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold">${teamInitial}</div>`;
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
          <a href="${buildLiveGameHref(game)}"
             class="block bg-white rounded-xl shadow hover:shadow-lg transition border border-gray-200 p-5 ${game.isLive ? 'ring-2 ring-red-500' : ''}">
            ${game.isLive ? `
              <div class="flex items-center gap-2 mb-2">
                <span class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                <span class="text-red-600 text-xs font-semibold uppercase">Live Now</span>
                ${game.liveViewerCount ? `<span class="text-gray-400 text-xs">${escapeHtml(game.liveViewerCount)} watching</span>` : ''}
              </div>
            ` : ''}
            <div class="flex items-center gap-3 mb-2">
              ${renderTeamAvatar(game)}
              <div>
                <div class="font-semibold text-gray-900">${escapeHtml(game.team?.name || 'Team')}</div>
                <div class="text-sm text-gray-500">vs ${escapeHtml(game.opponent || 'Opponent')}</div>
              </div>
            </div>
            ${game.isLive ? `
              <div class="text-2xl font-bold text-center py-2">${escapeHtml(game.homeScore || 0)} - ${escapeHtml(game.awayScore || 0)}</div>
            ` : `
              <div class="text-sm text-gray-500">${escapeHtml(formatDate(game.date))} • ${escapeHtml(formatTime(game.date))}</div>
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
        const pastGamesResult = await getRecentLiveTrackedGames(6);
        const pastGames = Array.isArray(pastGamesResult) ? pastGamesResult : [];
        if (pastGames.length === 0) {
            container.innerHTML = '<div class="text-center py-8 text-gray-500 col-span-full">No recent replays available</div>';
            return;
        }

        container.innerHTML = pastGames.map((game) => `
          <a href="${buildLiveGameHref(game, true)}"
             class="block bg-white rounded-xl shadow hover:shadow-lg transition border border-gray-200 p-5">
            <div class="flex items-center gap-3 mb-3">
              ${renderTeamAvatar(game)}
              <div>
                <div class="font-semibold text-gray-900">${escapeHtml(game.team?.name || 'Team')}</div>
                <div class="text-sm text-gray-500">vs ${escapeHtml(game.opponent || 'Opponent')}</div>
              </div>
            </div>
            <div class="text-2xl font-bold text-center py-2 text-gray-900">${escapeHtml(game.homeScore ?? 0)} - ${escapeHtml(game.awayScore ?? 0)}</div>
            <div class="text-xs text-gray-400 text-center mb-2">${escapeHtml(formatDate(game.date))}</div>
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
