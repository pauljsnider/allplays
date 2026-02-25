# Code Role Summary

## Minimal Patch
1. Replace `const targetStartedAt = Date.now();` with `const targetStartedAt = nowMs;`.
2. Replace both `Date.now() - targetStartedAt` calculations with `nowMs - targetStartedAt`.
3. Execute targeted unit tests for rainout runtime.

## Rollback
Revert the single-file change in `js/rainout-polling-runtime.js` if any unexpected telemetry behavior is reported.
