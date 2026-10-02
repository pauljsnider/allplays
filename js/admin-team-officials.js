import { computeOfficiatingCoverageStatus, normalizeOfficiatingSlots } from './officiating-utils.js?v=4';

const DAY_MS = 24 * 60 * 60 * 1000;

// Keep Admin Teams coverage reads useful for scheduling while preventing their
// cost from growing with each team's complete game history.
export const ADMIN_TEAM_OFFICIALS_COVERAGE_DAYS = 90;

function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildAdminTeamOfficialsCoverageWindow(referenceDate = new Date()) {
    const startDate = toDate(referenceDate) || new Date();
    const endDate = new Date(startDate.getTime() + ADMIN_TEAM_OFFICIALS_COVERAGE_DAYS * DAY_MS);
    return { startDate, endDate };
}

export async function loadAdminTeamOfficialsCoverageGames(teams = [], getGamesForTeam, { referenceDate = new Date() } = {}) {
    const coverageWindow = buildAdminTeamOfficialsCoverageWindow(referenceDate);
    const gamesByTeam = await Promise.all(teams.map(async (team) => {
        try {
            const games = await getGamesForTeam(team.id, coverageWindow);
            return games.map((game) => ({ ...game, teamId: team.id, teamName: team.name }));
        } catch (error) {
            return [];
        }
    }));
    return gamesByTeam.flat();
}

function isUpcomingGame(game = {}, coverageWindow) {
    const date = toDate(game.date);
    const status = String(game.status || '').trim().toLowerCase();
    return !!date
        && date.getTime() >= coverageWindow.startDate.getTime()
        && date.getTime() <= coverageWindow.endDate.getTime()
        && status !== 'cancelled'
        && status !== 'canceled';
}

export function buildAdminTeamOfficialsSummary(team = {}, officials = [], games = [], { referenceDate = new Date() } = {}) {
    const officialCount = Array.isArray(officials) ? officials.length : 0;
    const coverageWindow = buildAdminTeamOfficialsCoverageWindow(referenceDate);
    const upcomingGames = (Array.isArray(games) ? games : [])
        .filter((game) => game?.teamId === team?.id)
        .filter((game) => isUpcomingGame(game, coverageWindow))
        .map((game) => ({
            ...game,
            normalizedSlots: normalizeOfficiatingSlots(game.officiatingSlots || [])
        }))
        .filter((game) => game.normalizedSlots.length > 0);

    const upcomingGameCount = upcomingGames.length;
    const coveredGameCount = upcomingGames.filter((game) => {
        const status = game.officiatingCoverageStatus || computeOfficiatingCoverageStatus(game.normalizedSlots);
        return status === 'covered';
    }).length;
    const attentionGameCount = upcomingGameCount - coveredGameCount;

    let badgeTone = 'good';
    let badgeLabel = officialCount === 1 ? '1 official' : `${officialCount} officials`;
    if (officialCount === 0) {
        badgeTone = 'missing';
        badgeLabel = 'No officials';
    }

    let detailTone = 'muted';
    let detailLabel = `No officiating slots in next ${ADMIN_TEAM_OFFICIALS_COVERAGE_DAYS} days`;
    if (upcomingGameCount > 0) {
        if (attentionGameCount > 0) {
            detailTone = 'warning';
            const gameLabel = `upcoming game${upcomingGameCount === 1 ? '' : 's'}`;
            detailLabel = `Next ${ADMIN_TEAM_OFFICIALS_COVERAGE_DAYS} days: ${attentionGameCount} of ${upcomingGameCount} ${gameLabel} ${upcomingGameCount === 1 ? 'needs' : 'need'} attention`;
        } else {
            detailTone = 'good';
            detailLabel = `Next ${ADMIN_TEAM_OFFICIALS_COVERAGE_DAYS} days: ${coveredGameCount} upcoming game${coveredGameCount === 1 ? '' : 's'} covered`;
        }
    }

    return {
        officialCount,
        upcomingGameCount,
        coveredGameCount,
        attentionGameCount,
        badgeTone,
        badgeLabel,
        detailTone,
        detailLabel
    };
}
