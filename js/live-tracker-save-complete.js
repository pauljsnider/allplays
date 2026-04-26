import { acquireSingleFlightLock, releaseSingleFlightLock } from './live-tracker-integrity.js?v=2';
import { resolveSummaryRecipient } from './live-tracker-email.js?v=2';
import { buildFinishCompletionPlan, executeFinishNavigationPlan } from './live-tracker-finish.js?v=1';

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
  finishPlan.eventWrites.forEach(({ data }) => {
    const eventRef = createDocRef(createCollectionRef(db, `teams/${currentTeamId}/games/${currentGameId}/events`));
    batch.set(eventRef, data);
  });

  finishPlan.aggregatedStatsWrites.forEach(({ playerId, data }) => {
    const statsRef = createDocRef(db, `teams/${currentTeamId}/games/${currentGameId}/aggregatedStats`, playerId);
    batch.set(statsRef, data);
  });

  const gameRef = createDocRef(db, `teams/${currentTeamId}/games`, currentGameId);
  batch.update(gameRef, finishPlan.gameUpdate);
}

export async function commitFinishPlan({
  finishPlan,
  db,
  currentTeamId,
  currentGameId,
  createBatch,
  createCollectionRef,
  createDocRef
} = {}) {
  const batch = createBatch(db);
  addFinishPlanWritesToBatch({
    finishPlan,
    batch,
    db,
    currentTeamId,
    currentGameId,
    createCollectionRef,
    createDocRef
  });
  await batch.commit();
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
    roster,
    statsByPlayerId: state.stats,
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
    const batch = createBatch(db);

    addFinishPlanWritesToBatch({
      finishPlan,
      batch,
      db,
      currentTeamId,
      currentGameId,
      createCollectionRef,
      createDocRef
    });

    if (typeof beforeFinalizationCommit === 'function') {
      await beforeFinalizationCommit({ finishPlan });
    }
    await batch.commit();
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
