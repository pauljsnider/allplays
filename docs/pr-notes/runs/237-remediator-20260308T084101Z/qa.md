Test focus:
- Shared-game projection for single-game reads stays aligned with list reads.
- Synthetic shared IDs no longer include `::`.
- Legacy synthetic IDs still decode correctly.
- Composite key parsing preserves a shared game ID that contains the legacy delimiter.

Validation plan:
- Run `npm test -- --run tests/unit/shared-games.test.js`.
- Review affected schedule parsing sites in `calendar.html` and `parent-dashboard.html` for first-delimiter parsing.
