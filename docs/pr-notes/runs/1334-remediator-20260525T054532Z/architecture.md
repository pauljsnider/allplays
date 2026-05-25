# Architecture notes

Subagent role spawning was unavailable in this environment, so this note captures inline architecture analysis.

## Decision
Block online-checkout forms inside `RegistrationDetail` immediately after load and before the offline form is rendered. Add a defensive submit guard that refuses submission if an online-checkout form somehow reaches submit state.

## Blast radius
- Scoped to the parent registration detail page.
- No service API or Firestore write-path changes.
- Offline forms keep the existing path and validation.

## Rollback
Revert the `RegistrationDetail.tsx` guard and the associated regression test.
