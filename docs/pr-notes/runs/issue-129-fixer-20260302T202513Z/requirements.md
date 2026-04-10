# Requirements Role Synthesis

## Objective
Prevent replay timeline jumps and skipped events when changing playback speed mid-replay.

## User-visible Current State
Replay elapsed time can jump forward when speed is changed during active playback, causing events/chat/reactions to be consumed too quickly.

## Proposed State
Speed changes preserve the current replay position exactly, then apply new speed only to future playback progression.

## Acceptance Criteria
- Changing speed while replay is playing does not cause immediate timeline jumps.
- Replay events/chat/reactions remain ordered and are not skipped due to speed changes.
- Regression test fails on old behavior and passes with fix.

## Assumptions
- Replay speed controls are available only in replay mode.
- Replay timeline continuity is represented by `gameClockMs` / elapsed replay milliseconds.
