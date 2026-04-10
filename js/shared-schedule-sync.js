function cloneAssignments(assignments) {
  if (!Array.isArray(assignments)) return [];
  return assignments.map((entry) => ({ ...entry }));
}

export function shouldMirrorSharedGame(game = {}, sourceTeamId = '') {
  if ((game?.type || 'game') !== 'game') return false;
  const opponentTeamId = String(game?.opponentTeamId || '').trim();
  if (!opponentTeamId) return false;
  if (sourceTeamId && opponentTeamId === sourceTeamId) return false;
  return true;
}

export function createSharedScheduleId(sourceTeamId, sourceGameId) {
  return `shared_${String(sourceTeamId || '').trim()}_${String(sourceGameId || '').trim()}`;
}

export function buildMirroredGamePayload({
  sourceTeamId,
  sourceTeam = {},
  sourceGameId,
  sourceGame = {},
  sharedScheduleId
}) {
  return {
    type: 'game',
    date: sourceGame.date || null,
    opponent: sourceTeam.name || sourceGame.opponent || 'Opponent',
    location: sourceGame.location || '',
    statTrackerConfigId: sourceGame.statTrackerConfigId || null,
    opponentTeamId: sourceTeamId || null,
    opponentTeamName: sourceTeam.name || sourceGame.opponent || null,
    opponentTeamPhoto: sourceTeam.photoUrl || null,
    isHome: typeof sourceGame.isHome === 'boolean' ? !sourceGame.isHome : null,
    homeScore: Number(sourceGame.awayScore) || 0,
    awayScore: Number(sourceGame.homeScore) || 0,
    status: sourceGame.status || 'scheduled',
    competitionType: sourceGame.competitionType || 'league',
    seasonLabel: sourceGame.seasonLabel || null,
    countsTowardSeasonRecord: sourceGame.countsTowardSeasonRecord !== false,
    arrivalTime: sourceGame.arrivalTime || null,
    notes: sourceGame.notes || null,
    assignments: cloneAssignments(sourceGame.assignments),
    cancelledAt: sourceGame.cancelledAt || null,
    cancelledBy: sourceGame.cancelledBy || null,
    sharedScheduleId,
    sharedScheduleSourceTeamId: sourceTeamId || null,
    sharedScheduleOpponentTeamId: sourceTeamId || null,
    sharedScheduleOpponentGameId: sourceGameId || null
  };
}

export function buildSharedScheduleSourceUpdate({
  sharedScheduleId,
  counterpartTeamId,
  counterpartGameId
}) {
  return {
    sharedScheduleId: sharedScheduleId || null,
    sharedScheduleOpponentTeamId: counterpartTeamId || null,
    sharedScheduleOpponentGameId: counterpartGameId || null
  };
}

export function buildSharedScheduleDetachUpdate() {
  return {
    sharedScheduleId: null,
    sharedScheduleOpponentTeamId: null,
    sharedScheduleOpponentGameId: null
  };
}
