function parseRecurringInstanceEventId(eventId) {
    if (typeof eventId !== 'string') return null;
    const match = eventId.match(/^(.*)__([0-9]{4}-[0-9]{2}-[0-9]{2})$/);
    if (!match) return null;
    return {
        masterId: match[1],
        instanceDate: match[2]
    };
}

function normalizeGames(dbGames = []) {
    return Array.isArray(dbGames) ? dbGames : [];
}

export function isCancelledPracticeSession(session, dbGames = []) {
    const eventId = session?.eventId;
    if (!eventId) return false;

    const games = normalizeGames(dbGames);
    const directPractice = games.find((game) =>
        game?.type === 'practice' && [game?.id, game?.gameId, game?.eventId].filter(Boolean).includes(eventId)
    );
    if (directPractice?.status === 'cancelled') {
        return true;
    }

    const recurring = parseRecurringInstanceEventId(eventId);
    if (!recurring) return false;

    const master = games.find((game) =>
        game?.type === 'practice' &&
        (game?.id === recurring.masterId || game?.gameId === recurring.masterId)
    );
    if (!master) return false;
    if (master?.status === 'cancelled') return true;

    const exDates = Array.isArray(master?.exDates) ? master.exDates : [];
    return exDates.includes(recurring.instanceDate);
}

export function filterVisiblePracticeSessions(sessions, dbGames = []) {
    if (!Array.isArray(sessions)) return [];
    return sessions.filter((session) => !isCancelledPracticeSession(session, dbGames));
}
