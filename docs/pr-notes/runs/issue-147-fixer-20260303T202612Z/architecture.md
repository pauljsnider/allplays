# Architecture Role - Issue #147

## Decision
Patch ICS normalization at calendar import boundary (where ICS event objects are converted to calendar event objects).

## Why Here
- Root cause exists at mapping line where status is hardcoded.
- UI and filtering already key off `ev.status === 'cancelled'`.
- Minimal change preserves existing behavior for non-cancelled events.

## Control Equivalence
- Existing controls for cancelled DB events remain unchanged.
- New behavior aligns ICS events with same cancellation control path.

## Conflict Resolution
- Requirements suggests preserving cancellation semantics.
- QA requires regression protection.
- Code lane recommends single-line mapping fix plus targeted test.
- Resolved path: keep fix local to calendar mapping; avoid broad refactor.

## Rollback
Revert single mapping change in `calendar.html` and associated test file if unexpected regression appears.
