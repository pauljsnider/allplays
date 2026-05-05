# PR 724 Remediator Architecture Notes

Subagent orchestration note: role-specific sessions_spawn was unavailable in this runtime (`agentId is not allowed`), so this note records the inline architecture analysis.

## Architecture Decisions
- Keep the public unauthenticated registration surface intact, but tighten server-side payload acceptance in Firestore Rules.
- Add a reusable Firestore Rules helper for bounded flat string maps and use it for both `participant` and `guardian`.
- Limit each map to 20 fields to provide a concrete guardrail against oversized dynamic payloads and enable explicit value checks within Firestore Rules language constraints.
- Replace label `innerHTML` construction with DOM node creation and `textContent` to eliminate stored-XSS execution from form metadata.

## Risks And Rollback
- Risk: forms with more than 20 participant or guardian fields would be rejected. Current public registration forms should remain well below this; rollback is to raise the helper bound with matching explicit checks.
- Rollback: revert the helper and label rendering changes in this commit.
