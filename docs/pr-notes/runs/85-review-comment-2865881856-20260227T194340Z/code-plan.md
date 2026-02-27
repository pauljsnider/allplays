# Code Role Summary

## Implementation Plan
1. Extend invite helper module with follow-up payload builder to avoid duplicating invite-status parsing in page code.
2. Update `edit-team.html` new-team save flow to:
   - show copyable invite redemption details when shareable codes exist
   - keep manual follow-up alert for unresolved outcomes
3. Add unit tests for helper output contract.

## Implemented Files
- `js/edit-team-admin-invites.js`
- `edit-team.html`
- `tests/unit/edit-team-admin-invites.test.js`
