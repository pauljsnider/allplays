# Architecture Role Summary

## Current State
`executeRainoutPollingRun` accepted `nowMs` but mixed runtime wall-clock reads (`Date.now()`) into per-target timing.

## Proposed State
Single execution-scoped time source: `nowMs` drives target start and duration calculations.

## Risk Surface / Blast Radius
- Scope: `js/rainout-polling-runtime.js` only.
- Blast radius: low; no schema/API change.
- Tradeoff: per-target durations in one run become deterministic (often `0`) instead of elapsed wall-clock.

## Control Equivalence
- Tenant isolation, idempotency, and feature-flag paths unchanged.
