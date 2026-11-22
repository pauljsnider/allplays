function isPointsKey(statKey) {
  const key = (statKey || '').toString().toUpperCase();
  return key === 'PTS' || key === 'POINTS' || key === 'GOALS' || key === 'R' || key === 'RUN' || key === 'RUNS';
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

export function canApplySubstitutionQueue(onCourt = [], bench = [], queue = []) {
  let nextOnCourt = Array.isArray(onCourt) ? [...onCourt] : [];
  let nextBench = Array.isArray(bench) ? [...bench] : [];

  for (const pair of queue) {
    const result = applySubstitution(nextOnCourt, nextBench, pair?.out, pair?.in);
    if (!result.applied) {
      return false;
    }
    nextOnCourt = result.onCourt;
    nextBench = result.bench;
  }

  return true;
}

export function canApplyQueuedSubstitution(onCourt = [], bench = [], queue = [], outId, inId) {
  return canApplySubstitutionQueue(onCourt, bench, [...(Array.isArray(queue) ? queue : []), { out: outId, in: inId }]);
}

// Queue Multiple UX (#5258): players already in the queue leave the pickable
// lists, so the columns always show exactly who is still available to swap.
export function availableSubstitutionPlayers(onCourt = [], bench = [], queue = []) {
  const safeQueue = Array.isArray(queue) ? queue : [];
  const queuedOut = new Set(safeQueue.map(pair => pair?.out).filter(Boolean));
  const queuedIn = new Set(safeQueue.map(pair => pair?.in).filter(Boolean));
  return {
    onCourt: (Array.isArray(onCourt) ? onCourt : []).filter(id => !queuedOut.has(id)),
    bench: (Array.isArray(bench) ? bench : []).filter(id => !queuedIn.has(id))
  };
}

// Queue Multiple UX (#5258): remove one queued swap by index; returns a new
// queue and never mutates the input. Out-of-range indexes are a no-op.
export function removeQueuedSwap(queue = [], index) {
  const safeQueue = Array.isArray(queue) ? [...queue] : [];
  if (!Number.isInteger(index) || index < 0 || index >= safeQueue.length) {
    return safeQueue;
  }
  safeQueue.splice(index, 1);
  return safeQueue;
}

// Queue Multiple UX (#5258): the hint names the selected player so the
// two-tap build is visible, and works from either side of the modal.
export function buildSubstitutionHint({ queueMode = false, pendingOut = null, pendingIn = null, pendingOutLabel = '' } = {}) {
  if (queueMode) {
    if (pendingOut && !pendingIn) {
      return `Now tap his replacement — ${pendingOutLabel}`;
    }
    if (pendingIn && !pendingOut) {
      return 'Now tap who comes out';
    }
    return 'Tap player on court, then tap replacement';
  }
  if (pendingOut) {
    return 'Now tap bench player to swap in';
  }
  return 'Tap player on court, then tap replacement';
}

// Queue Multiple UX (#5258): the confirm button shows the queued count and
// is disabled with an empty queue.
export function buildSubstitutionConfirm({ queueMode = false, queueLength = 0, pendingValid = false } = {}) {
  if (queueMode) {
    const count = Number.isFinite(queueLength) ? queueLength : 0;
    return {
      label: count > 0 ? `Make Swap (${count})` : 'Make Swap',
      disabled: count === 0 && !pendingValid
    };
  }
  return { label: 'Make Swap', disabled: !pendingValid };
}

// Queue Multiple UX (#5258): a queued swap row names both players so the
// queue stays readable when jersey numbers are duplicated or missing. The
// number is omitted when a player has none; the name is what disambiguates.
export function formatSubstitutionPlayerLabel(player = {}) {
  const num = player?.num === undefined || player?.num === null ? '' : String(player.num).trim();
  const name = (player?.name || '').toString().trim();
  if (num && name) return `#${num} ${name}`;
  if (num) return `#${num}`;
  if (name) return name;
  return 'Unknown player';
}

// Queue Multiple UX (#5258): the full row label for one queued swap, e.g.
// "OUT #8 Hayes Coppaken → IN #6 Hugo Patterson". resolvePlayer maps a
// player id to its roster entry ({ num, name }) or null when unknown.
export function buildQueuedSwapLabel(pair = {}, resolvePlayer = () => null) {
  const out = formatSubstitutionPlayerLabel(resolvePlayer(pair?.out));
  const inn = formatSubstitutionPlayerLabel(resolvePlayer(pair?.in));
  return `OUT ${out} → IN ${inn}`;
}

export function acquireSingleFlightLock(lock) {
  if (!lock || lock.active) return false;
  lock.active = true;
  return true;
}

export function releaseSingleFlightLock(lock) {
  if (!lock) return;
  lock.active = false;
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

export function resolveFinalScoreForCompletion({
  requestedHome,
  requestedAway,
  liveHome,
  liveAway,
  log = [],
  scoreLogIsComplete = true
} = {}) {
  const home = Number.isFinite(Number(requestedHome)) ? Number(requestedHome) : 0;
  const away = Number.isFinite(Number(requestedAway)) ? Number(requestedAway) : 0;

  const normalizedLiveHome = Number.isFinite(Number(liveHome)) ? Number(liveHome) : 0;
  const normalizedLiveAway = Number.isFinite(Number(liveAway)) ? Number(liveAway) : 0;
  const requestedScoreMatchesLive = home === normalizedLiveHome && away === normalizedLiveAway;

  if (!requestedScoreMatchesLive || !scoreLogIsComplete || !canTrustScoreLogForFinalization({ liveHome, liveAway, log })) {
    return {
      home,
      away,
      mismatch: false,
      reconciled: false
    };
  }

  const reconciled = reconcileFinalScoreFromLog({
    requestedHome: home,
    requestedAway: away,
    log
  });

  return {
    home: reconciled.home,
    away: reconciled.away,
    mismatch: reconciled.mismatch,
    reconciled: true,
    derived: reconciled.derived
  };
}
