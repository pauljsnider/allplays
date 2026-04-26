function normalizeTeamSide(teamSide) {
  return String(teamSide || '').trim().toLowerCase() === 'away' ? 'away' : 'home';
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
  createdBy = null
} = {}) {
  const side = normalizeTeamSide(teamSide);
  const cleanScorer = cleanText(scorer);
  const cleanNote = cleanText(note);
  const periodLabel = cleanText(period) || 'P1';
  const sideLabel = side === 'away' ? 'Away' : 'Home';
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
    playerName: side === 'home' ? cleanScorer || null : null,
    playerNumber: '',
    opponentPlayerName: side === 'away' ? cleanScorer || null : null,
    opponentPlayerNumber: '',
    description: `${sideLabel} goal${scorerText} (${periodLabel})${noteText}`,
    createdBy
  };
}
