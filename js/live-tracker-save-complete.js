import { acquireSingleFlightLock, releaseSingleFlightLock } from './live-tracker-integrity.js?v=3';
import { resolveSummaryRecipient } from './live-tracker-email.js?v=2';
import { buildFinishCompletionPlan, executeFinishNavigationPlan } from './live-tracker-finish.js?v=3';

export const LIVE_TRACKER_MAX_PRIMARY_BATCH_WRITES = 500;
export const LIVE_TRACKER_MAX_EVENT_BATCH_WRITES = 500;
export const LIVE_TRACKER_MAX_AGGREGATED_STATS_BATCH_WRITES = 450;

export function buildLiveTrackerFinishEventDocumentId(index) {
  return `finish-log-${String(Number(index || 0) + 1).padStart(6, '0')}`;
}

function defaultFormatClock(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export function addFinishPlanWritesToBatch({
  finishPlan,
  batch,
  db,
  currentTeamId,
  currentGameId,
  createCollectionRef,
  createDocRef
} = {}) {
  (finishPlan?.eventWrites || []).forEach(({ data }, index) => {
    const eventRef = createDocRef(
      db,
      `teams/${currentTeamId}/games/${currentGameId}/events`,
      buildLiveTrackerFinishEventDocumentId(index)
    );
    batch.set(eventRef, data);
  });

  const gameRef = createDocRef(db, `teams/${currentTeamId}/games`, currentGameId);
  batch.update(gameRef, finishPlan.gameUpdate);
}

export function addEventWritesToBatch({
  eventWrites = [],
  batch,
  db,
  currentTeamId,
  currentGameId,
  createCollectionRef,
  createDocRef,
  startIndex = 0
} = {}) {
  eventWrites.forEach(({ data }, index) => {
    const eventRef = createDocRef(
      db,
      `teams/${currentTeamId}/games/${currentGameId}/events`,
      buildLiveTrackerFinishEventDocumentId(startIndex + index)
    );
    batch.set(eventRef, data);
  });
}

export function addAggregatedStatsWritesToBatch({
  aggregatedStatsWrites = [],
  batch,
  db,
  currentTeamId,
  currentGameId,
  createDocRef
} = {}) {
  aggregatedStatsWrites.forEach(({ playerId, data, privateData }) => {
    const statsRef = createDocRef(db, `teams/${currentTeamId}/games/${currentGameId}/aggregatedStats`, playerId);
    const privateStatsRef = createDocRef(db, `teams/${currentTeamId}/games/${currentGameId}/privatePlayerStats`, playerId);
    batch.set(statsRef, data);
    if (privateData) {
      batch.set(privateStatsRef, privateData);
    } else {
      batch.delete(privateStatsRef);
    }
  });
}

function getAggregatedStatsWriteOperationCount() {
  return 2;
}

export async function commitFinishPlan({
  finishPlan,
  db,
  currentTeamId,
  currentGameId,
  createBatch,
  createCollectionRef,
  createDocRef,
  maxPrimaryBatchWrites = LIVE_TRACKER_MAX_PRIMARY_BATCH_WRITES,
  maxEventBatchWrites = LIVE_TRACKER_MAX_EVENT_BATCH_WRITES,
  maxAggregatedStatsBatchWrites = LIVE_TRACKER_MAX_AGGREGATED_STATS_BATCH_WRITES,
  beforePrimaryCommit = null
} = {}) {
  const eventWrites = finishPlan?.eventWrites || [];
  const aggregatedStatsWrites = finishPlan?.aggregatedStatsWrites || [];
  const legacyPrimaryBatchWriteCount = eventWrites.length + 1;

  if (typeof beforePrimaryCommit === 'function') {
    await beforePrimaryCommit({ finishPlan });
  }

  const eventBatchSizes = [];
  for (let i = 0; i < eventWrites.length; i += maxEventBatchWrites) {
    const eventBatch = createBatch(db);
    const eventChunk = eventWrites.slice(i, i + maxEventBatchWrites);
    addEventWritesToBatch({
      eventWrites: eventChunk,
      batch: eventBatch,
      db,
      currentTeamId,
      currentGameId,
      createCollectionRef,
      createDocRef,
      startIndex: i
    });
    eventBatchSizes.push(eventChunk.length);
    await eventBatch.commit();
  }

  const aggregatedStatsBatchSizes = [];
  for (let i = 0; i < aggregatedStatsWrites.length;) {
    const statsBatch = createBatch(db);
    const statsChunk = [];
    let statsBatchWriteCount = 0;
    while (i < aggregatedStatsWrites.length) {
      const writeCount = getAggregatedStatsWriteOperationCount(aggregatedStatsWrites[i]);
      if (statsChunk.length > 0 && statsBatchWriteCount + writeCount > maxAggregatedStatsBatchWrites) {
        break;
      }
      statsChunk.push(aggregatedStatsWrites[i]);
      statsBatchWriteCount += writeCount;
      i += 1;
    }
    addAggregatedStatsWritesToBatch({
      aggregatedStatsWrites: statsChunk,
      batch: statsBatch,
      db,
      currentTeamId,
      currentGameId,
      createDocRef
    });
    aggregatedStatsBatchSizes.push(statsBatchWriteCount);
    await statsBatch.commit();
  }

  const gameUpdateBatch = createBatch(db);
  const gameRef = createDocRef(db, `teams/${currentTeamId}/games`, currentGameId);
  gameUpdateBatch.update(gameRef, finishPlan.gameUpdate);
  await gameUpdateBatch.commit();

  return {
    primaryBatchWriteCount: legacyPrimaryBatchWriteCount,
    eventBatchSizes,
    gameUpdateBatchSize: 1,
    aggregatedStatsBatchSizes,
    aggregatedStatsWriteCount: aggregatedStatsBatchSizes.reduce((total, size) => total + size, 0)
  };
}

export async function runSaveAndCompleteWorkflow({
  finishSubmissionLock,
  finishButton,
  homeFinalInput,
  awayFinalInput,
  notesFinalInput,
  finishSendEmailInput,
  state,
  currentTeam,
  currentGame,
  currentUser,
  currentConfig,
  currentTeamId,
  currentGameId,
  roster = [],
  db,
  createBatch,
  createCollectionRef,
  createDocRef,
  renderLog = () => {},
  endLiveBroadcast = async () => {},
  generateEmailBody = () => '',
  executeFinishNavigationPlan: executeNavigationPlan = executeFinishNavigationPlan,
  buildFinishCompletionPlan: buildPlan = buildFinishCompletionPlan,
  resolveSummaryRecipient: resolveRecipient = resolveSummaryRecipient,
  acquireLock = acquireSingleFlightLock,
  releaseLock = releaseSingleFlightLock,
  formatClock = defaultFormatClock,
  onFinishStateChange = () => {},
  beforeFinalizationCommit = null,
  onCommitFailure = null,
  alertFn = (message) => {
    if (typeof alert === 'function') {
      alert(message);
    }
  },
  now = () => Date.now()
} = {}) {
  if (!acquireLock(finishSubmissionLock)) {
    return { skipped: true, reason: 'locked' };
  }

  if (finishButton) {
    finishButton.disabled = true;
  }

  const rawFinalHome = parseInt(homeFinalInput?.value, 10);
  const rawFinalAway = parseInt(awayFinalInput?.value, 10);
  const requestedHome = Number.isNaN(rawFinalHome) ? state.home : rawFinalHome;
  const requestedAway = Number.isNaN(rawFinalAway) ? state.away : rawFinalAway;
  const summary = notesFinalInput?.value?.trim() || '';
  const sendEmail = Boolean(finishSendEmailInput?.checked);
  const recipientEmail = resolveRecipient({
    teamNotificationEmail: currentTeam?.notificationEmail,
    userEmail: currentUser?.email
  });
  const finishPlanArgs = {
    requestedHome,
    requestedAway,
    liveHome: state.home,
    liveAway: state.away,
    scoreLogIsComplete: state.scoreLogIsComplete,
    log: state.log,
    currentPeriod: state.period,
    currentClock: formatClock(state.clock),
    summary,
    sendEmail,
    teamId: currentTeamId,
    gameId: currentGameId,
    teamName: currentTeam?.name || '',
    opponentName: currentGame?.opponent || 'Unknown Opponent',
    recipientEmail,
    columns: currentConfig?.columns || [],
    statTrackerConfig: currentConfig || {},
    roster,
    statsByPlayerId: state.stats,
    activePlayerIds: state.onCourt,
    substitutions: state.subs,
    opponentEntries: state.opp,
    currentUserUid: currentUser?.uid,
    buildEmailBody: (finalHome, finalAway, recapSummary, logEntries) => generateEmailBody(finalHome, finalAway, recapSummary, logEntries)
  };

  let finishPlan = buildPlan(finishPlanArgs);
  let addedReconciliationLogEntry = null;

  if (finishPlan.scoreReconciliation.mismatch) {
    addedReconciliationLogEntry = {
      text: finishPlan.reconciliationNote,
      ts: now(),
      period: state.period,
      clock: formatClock(state.clock)
    };
    state.log.unshift(addedReconciliationLogEntry);
    renderLog();
    if (homeFinalInput) {
      homeFinalInput.value = String(finishPlan.finalHome);
    }
    if (awayFinalInput) {
      awayFinalInput.value = String(finishPlan.finalAway);
    }
    finishPlan = buildPlan({
      ...finishPlanArgs,
      log: state.log
    });
  }

  try {
    await commitFinishPlan({
      finishPlan,
      db,
      currentTeamId,
      currentGameId,
      createBatch,
      createCollectionRef,
      createDocRef,
      beforePrimaryCommit: beforeFinalizationCommit
    });
    await endLiveBroadcast();
    onFinishStateChange(true);

    executeNavigationPlan(finishPlan.navigation);

    return {
      skipped: false,
      finalHome: finishPlan.finalHome,
      finalAway: finishPlan.finalAway,
      finishPlan
    };
  } catch (error) {
    if (typeof onCommitFailure === 'function') {
      try {
        const failureResult = await onCommitFailure({ error, finishPlan });
        if (failureResult?.pending) {
          releaseLock(finishSubmissionLock);
          onFinishStateChange(false);
          if (finishButton) {
            finishButton.disabled = false;
          }
          return {
            skipped: false,
            pending: true,
            finalHome: finishPlan.finalHome,
            finalAway: finishPlan.finalAway,
            finishPlan,
            error
          };
        }
      } catch (handlerError) {
        console.error('Error queuing pending game finalization:', handlerError);
      }
    }

    if (addedReconciliationLogEntry && state.log[0] === addedReconciliationLogEntry) {
      state.log.shift();
      renderLog();
    }
    releaseLock(finishSubmissionLock);
    onFinishStateChange(false);
    if (finishButton) {
      finishButton.disabled = false;
    }
    console.error('Error finishing game:', error);
    alertFn('Error finishing game: ' + error.message);

    return {
      skipped: false,
      error
    };
  }
}
