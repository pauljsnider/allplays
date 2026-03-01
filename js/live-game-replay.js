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
