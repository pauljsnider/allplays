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

const LIVE_EVENT_NOTIFICATION_MAX_AGE_MS = 10 * 60 * 1000;
const LIVE_EVENT_NOTIFICATION_FUTURE_TOLERANCE_MS = 60 * 1000;

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
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getLiveEventScoreSnapshot(event = {}) {
  if (!Object.prototype.hasOwnProperty.call(event, 'homeScore') || !Object.prototype.hasOwnProperty.call(event, 'awayScore')) {
    return null;
  }
  const homeScore = getFiniteLiveEventNumber(event.homeScore);
  const awayScore = getFiniteLiveEventNumber(event.awayScore);
  if (homeScore === null || awayScore === null || homeScore < 0 || awayScore < 0) return null;
  return {
    homeScore: Object.is(homeScore, -0) ? 0 : homeScore,
    awayScore: Object.is(awayScore, -0) ? 0 : awayScore
  };
}

function getLiveEventScore(event = {}) {
  const score = getLiveEventScoreSnapshot(event);
  return score ? `${score.homeScore}–${score.awayScore}` : '';
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

function buildLiveScoreStateNotificationDedupKey(score = {}) {
  const snapshot = getLiveEventScoreSnapshot(score);
  return snapshot ? `score-state:${snapshot.homeScore}:${snapshot.awayScore}` : '';
}

function getLiveEventTimestampMillis(value) {
  if (typeof value?.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value && typeof value === 'object' && Number.isFinite(Number(value.seconds))) {
    const nanos = Number(value.nanoseconds ?? value.nanos ?? 0);
    return (Number(value.seconds) * 1000) + (Number.isFinite(nanos) ? Math.floor(nanos / 1e6) : 0);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function isLiveEventNotificationFresh(
  event = {},
  nowMillis = Date.now(),
  maxAgeMillis = LIVE_EVENT_NOTIFICATION_MAX_AGE_MS
) {
  const eventOriginMillis = getLiveEventTimestampMillis(event.clientCreatedAt) ??
    getLiveEventTimestampMillis(event.createdAt);
  const normalizedNowMillis = Number(nowMillis);
  const normalizedMaxAgeMillis = Number(maxAgeMillis);
  if (
    eventOriginMillis === null
    || !Number.isFinite(normalizedNowMillis)
    || !Number.isFinite(normalizedMaxAgeMillis)
    || normalizedMaxAgeMillis < 0
  ) {
    return false;
  }
  const ageMillis = normalizedNowMillis - eventOriginMillis;
  return ageMillis >= -LIVE_EVENT_NOTIFICATION_FUTURE_TOLERANCE_MS && ageMillis <= normalizedMaxAgeMillis;
}

function getLiveEventActorUid(event = {}) {
  return compactLiveEventText(event.actorUid || event.createdBy, 160) || null;
}

module.exports = {
  LIVE_EVENT_NOTIFICATION_MAX_AGE_MS,
  buildBigMomentLiveEventNotification,
  buildLiveEventNotificationDedupKey,
  buildLiveScoreStateNotificationDedupKey,
  classifyBigMomentLiveEvent,
  compactLiveEventText,
  getLiveEventActorUid,
  isLiveEventNotificationFresh
};
