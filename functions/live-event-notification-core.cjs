const SCORING_STAT_KEYS = new Set([
  'goal', 'goals', 'homerun', 'hr', 'point', 'points', 'pts', 'run', 'runs', 'score', 'scores'
]);

const FOOTBALL_SCORE_LABELS = Object.freeze({
  touchdown: 'Touchdown',
  fieldgoal: 'Field goal',
  safety: 'Safety',
  patkick: 'PAT kick',
  twopointconversion: 'Two-point conversion'
});

function compactLiveEventText(value, maxLength = 120) {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeLiveEventToken(value) {
  return compactLiveEventText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getFiniteLiveEventNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getLiveEventScore(event = {}) {
  const hasHomeScore = Object.prototype.hasOwnProperty.call(event, 'homeScore');
  const hasAwayScore = Object.prototype.hasOwnProperty.call(event, 'awayScore');
  const homeScore = hasHomeScore ? getFiniteLiveEventNumber(event.homeScore) : null;
  const awayScore = hasAwayScore ? getFiniteLiveEventNumber(event.awayScore) : null;
  if (homeScore === null || awayScore === null) return '';
  return `${Math.max(0, homeScore)}–${Math.max(0, awayScore)}`;
}

function getLiveEventPlayerName(event = {}) {
  const isOpponent = event.isOpponent === true || normalizeLiveEventToken(event.teamSide) === 'away';
  return compactLiveEventText(
    isOpponent
      ? event.opponentPlayerName || event.scorer || event.playerName
      : event.playerName || event.scorer || event.opponentPlayerName,
    60
  );
}

function classifyBigMomentLiveEvent(event = {}) {
  const type = normalizeLiveEventToken(event.type);
  if (type === 'goal') return { label: 'Goal', kind: 'goal' };
  if (type === 'footballscore') {
    const action = normalizeLiveEventToken(event.footballScoringAction || event.scoringAction);
    return { label: FOOTBALL_SCORE_LABELS[action] || 'Football score', kind: 'football-score' };
  }
  if (type === 'baseball') {
    const action = normalizeLiveEventToken(event.baseballAction || event.action);
    return action === 'homerun' ? { label: 'Home run', kind: 'home-run' } : null;
  }
  if (type !== 'stat') return null;

  const statKey = normalizeLiveEventToken(event.statKey || event.stat);
  const value = getFiniteLiveEventNumber(event.value);
  if (!SCORING_STAT_KEYS.has(statKey) || value === null || value <= 0) return null;
  if (statKey === 'goal' || statKey === 'goals') {
    return { label: value === 1 ? 'Goal' : `${value} goals`, kind: 'scoring-stat' };
  }
  if (statKey === 'homerun' || statKey === 'hr') {
    return { label: value === 1 ? 'Home run' : `${value} home runs`, kind: 'scoring-stat' };
  }
  if (statKey === 'run' || statKey === 'runs') {
    return { label: `${value} ${value === 1 ? 'run' : 'runs'}`, kind: 'scoring-stat' };
  }
  return { label: `${value} ${value === 1 ? 'point' : 'points'}`, kind: 'scoring-stat' };
}

function buildBigMomentLiveEventNotification(event = {}) {
  const classification = classifyBigMomentLiveEvent(event);
  if (!classification) return null;

  const playerName = getLiveEventPlayerName(event);
  const side = normalizeLiveEventToken(event.teamSide) === 'away' || event.isOpponent === true
    ? 'Away'
    : normalizeLiveEventToken(event.teamSide) === 'home' || event.isOpponent === false
      ? 'Home'
      : '';
  const title = compactLiveEventText(
    playerName
      ? `${classification.label}: ${playerName}`
      : side
        ? `${side} ${classification.label.toLowerCase()}`
        : classification.label,
    80
  );
  const period = compactLiveEventText(event.period, 24);
  const score = getLiveEventScore(event);
  const bodyParts = [period, score ? `Score ${score}` : ''].filter(Boolean);
  const body = compactLiveEventText(
    bodyParts.length ? bodyParts.join(' · ') : 'Open the live game for play-by-play.',
    120
  );
  return { title, body, kind: classification.kind };
}

function buildLiveEventNotificationDedupKey(event = {}, documentId = '') {
  const identity = compactLiveEventText(documentId, 200) || compactLiveEventText(event.eventId, 200);
  return identity ? `live-event:${identity}` : '';
}

function getLiveEventActorUid(event = {}) {
  return compactLiveEventText(event.actorUid || event.createdBy, 160) || null;
}

module.exports = {
  buildBigMomentLiveEventNotification,
  buildLiveEventNotificationDedupKey,
  classifyBigMomentLiveEvent,
  compactLiveEventText,
  getLiveEventActorUid
};
