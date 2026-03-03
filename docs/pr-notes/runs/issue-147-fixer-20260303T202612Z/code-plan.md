# Code Role Plan - Issue #147

Thinking level: low (single-path bug with clear root cause and existing cancellation semantics elsewhere).

## Steps
1. Add failing unit regression test in `tests/unit/calendar-ics-cancelled-status.test.js`.
2. Update `calendar.html` ICS mapping to derive status from parsed ICS cancellation signals.
3. Run targeted Vitest command for new test.
4. Stage, commit with issue reference.

## Minimal Patch Scope
- `calendar.html`
- `tests/unit/calendar-ics-cancelled-status.test.js`
