# QA Role Notes (Fallback Synthesis)

Skill availability note: `allplays-orchestrator-playbook` and `allplays-qa-expert` were requested but are not present in this session's available skill list. This document captures equivalent analysis.

## Test Strategy
Add focused unit coverage around calendar event type resolution when ICS objects do not include `isPractice`.

## Failing-First Cases to Add
1. Event with `summary: U12 Practice` and missing `isPractice` should resolve to `practice`.
2. Event with explicit `isPractice: false` should resolve to `game`.
3. Event with non-practice summary should resolve to `game`.

## Regression Checks
- Run targeted unit test file for calendar ICS typing plus existing parseICS practice classification test.
- Verify no changes to recurrence tests or parent-dashboard packet tests.

## Manual Sanity (documented)
- On `calendar.html`, with ICS practice event, `Practices` filter shows event.
