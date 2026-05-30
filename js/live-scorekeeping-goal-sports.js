function normalizeTeamSide(teamSide) {
  return String(teamSide || '').trim().toLowerCase() === 'away' ? 'away' : 'home';
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeLookupText(value) {
  return cleanText(value).toLowerCase();
}

function normalizeJerseyNumber(value) {
  return cleanText(value).replace(/^#/, '').toLowerCase();
}

export function resolveGoalSportScorer(players = [], scorer = '') {
  const cleanScorer = cleanText(scorer);
  if (!cleanScorer) return null;

  const scorerName = normalizeLookupText(cleanScorer);
  const scorerNumber = normalizeJerseyNumber(cleanScorer);

  return (players || []).find((player) => {
    const playerName = normalizeLookupText(player?.name || player?.displayName || player?.fullName || player?.playerName);
    const playerNumber = normalizeJerseyNumber(player?.number || player?.playerNumber || player?.jerseyNumber);
    return (playerName && playerName === scorerName) || (playerNumber && playerNumber === scorerNumber);
  }) || null;
}

export function applyGoalSportScore({ homeScore = 0, awayScore = 0 } = {}, teamSide = 'home') {
  const side = normalizeTeamSide(teamSide);
  return {
    homeScore: (Number(homeScore) || 0) + (side === 'home' ? 1 : 0),
    awayScore: (Number(awayScore) || 0) + (side === 'away' ? 1 : 0)
  };
}

export function buildGoalSportEvent({
  teamSide = 'home',
  period = '',
  scorer = '',
  note = '',
  gameClockMs = 0,
  homeScore = 0,
  awayScore = 0,
  createdBy = null,
  player = null
} = {}) {
  const side = normalizeTeamSide(teamSide);
  const cleanScorer = cleanText(scorer);
  const cleanNote = cleanText(note);
  const periodLabel = cleanText(period) || 'P1';
  const sideLabel = side === 'away' ? 'Away' : 'Home';
  const resolvedPlayerName = cleanText(player?.name || player?.displayName || player?.fullName || player?.playerName) || cleanScorer;
  const resolvedPlayerNumber = cleanText(player?.number || player?.playerNumber || player?.jerseyNumber);
  const scorerText = cleanScorer ? ` by ${cleanScorer}` : '';
  const noteText = cleanNote ? ` — ${cleanNote}` : '';

  return {
    type: 'goal',
    statKey: 'goals',
    value: 1,
    teamSide: side,
    isOpponent: side === 'away',
    period: periodLabel,
    gameClockMs: Number(gameClockMs) || 0,
    homeScore: Number(homeScore) || 0,
    awayScore: Number(awayScore) || 0,
    scorer: cleanScorer || null,
    note: cleanNote || null,
    playerId: player?.id || null,
    playerName: side === 'home' ? resolvedPlayerName || null : null,
    playerNumber: side === 'home' ? resolvedPlayerNumber : '',
    opponentPlayerName: side === 'away' ? resolvedPlayerName || null : null,
    opponentPlayerNumber: side === 'away' ? resolvedPlayerNumber : '',
    description: `${sideLabel} goal${scorerText} (${periodLabel})${noteText}`,
    createdBy
  };
}
