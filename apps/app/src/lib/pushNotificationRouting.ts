const pendingPushRouteKey = 'allplays.pendingPushRoute';

type PushPayload = {
    appRoute?: string;
    category?: string;
    teamId?: string;
    conversationId?: string;
    gameId?: string;
    eventId?: string;
    batchId?: string;
    recipientId?: string;
    certificateId?: string;
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

function appendQuery(route: string, params: Record<string, string>) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        const normalized = normalizeValue(value);
        if (normalized) {
            query.set(key, normalized);
        }
    });
    const queryString = query.toString();
    return queryString ? `${route}?${queryString}` : route;
}

function normalizeAppRoute(route: unknown) {
    const value = normalizeValue(route);
    if (!value.startsWith('/') || value.startsWith('//')) {
        return '';
    }
    return value;
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
    if (!input || typeof input !== 'object') {
        return '/home';
    }

    const payload = input as PushPayload;
    const appRoute = normalizeAppRoute(payload.appRoute);
    if (appRoute) {
        return appRoute;
    }

    const category = normalizeValue(payload.category);
    const teamId = normalizeValue(payload.teamId);
    const conversationId = normalizeValue(payload.conversationId);
    const gameId = normalizeValue(payload.gameId);
    const eventId = normalizeValue(payload.eventId) || gameId;
    const batchId = normalizeValue(payload.batchId);
    const recipientId = normalizeValue(payload.recipientId);
    const certificateId = normalizeValue(payload.certificateId);

    if (category === 'liveScore' && gameId) {
        if (teamId) {
            return buildScheduleEventRoute(teamId, gameId, 'game');
        }
        return `/games/${encodeRouteParam(gameId)}`;
    }
    if (category === 'gameDay') {
        if (teamId && eventId) {
            return buildScheduleEventRoute(teamId, eventId, 'game');
        }
        if (eventId) {
            return `/games/${encodeRouteParam(eventId)}`;
        }
    }
    if (category === 'practice') {
        if (teamId && eventId) {
            return buildScheduleEventRoute(teamId, eventId, 'game');
        }
        if (teamId) {
            return `/schedule?teamId=${encodeRouteParam(teamId)}&section=game`;
        }
    }
    if (category === 'media') {
        if (appRoute) {
            return appRoute;
        }
        if (teamId) {
            return `/teams/${encodeRouteParam(teamId)}/media`;
        }
        return '/teams';
    }
    if (category === 'liveChat' && teamId && conversationId) {
        return buildMessagesRoute(teamId, conversationId);
    }
    if (category === 'mentions' && teamId) {
        return buildMessagesRoute(teamId, conversationId);
    }
    if (category === 'fees') {
        if (teamId && batchId) {
            const route = `/teams/${encodeRouteParam(teamId)}/fees/${encodeRouteParam(batchId)}`;
            return appendQuery(route, { recipientId });
        }
        return appendQuery('/parent-tools/fees', { teamId, batchId, recipientId });
    }
    if (category === 'access') {
        return appendQuery('/parent-tools/access', { teamId });
    }
    if (category === 'rideshare') {
        if (teamId && eventId) {
            return buildScheduleEventRoute(teamId, eventId, 'rideshare');
        }
        return teamId ? `/schedule?teamId=${encodeRouteParam(teamId)}&section=rideshare` : '/schedule?section=rideshare';
    }
    if (category === 'media' && teamId) {
        return `/teams/${encodeRouteParam(teamId)}/media`;
    }
    if (category === 'awards') {
        return appendQuery('/parent-tools/certificates', { teamId, certificateId });
    }
    if (category === 'officiating') {
        return teamId ? `/officials?teamId=${encodeRouteParam(teamId)}` : '/officials';
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
