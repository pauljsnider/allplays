# Requirements Role Notes

## Objective
Ensure rideshare Request/Cancel controls in day-modal context reflect the child currently selected in the picker, not only the default child.

## UX Decision
- Child picker selection is the source of truth for eligibility and current request state.
- Selection persistence must survive modal rerenders triggered by data refreshes.

## Success Criteria
- Changing child in dropdown immediately changes Request/Cancel visibility for that offer.
- Existing request status text references the selected child.
- No behavior change for single-child parents or non-modal rideshare rendering.
