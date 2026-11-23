# Requirements analysis — Issue #5195

The blocked assignment flow must continue as one user journey: a parent with Not Responded, Maybe, or Not Going selects Sign up, is sent to Availability, saves Going, and immediately sees the original assignment as claimable without a reload.

## Acceptance behavior

- Resume the interrupted assignment flow only after RSVP persistence succeeds.
- Preserve all existing assignment availability, permission, filled-slot, and busy-state rules.
- Replace attendance guidance with the normal Sign up action after the successful transition.
- Keep claim submission user-initiated; RSVP success must not claim automatically.
- A failed RSVP save must remain on Availability and must not expose Sign up.
- Repeated renders must not duplicate RSVP or claim requests.

## Non-goals

No backend claim validation, Firestore rule, RSVP persistence API, data-model, or broad assignment-card redesign changes.
