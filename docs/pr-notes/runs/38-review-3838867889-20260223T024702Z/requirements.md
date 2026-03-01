# Requirements Role Notes

## Objective
Eliminate regex-driven ReDoS risk in TeamSideline standings parsing without changing user-visible standings behavior.

## Current State
`parseTeamSidelineStandings` selected a table using broad nested regex patterns over full HTML input.

## Proposed State
Use deterministic table scanning and targeted header/id checks, then keep existing row/cell extraction and match behavior.

## Risk Surface and Blast Radius
- Affects only standings ingestion path (`js/league-standings.js`).
- No Firebase schema/auth/UI flow changes.
- Blast radius limited to league-link standings display and matching.

## Assumptions
- TeamSideline standings markup continues to include a complete `<table>...</table>` block.
- Required headers remain `Team`, `W`, `L` when table id is absent.

## Recommendation
Replace vulnerable table-detection regex with linear scans and retain existing parse semantics.

## Success Metrics
- Existing standings parser tests pass.
- New tests cover single-quoted id detection and large non-table payload handling.
