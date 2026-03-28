# Requirements Role Synthesis (Fallback)

## Note on orchestration tooling
Requested skills (`allplays-orchestrator-playbook`, `allplays-requirements-expert`) and `sessions_spawn` are not available in this runtime. This artifact captures equivalent requirements analysis.

## Objective
Ensure cancelled events from ICS feeds do not appear as active scheduled events on `calendar.html`.

## Current vs proposed behavior
- Current: ICS imports in `calendar.html` hardcode `status: 'scheduled'`, ignoring parsed cancellation signals.
- Proposed: ICS events map to `status: 'cancelled'` when either ICS `STATUS:CANCELLED` is present or TeamSnap-style `[CANCELED]` appears in `SUMMARY`.

## Acceptance criteria
1. ICS `STATUS:CANCELLED` events render with cancelled styling/logic in calendar views.
2. ICS `[CANCELED]` summary events render with cancelled styling/logic in calendar views.
3. Non-cancelled ICS events remain scheduled and unchanged.

## Risk surface and blast radius
- Surface: calendar ICS event mapping only.
- Blast radius: `calendar.html` display logic for imported (source=`ics`) events.
- No Firestore writes, auth, or schedule CRUD path changes.

## Assumptions
- `parseICS` already populates `event.status` from ICS fields.
- Existing UI treats `ev.status === 'cancelled'` as cancellation source of truth.
