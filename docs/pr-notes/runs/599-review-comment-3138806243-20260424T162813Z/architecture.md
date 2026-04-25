# Architecture

## Current State
`maybeNotifyScheduleChange` loops over targets and aborts on the first `postChatMessage` rejection. That escalates partial delivery problems into full failures and prevents later targets from being attempted.

## Proposed State
Centralize multi-target posting in a helper that tracks successes and per-target failures. Callers treat any success as a sent notification and surface an error only when all targets fail.

## Blast Radius
Localized to schedule notification dispatch in `edit-schedule.html`, shared helper logic in `js/schedule-notifications.js`, and the cancellation helper reuse path.

## Risks
Low. Main risk is suppressing visible alerts for partial failures, mitigated by warning logs while preserving hard failures when all targets fail.

## Rollback
Revert the shared notification helper usage and restore the prior direct loop if unexpected dispatch regressions appear.
