import { canTrustScoreLogForFinalization, reconcileFinalScoreFromLog } from './live-tracker-integrity.js';

export function buildScoreReconciliationNote(requestedHome, requestedAway, finalHome, finalAway) {
  return `Score reconciled from ${requestedHome}-${requestedAway} to ${finalHome}-${finalAway} based on scoring events`;
}

export function buildOpponentStatsSnapshotFromEntries({ opponentEntries = [], columns = [] } = {}) {
  const opponentStats = {};
  const safeColumns = Array.isArray(columns) ? columns : [];

  (Array.isArray(opponentEntries) ? opponentEntries : []).forEach((opp) => {
    if (!opp?.id) return;
    opponentStats[opp.id] = {
      name: opp.name || '',
      number: opp.number || '',
      playerId: opp.playerId || null,
      photoUrl: opp.photoUrl || ''
    };
    safeColumns.forEach((col) => {
      const key = col.toLowerCase();
      opponentStats[opp.id][key] = opp.stats?.[key] || 0;
    });
    opponentStats[opp.id].fouls = opp.stats?.fouls || 0;
  });

  return opponentStats;
}

export function buildFinishCompletionPlan({
  requestedHome,
  requestedAway,
  liveHome,
  liveAway,
  scoreLogIsComplete = false,
  log = [],
  currentPeriod = '',
  currentClock = '',
  summary = '',
  sendEmail = false,
  teamId,
  gameId,
  teamName = '',
  opponentName = 'Unknown Opponent',
  recipientEmail = '',
  columns = [],
  roster = [],
  statsByPlayerId = {},
  opponentEntries = [],
  currentUserUid = null,
  buildEmailBody = () => ''
} = {}) {
  let finalHome = Number.isFinite(Number(requestedHome)) ? Number(requestedHome) : 0;
  let finalAway = Number.isFinite(Number(requestedAway)) ? Number(requestedAway) : 0;
  let scoreReconciliation = {
    home: finalHome,
    away: finalAway,
    mismatch: false,
    derived: { home: finalHome, away: finalAway }
  };

  const normalizedLiveHome = Number.isFinite(Number(liveHome)) ? Number(liveHome) : 0;
  const normalizedLiveAway = Number.isFinite(Number(liveAway)) ? Number(liveAway) : 0;
  const requestedScoreMatchesLive = finalHome === normalizedLiveHome && finalAway === normalizedLiveAway;

  if (requestedScoreMatchesLive && scoreLogIsComplete && canTrustScoreLogForFinalization({ liveHome, liveAway, log })) {
    scoreReconciliation = reconcileFinalScoreFromLog({
      requestedHome: finalHome,
      requestedAway: finalAway,
      log
    });
    finalHome = scoreReconciliation.home;
    finalAway = scoreReconciliation.away;
  }

  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeRoster = Array.isArray(roster) ? roster : [];
  const safeStatsByPlayerId = statsByPlayerId && typeof statsByPlayerId === 'object' ? statsByPlayerId : {};
  const effectiveLog = Array.isArray(log) ? [...log] : [];
  let reconciliationNote = '';

  if (scoreReconciliation.mismatch) {
    reconciliationNote = buildScoreReconciliationNote(requestedHome, requestedAway, finalHome, finalAway);
  }

  const eventWrites = effectiveLog.map((entry) => ({
    data: {
      text: entry.text,
      gameTime: entry.clock,
      period: entry.period,
      timestamp: entry.ts || Date.now(),
      type: entry.undoData?.type || 'game_log',
      playerId: entry.undoData?.playerId || null,
      statKey: entry.undoData?.statKey || null,
      value: entry.undoData?.value || null,
      isOpponent: entry.undoData?.isOpponent || false,
      createdBy: currentUserUid
    }
  }));

  const aggregatedStatsWrites = safeRoster.map((player) => {
    const statsObj = {};
    safeColumns.forEach((col) => {
      const key = col.toLowerCase();
      statsObj[key] = safeStatsByPlayerId[player.id]?.[key] || 0;
    });
    statsObj.fouls = safeStatsByPlayerId[player.id]?.fouls || 0;

    return {
      playerId: player.id,
      data: {
        playerName: player.name,
        playerNumber: player.num,
        stats: statsObj,
        timeMs: safeStatsByPlayerId[player.id]?.time || 0
      }
    };
  });

  const gameUpdate = {
    homeScore: finalHome,
    awayScore: finalAway,
    summary,
    status: 'completed',
    opponentStats: buildOpponentStatsSnapshotFromEntries({
      opponentEntries,
      columns: safeColumns
    })
  };

  const redirectHref = `game.html#teamId=${teamId}&gameId=${gameId}`;
  const navigation = [];

  if (sendEmail) {
    const subject = `${teamName} vs ${opponentName || 'Unknown Opponent'} - Game Summary`;
    const body = buildEmailBody(finalHome, finalAway, summary, effectiveLog);
    navigation.push({
      type: 'mailto',
      href: `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      delayMs: 0
    });
    navigation.push({
      type: 'redirect',
      href: redirectHref,
      delayMs: 500
    });
  } else {
    navigation.push({
      type: 'redirect',
      href: redirectHref,
      delayMs: 0
    });
  }

  return {
    finalHome,
    finalAway,
    scoreReconciliation,
    reconciliationNote,
    eventWrites,
    aggregatedStatsWrites,
    gameUpdate,
    navigation
  };
}

export function prepareFinishPlanForSave({
  finishPlanArgs = {},
  period = '',
  clock = '',
  now = () => Date.now(),
  buildPlan = buildFinishCompletionPlan
} = {}) {
  let finishPlan = buildPlan(finishPlanArgs);
  let addedReconciliationLogEntry = null;
  let updatedLog = Array.isArray(finishPlanArgs.log) ? finishPlanArgs.log : [];

  if (finishPlan.scoreReconciliation.mismatch) {
    addedReconciliationLogEntry = {
      text: finishPlan.reconciliationNote,
      ts: now(),
      period,
      clock
    };
    updatedLog = [addedReconciliationLogEntry, ...updatedLog];
    finishPlan = buildPlan({
      ...finishPlanArgs,
      log: updatedLog
    });
  }

  return {
    finishPlan,
    addedReconciliationLogEntry,
    updatedLog
  };
}

export function executeFinishNavigationPlan(navigation = [], {
  navigate = (href) => {
    window.location.href = href;
  },
  schedule = (callback, delayMs) => window.setTimeout(callback, delayMs)
} = {}) {
  (Array.isArray(navigation) ? navigation : []).forEach((step) => {
    const run = () => navigate(step.href);
    if ((step?.delayMs || 0) > 0) {
      schedule(run, step.delayMs);
      return;
    }
    run();
  });
}
