function normalizeTeamList(teams) {
    return (Array.isArray(teams) ? teams : [])
        .filter((team) => team && team.id)
        .map((team) => ({ ...team, id: String(team.id) }));
}

export function getOrganizationTeams({ accessibleTeams = [], organizationOwnerId = null } = {}) {
    const normalizedOwnerId = String(organizationOwnerId || '').trim();
    return normalizeTeamList(accessibleTeams).filter((team) => {
        if (!normalizedOwnerId) return true;
        return String(team.ownerId || '').trim() === normalizedOwnerId;
    });
}

export function validateOrganizationMatchup({
    homeTeamId,
    awayTeamId,
    organizationTeams = [],
    organizationOwnerId = null
} = {}) {
    const normalizedHomeTeamId = String(homeTeamId || '').trim();
    const normalizedAwayTeamId = String(awayTeamId || '').trim();
    const eligibleTeams = getOrganizationTeams({ accessibleTeams: organizationTeams, organizationOwnerId });
    const teamsById = new Map(eligibleTeams.map((team) => [team.id, team]));

    if (!normalizedHomeTeamId || !normalizedAwayTeamId) {
        return { ok: false, error: 'Select both a home team and an away team.' };
    }

    if (normalizedHomeTeamId === normalizedAwayTeamId) {
        return { ok: false, error: 'Choose two different teams for the shared matchup.' };
    }

    const homeTeam = teamsById.get(normalizedHomeTeamId);
    const awayTeam = teamsById.get(normalizedAwayTeamId);
    if (!homeTeam || !awayTeam) {
        return { ok: false, error: 'Both teams must belong to the current organization.' };
    }

    return {
        ok: true,
        homeTeam,
        awayTeam
    };
}

export function buildOrganizationSharedGamePayload({
    awayTeam,
    gameDate,
    location = '',
    arrivalTime = '',
    notes = '',
    Timestamp
} = {}) {
    const parsedGameDate = gameDate instanceof Date ? gameDate : new Date(gameDate);
    if (!(parsedGameDate instanceof Date) || Number.isNaN(parsedGameDate.getTime())) {
        throw new Error('A valid game date is required.');
    }

    const parsedArrivalTime = arrivalTime ? new Date(arrivalTime) : null;
    if (arrivalTime && Number.isNaN(parsedArrivalTime?.getTime())) {
        throw new Error('A valid arrival time is required.');
    }

    if (!Timestamp?.fromDate) {
        throw new Error('Timestamp.fromDate is required.');
    }

    return {
        type: 'game',
        status: 'scheduled',
        date: Timestamp.fromDate(parsedGameDate),
        opponent: awayTeam?.name || 'Opponent',
        opponentTeamId: awayTeam?.id || null,
        opponentTeamName: awayTeam?.name || null,
        opponentTeamPhoto: awayTeam?.photoUrl || null,
        location: String(location || '').trim(),
        arrivalTime: parsedArrivalTime ? Timestamp.fromDate(parsedArrivalTime) : null,
        notes: String(notes || '').trim() || null,
        isHome: true,
        homeScore: 0,
        awayScore: 0
    };
}
