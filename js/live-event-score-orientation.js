import { getTeamScorePair } from './season-record.js';

// Legacy tracker events used managed-team/opponent order. Historical React
// events have app-live-* IDs and venue scores; badge events also use venue order.
// Mark converted snapshots so replay/reconciliation can safely process them again.
export function normalizeLiveEventScores(game = {}, event = {}) {
    if (game?.isHome !== false || game?.trackingEngine === 'diamond-v2') return event;
    const targetIsVenue = getTeamScorePair({ ...game, homeScore: 0, awayScore: 1 }).teamScore === 1;
    const explicit = event.scoreOrientation;
    const sourceIsVenue = explicit === 'venue' || (explicit !== 'team-opponent' && (
        event.source === 'badge-score-controller'
        || String(event.eventId || event.id || '').startsWith('app-live-')
    ));
    if (sourceIsVenue === targetIsVenue) return event;
    const { homeScore, awayScore, ...rest } = event;
    return {
        ...rest,
        ...(awayScore !== undefined ? { homeScore: awayScore } : {}),
        ...(homeScore !== undefined ? { awayScore: homeScore } : {}),
        scoreOrientation: targetIsVenue ? 'venue' : 'team-opponent'
    };
}
