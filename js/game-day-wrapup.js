import { resolveLiveSport } from './live-sport-config.js';

export function shouldPromptWrapupOnCompletion({ prevLiveStatus, nextLiveStatus, mode }) {
    return nextLiveStatus === 'completed'
        && prevLiveStatus !== 'completed'
        && mode !== 'wrapup';
}

export function getWrapupFormState({ score, game }) {
    return {
        homeScore: score?.home || 0,
        awayScore: score?.away || 0,
        postGameNotes: game?.postGameNotes || ''
    };
}

export function buildFinishGamePayload({ homeScoreValue, awayScoreValue, postGameNotesValue }) {
    return {
        homeScore: parseInt(homeScoreValue, 10) || 0,
        awayScore: parseInt(awayScoreValue, 10) || 0,
        postGameNotes: (postGameNotesValue || '').trim(),
        status: 'completed',
        liveStatus: 'completed'
    };
}

export function buildMatchReportUrl({ teamId, gameId }) {
    return `game.html#teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}`;
}

function normalizeSportLabel(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'basketball') return 'basketball';
    if (normalized === 'soccer') return 'soccer';
    return 'sports';
}

function resolveWrapupSportLabel({ sport = '', game = null, team = null, config = null } = {}) {
    return normalizeSportLabel(resolveLiveSport({ sport, game, team, config }));
}

function getCoachingNotesText(coachingNotes = []) {
    return coachingNotes.map((note) => note.text).join(', ') || 'None';
}

function getEventSummary(events = []) {
    return events.map((event) => `${event.playerName || ''} ${event.stat || event.type || ''}`.trim()).join(', ') || 'None';
}

export function buildPracticeFeedPrompt({
    sport = '',
    game = null,
    team = null,
    config = null,
    score = {},
    coachingNotes = [],
    notes = '',
    events = []
} = {}) {
    const sportLabel = resolveWrapupSportLabel({ sport, game, team, config });
    const gameLabel = sportLabel === 'sports' ? 'youth sports game' : `${sportLabel} game`;

    return `Analyze this ${gameLabel} and return JSON: { "practiceFeedItems": [ { "weakness": "...", "evidence": "...", "drillCategory": "...", "urgency": "high|medium|low" } ] }
Game: ${team?.name || 'Team'} vs ${game?.opponent || 'Opponent'}
Score: ${score?.home || 0}-${score?.away || 0}
Coaching notes: ${getCoachingNotesText(coachingNotes)}
Post-game notes: ${notes || 'None'}
Key events: ${getEventSummary(events)}
Identify 2-4 specific areas to improve. Respond ONLY with valid JSON.`;
}

export function buildGameSummaryPrompt({
    sport = '',
    game = null,
    team = null,
    config = null,
    score = {},
    coachingNotes = [],
    notes = ''
} = {}) {
    const sportLabel = resolveWrapupSportLabel({ sport, game, team, config });
    const teamLabel = sportLabel === 'sports' ? 'youth sports team' : `youth ${sportLabel} team`;

    return `Write a 3-5 sentence game summary for a ${teamLabel}.
Team: ${team?.name || 'Team'} vs ${game?.opponent || 'Opponent'}
Final score: ${score?.home || 0}-${score?.away || 0}
Coach notes: ${notes || 'None'}
Key highlights: ${getCoachingNotesText(coachingNotes)}
Be encouraging and specific. No markdown.`;
}
