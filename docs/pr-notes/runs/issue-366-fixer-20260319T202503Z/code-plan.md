Thinking level: medium
Reason: the behavior is subtle but localized, and the fastest safe path is a small extraction plus tests.

Plan:
1. Add a pure helper that resolves final completion scores from requested score, live score, log contents, and `scoreLogIsComplete`.
2. Replace inline reconciliation logic in `js/live-tracker.js` with the helper call.
3. Update the equivalent basketball tracker path to keep parity.
4. Extend `tests/unit/live-tracker-integrity.test.js` with resumed-flow and cleared-log coverage, plus a live-tracker source wiring assertion.
5. Run targeted unit tests, then commit with an issue-referencing message.
