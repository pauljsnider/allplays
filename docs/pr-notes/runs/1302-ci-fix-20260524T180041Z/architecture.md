# Architecture notes

## Acceptance Criteria
- Upcoming schedule filters exclude cancelled calendar imports so future cancellation notices do not appear as actionable upcoming rows.
- Rendering coverage for cancelled imported rows remains, using the past-events view where cancelled items are intentionally visible.

## Architecture Decisions
- Current branch added cancellation filtering to upcoming schedule views.
- Treat the preview-smoke failure as test drift, consistent with the branch's `isUpcomingScheduleEvent()` cancellation guard and the team schedule filter unit contract.
- Role analysis split: one view treated smoke expectations as authoritative visibility contract; another treated issue behavior as authoritative and recommended test drift update.
- Chosen direction is based on local source/test evidence and the PR CI classifier, with minimal blast radius.
- Do not change production schedule filtering for this CI fix.

## Risks And Rollback
- Risk: losing action-suppression coverage for cancelled rows. Mitigation: preserve it in the past-events smoke test.
- Rollback: revert the smoke expectation changes if product decides future cancellations should remain visible in upcoming lists.
