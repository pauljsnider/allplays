# Requirements Role Notes (Fallback Synthesis)

Skill availability note: `allplays-orchestrator-playbook` and `allplays-requirements-expert` were requested but are not present in this session's available skill list. This document captures equivalent analysis.

## Objective
Ensure ICS-synced practice events appear as `practice` on `calendar.html` so filtering and workflows match user intent.

## Current State
- Calendar page maps ICS entries with `type: ev.isPractice ? 'practice' : 'game'`.
- ICS classification signal may be absent for some event payloads (legacy parser output or inconsistent source fields).
- Result: practice summaries can be displayed/filtered as games.

## Proposed State
- Calendar page must infer practice vs game from summary when `ev.isPractice` is missing, using existing `isPracticeEvent(summary)` behavior used elsewhere.
- Preserve explicit boolean `ev.isPractice` when present.

## Acceptance Criteria
- ICS event with summary like `U12 Practice` and no `isPractice` property is typed as `practice` on calendar page.
- ICS event with summary like `Tigers vs Lions` and no `isPractice` remains `game`.
- ICS event with explicit `isPractice: false` remains `game` even if summary includes ambiguous text.

## Risk / Blast Radius
- Low blast radius: calendar page ICS mapping only.
- No Firestore schema/data changes.
- No auth/access control changes.
