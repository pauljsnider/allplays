# QA

## Risk Matrix

- High: backlog starvation, duplicate delivery, failure-release loops, and inaccurate budget termination.
- Medium: equal-timestamp cursor stability and audience/payload regressions.
- Low: client surfaces, which are unchanged.

## Automated Tests To Add/Update

- 120-batch 50/50/20 drain, empty queue, partial final page, page cap, runtime cap, oldest-due order, resume without duplicates, and one-attempt-per-run failure release.
- Assert every query limit is 50 and the ordered cursor advances.
- Strengthen the source contract and include this test in `test:functions:notifications`.

## Manual Test Plan

Seed 120 emulator batches across teams, run with normal and low budgets, and verify drain/resume summaries plus unchanged audience behavior.

## Negative Tests

Future, sent, skipped, and sending batches are excluded; lost claims do not send; failed sends release once and do not block later pages.

## Release Gates

- Focused Team Media test.
- Notification contract test.
- `npm run test:functions:notifications`, with the Team Media file visibly executed.

## Post-Deploy Checks

Monitor stop reasons, processed counts, oldest pending age, released failures, and duplicate/cross-team delivery.
