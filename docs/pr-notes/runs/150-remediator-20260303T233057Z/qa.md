# QA role analysis

- Target regression: Detect speed-change discontinuity without introducing synthetic elapsed mismatch.
- Test update plan: Replace `9_800` with computed-consistent `10_000` in the first test case.
- Validation: Run the specific Vitest file `tests/unit/live-game-replay-speed.test.js` and confirm all cases pass.
- Residual risk: None observed for production behavior because code under test is unchanged.
