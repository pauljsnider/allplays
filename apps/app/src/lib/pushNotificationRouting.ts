const pendingPushRouteKey = 'allplays.pendingPushRoute';

type PushPayload = {
    appRoute?: string;
    category?: string;
    teamId?: string;
    conversationId?: string;
    gameId?: string;
    eventId?: string;
    link?: string;
};

function normalizeValue(value: unknown) {
    return String(value || '').trim();
}

function encodeRouteParam(value: string) {
    return encodeURIComponent(value);
}

function buildMessagesRoute(teamId: string, conversationId?: string) {
    const normalizedTeamId = normalizeValue(teamId);
    if (!normalizedTeamId) {
        return '';
    }
    const route = `/messages/${encodeRouteParam(normalizedTeamId)}`;
    const normalizedConversationId = normalizeValue(conversationId);
    if (!normalizedConversationId) {
        return route;
    }
    return `${route}?conversationId=${encodeRouteParam(normalizedConversationId)}`;
}

function buildScheduleEventRoute(teamId: string, eventId: string, section?: string) {
    const normalizedTeamId = normalizeValue(teamId);
    const normalizedEventId = normalizeValue(eventId);
    if (!normalizedTeamId || !normalizedEventId) {
        return '';
    }
    const route = `/schedule/${encodeRouteParam(normalizedTeamId)}/${encodeRouteParam(normalizedEventId)}`;
    const normalizedSection = normalizeValue(section);
    return normalizedSection ? `${route}?section=${encodeRouteParam(normalizedSection)}` : route;
}

function normalizeAppRoute(route: unknown) {
    const value = normalizeValue(route);
    if (!value.startsWith('/')) {
        return '';
    }
    return value;
}

function readPayload(input: unknown): PushPayload {
    if (!input || typeof input !== 'object') {
        return {};
    }
    return input as PushPayload;
}

function buildLegacyLinkFallback(link: string) {
    if (!link) {
        return '';
    }

    try {
        const url = new URL(link);
        const teamId = normalizeValue(url.searchParams.get('teamId'));
        const conversationId = normalizeValue(url.searchParams.get('conversationId'));
        const gameId = normalizeValue(url.searchParams.get('gameId'));
        const path = url.pathname.toLowerCase();

        if (path.endsWith('/team-chat.html') && teamId) {
            return buildMessagesRoute(teamId, conversationId);
        }
        if (path.endsWith('/officials.html')) {
            return teamId ? `/officials?teamId=${encodeRouteParam(teamId)}` : '/officials';
        }
        if (path.endsWith('/live-game.html') && gameId) {
            if (teamId) {
                return buildScheduleEventRoute(teamId, gameId, 'game');
            }
            return '/schedule';
        }
        if (path.endsWith('/game-day.html')) {
            if (teamId && gameId) {
                return buildScheduleEventRoute(teamId, gameId, 'game');
            }
            if (gameId) {
                return `/games/${encodeRouteParam(gameId)}`;
            }
        }
        if (path.endsWith('/team.html') && teamId) {
            return `/teams/${encodeRouteParam(teamId)}`;
        }
    } catch {
        return '';
    }

    return '';
}

export function resolvePushNotificationRoute(input: unknown) {
    const payload = readPayload(input);
    const appRoute = normalizeAppRoute(payload.appRoute);
    const category = normalizeValue(payload.category);
    const teamId = normalizeValue(payload.teamId);
    const conversationId = normalizeValue(payload.conversationId);
    const gameId = normalizeValue(payload.gameId);
    const eventId = normalizeValue(payload.eventId) || gameId;

    if (category === 'liveScore' && gameId) {
        if (teamId) {
            return buildScheduleEventRoute(teamId, gameId, 'game');
        }
        return `/games/${encodeRouteParam(gameId)}`;
    }
    if (category === 'practice' && teamId && eventId) {
        return buildScheduleEventRoute(teamId, eventId, 'game');
    }
    if (category === 'liveChat' && teamId && conversationId) {
        return buildMessagesRoute(teamId, conversationId);
    }
    if (category === 'liveScore' && gameId) {
        if (teamId) {
            return buildScheduleEventRoute(teamId, gameId, 'game');
        }
        return `/games/${encodeRouteParam(gameId)}`;
    }
    if (appRoute) {
        return appRoute;
    }

    if (category === 'liveChat' && teamId) {
        return buildMessagesRoute(teamId, conversationId);
    }
    if (category === 'schedule') {
        if (teamId && eventId) {
            return `/schedule/${encodeRouteParam(teamId)}/${encodeRouteParam(eventId)}`;
        }
        if (teamId) {
            return `/schedule?teamId=${encodeRouteParam(teamId)}`;
        }
        return '/schedule';
    }

    return buildLegacyLinkFallback(normalizeValue(payload.link)) || '/home';
}

export function rememberPendingPushRoute(route: string) {
    const normalized = normalizeAppRoute(route);
    if (!normalized) {
        return;
    }
    window.localStorage.setItem(pendingPushRouteKey, normalized);
}

export function readPendingPushRoute() {
    return normalizeAppRoute(window.localStorage.getItem(pendingPushRouteKey));
}

export function clearPendingPushRoute() {
    window.localStorage.removeItem(pendingPushRouteKey);
}
