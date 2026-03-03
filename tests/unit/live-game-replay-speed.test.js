import { describe, it, expect } from 'vitest';
import { getReplayElapsedMs, rebaseReplayStartTimeMs, getReplayStartTimeAfterSpeedChange } from '../../js/live-game-replay.js';

describe('live game replay speed timing', () => {
  it('prevents an immediate 1x to 4x jump around the 10-second mark', () => {
    const startTimeMs = 1_000;
    const nowMs = 11_000;
    const nextSpeed = 4;

    const elapsedAtSwitch = getReplayElapsedMs(nowMs, startTimeMs, 1);
    expect(elapsedAtSwitch).toBe(10_000);

    const rebasedStartTimeMs = getReplayStartTimeAfterSpeedChange(nowMs, startTimeMs, 1, nextSpeed, 10_000);
    expect(getReplayElapsedMs(nowMs, rebasedStartTimeMs, nextSpeed)).toBe(10_000);

    const oneFrameLaterElapsed = getReplayElapsedMs(11_016, rebasedStartTimeMs, nextSpeed);
    expect(oneFrameLaterElapsed).toBe(10_064);
  });

  it('keeps replay elapsed continuous when speed changes during playback', () => {
    const startTimeMs = 1_000;
    const speedBefore = 1;
    const speedAfter = 20;
    const speedChangeAtMs = 6_000;
    const nextFrameMs = 6_016;

    const elapsedBeforeChange = getReplayElapsedMs(speedChangeAtMs, startTimeMs, speedBefore);
    expect(elapsedBeforeChange).toBe(5_000);

    // Old behavior: start time not rebased, so changing speed retroactively multiplies past playback.
    const jumpedElapsed = getReplayElapsedMs(nextFrameMs, startTimeMs, speedAfter);
    expect(jumpedElapsed).toBe(100_320);

    const rebasedStartTimeMs = rebaseReplayStartTimeMs(speedChangeAtMs, elapsedBeforeChange, speedAfter);
    const elapsedAfterChange = getReplayElapsedMs(nextFrameMs, rebasedStartTimeMs, speedAfter);

    expect(elapsedAfterChange).toBe(5_320);
  });

  it('advances future playback at the new speed after rebasing', () => {
    const rebasedStartTimeMs = rebaseReplayStartTimeMs(20_000, 8_000, 10);

    expect(getReplayElapsedMs(20_100, rebasedStartTimeMs, 10)).toBe(9_000);
    expect(getReplayElapsedMs(20_250, rebasedStartTimeMs, 10)).toBe(10_500);
  });

  it('falls back to current game clock when speed changes and replayStartTime is invalid', () => {
    const nowMs = 50_000;
    const nextSpeed = 2;
    const gameClockMs = 12_000;

    const startTimeMs = getReplayStartTimeAfterSpeedChange(nowMs, null, 1, nextSpeed, gameClockMs);
    const elapsedAfterChange = getReplayElapsedMs(nowMs, startTimeMs, nextSpeed);

    expect(elapsedAfterChange).toBe(12_000);
  });
});
