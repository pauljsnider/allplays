function isPointsKey(statKey) {
  const key = (statKey || '').toString().toUpperCase();
  return key === 'PTS' || key === 'POINTS' || key === 'GOALS';
}

export function hasUniquePlayerIds(ids = []) {
  return new Set(ids).size === ids.length;
}

export function canApplySubstitution(onCourt = [], outId, inId) {
  if (!outId || !inId) return false;
  if (outId === inId) return false;
  const outIdx = onCourt.indexOf(outId);
  if (outIdx === -1) return false;
  if (onCourt.includes(inId)) return false;
  return true;
}

export function applySubstitution(onCourt = [], bench = [], outId, inId) {
  const safeOnCourt = Array.isArray(onCourt) ? [...onCourt] : [];
  const safeBench = Array.isArray(bench) ? [...bench] : [];

  if (!canApplySubstitution(safeOnCourt, outId, inId)) {
    return { applied: false, onCourt: safeOnCourt, bench: safeBench };
  }

  const nextOnCourt = [...safeOnCourt];
  const outIdx = nextOnCourt.indexOf(outId);
  nextOnCourt[outIdx] = inId;

  if (!hasUniquePlayerIds(nextOnCourt)) {
    return { applied: false, onCourt: safeOnCourt, bench: safeBench };
  }

  const nextBench = safeBench.filter(id => id !== inId && id !== outId);
  nextBench.push(outId);
  return { applied: true, onCourt: nextOnCourt, bench: nextBench };
}

export function deriveScoreFromLog(log = []) {
  return log.reduce((totals, entry) => {
    const undoData = entry?.undoData;
    if (!undoData || undoData.type !== 'stat') return totals;
    if (!isPointsKey(undoData.statKey)) return totals;
    const value = Number(undoData.value) || 0;
    if (undoData.isOpponent) {
      totals.away += value;
    } else {
      totals.home += value;
    }
    return totals;
  }, { home: 0, away: 0 });
}

function countScoringEvents(log = []) {
  return log.reduce((count, entry) => {
    const undoData = entry?.undoData;
    if (!undoData || undoData.type !== 'stat') return count;
    if (!isPointsKey(undoData.statKey)) return count;
    const value = Number(undoData.value) || 0;
    if (value === 0) return count;
    return count + 1;
  }, 0);
}

export function canTrustScoreLogForFinalization({ liveHome, liveAway, log = [] } = {}) {
  const derived = deriveScoreFromLog(log);
  const home = Number.isFinite(Number(liveHome)) ? Number(liveHome) : 0;
  const away = Number.isFinite(Number(liveAway)) ? Number(liveAway) : 0;
  const hasScoringEvents = countScoringEvents(log) > 0;
  const matchesLiveScore = derived.home === home && derived.away === away;
  return hasScoringEvents && matchesLiveScore;
}

export function reconcileFinalScoreFromLog({ requestedHome, requestedAway, log = [] } = {}) {
  const derived = deriveScoreFromLog(log);
  const home = Number.isFinite(Number(requestedHome)) ? Number(requestedHome) : 0;
  const away = Number.isFinite(Number(requestedAway)) ? Number(requestedAway) : 0;
  const mismatch = home !== derived.home || away !== derived.away;

  if (mismatch) {
    return {
      home: derived.home,
      away: derived.away,
      mismatch: true,
      derived
    };
  }

  return {
    home,
    away,
    mismatch: false,
    derived
  };
}
