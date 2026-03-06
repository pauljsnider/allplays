export function getReplayElapsedMs(nowMs, replayStartTimeMs, replaySpeed) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(replayStartTimeMs) || !Number.isFinite(replaySpeed) || replaySpeed <= 0) {
    return 0;
  }
  return Math.max(0, (nowMs - replayStartTimeMs) * replaySpeed);
}

export function rebaseReplayStartTimeMs(nowMs, currentElapsedMs, nextReplaySpeed) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(currentElapsedMs) || !Number.isFinite(nextReplaySpeed) || nextReplaySpeed <= 0) {
    return nowMs;
  }
  return nowMs - (Math.max(0, currentElapsedMs) / nextReplaySpeed);
}

export function getReplayStartTimeAfterSpeedChange(nowMs, replayStartTimeMs, replaySpeed, nextReplaySpeed, gameClockMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(nextReplaySpeed) || nextReplaySpeed <= 0) {
    return nowMs;
  }

  if (Number.isFinite(replayStartTimeMs) && Number.isFinite(replaySpeed) && replaySpeed > 0) {
    const elapsedMs = getReplayElapsedMs(nowMs, replayStartTimeMs, replaySpeed);
    return rebaseReplayStartTimeMs(nowMs, elapsedMs, nextReplaySpeed);
  }

  if (Number.isFinite(gameClockMs)) {
    return nowMs - (Math.max(0, gameClockMs) / nextReplaySpeed);
  }

  return nowMs;
}
