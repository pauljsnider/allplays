import { computeOfficiatingCoverageStatus, normalizeOfficiatingSlots } from './officiating-utils.js?v=3';

function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isUpcomingGame(game = {}) {
    const date = toDate(game.date);
    const status = String(game.status || '').trim().toLowerCase();
    return !!date && date.getTime() >= Date.now() && status !== 'cancelled' && status !== 'canceled';
}

export function buildAdminTeamOfficialsSummary(team = {}, officials = [], games = []) {
    const officialCount = Array.isArray(officials) ? officials.length : 0;
    const upcomingGames = (Array.isArray(games) ? games : [])
        .filter((game) => game?.teamId === team?.id)
        .filter(isUpcomingGame)
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
    let detailLabel = 'No upcoming officiating slots';
    if (upcomingGameCount > 0) {
        if (attentionGameCount > 0) {
            detailTone = 'warning';
            const gameLabel = `upcoming game${upcomingGameCount === 1 ? '' : 's'}`;
            detailLabel = `${attentionGameCount} of ${upcomingGameCount} ${gameLabel} ${upcomingGameCount === 1 ? 'needs' : 'need'} attention`;
        } else {
            detailTone = 'good';
            detailLabel = `${coveredGameCount} upcoming game${coveredGameCount === 1 ? '' : 's'} covered`;
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
