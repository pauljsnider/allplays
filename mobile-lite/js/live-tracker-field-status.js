function ensurePlayer(state, playerId) {
  if (!state[playerId]) {
    state[playerId] = {
      status: 'bench',
      elapsedMs: 0,
      lastStartedAt: null
    };
  }
  return state[playerId];
}

export function createFieldState(players) {
  const state = {};
  (players || []).forEach((player) => {
    if (!player?.id) return;
    state[player.id] = {
      status: 'bench',
      elapsedMs: 0,
      lastStartedAt: null
    };
  });
  return state;
}

export function setPlayerFieldStatus(state, playerId, status, nowMs) {
  const entry = ensurePlayer(state, playerId);
  const nextStatus = status === 'onField' ? 'onField' : 'bench';
  const hasNow = Number.isFinite(nowMs);

  if (entry.status === nextStatus) return entry;

  if (entry.status === 'onField' && Number.isFinite(entry.lastStartedAt) && hasNow) {
    entry.elapsedMs += Math.max(0, nowMs - entry.lastStartedAt);
  }

  entry.status = nextStatus;
  entry.lastStartedAt = nextStatus === 'onField' && hasNow ? nowMs : null;
  return entry;
}

export function startFieldClock(state, nowMs) {
  if (!Number.isFinite(nowMs)) return;
  Object.values(state || {}).forEach((entry) => {
    if (entry.status === 'onField' && !Number.isFinite(entry.lastStartedAt)) {
      entry.lastStartedAt = nowMs;
    }
  });
}

export function pauseFieldClock(state, nowMs) {
  if (!Number.isFinite(nowMs)) return;
  Object.values(state || {}).forEach((entry) => {
    if (entry.status === 'onField' && Number.isFinite(entry.lastStartedAt)) {
      entry.elapsedMs += Math.max(0, nowMs - entry.lastStartedAt);
      entry.lastStartedAt = null;
    }
  });
}

export function getPlayerFieldElapsedMs(state, playerId, nowMs) {
  const entry = ensurePlayer(state, playerId);
  if (entry.status === 'onField' && Number.isFinite(entry.lastStartedAt) && Number.isFinite(nowMs)) {
    return entry.elapsedMs + Math.max(0, nowMs - entry.lastStartedAt);
  }
  return entry.elapsedMs;
}

export function getLiveLineup(state, players) {
  const orderedIds = (players || []).map((player) => player.id).filter(Boolean);
  const onCourt = [];
  const bench = [];
  orderedIds.forEach((playerId) => {
    const entry = ensurePlayer(state, playerId);
    if (entry.status === 'onField') {
      onCourt.push(playerId);
    } else {
      bench.push(playerId);
    }
  });
  return { onCourt, bench };
}
