# Code role plan

## Smallest viable change
1. Add `resolveSummaryRecipient` helper module.
2. Add failing unit tests covering team-priority recipient behavior.
3. Update `finishAndSave()` to use resolver.
4. Run unit tests for new file and nearby live-tracker helper tests.
5. Commit with issue reference.

## Tradeoffs
- Chosen over direct inline conditional to keep behavior testable and explicit.
- Avoids broader refactor of live-tracker page script.
