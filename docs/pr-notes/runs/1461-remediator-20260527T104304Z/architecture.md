# Architecture

## Architecture Decisions
- Keep quantity-discount detection in `js/registration-flow.js`, the shared registration pricing/flow module used by both legacy and React app paths.
- Do not duplicate discount-rule normalization in `RegistrationDetail.tsx`; the page should consume the shared helper.

## Risks And Rollback
- Risk: stale review feedback may refer to an earlier PR revision. Evidence in this workspace shows the export is present at `js/registration-flow.js`.
- Rollback: removing only this note commit has no runtime impact. No source rollback is required for the review item because the helper is already exported.
