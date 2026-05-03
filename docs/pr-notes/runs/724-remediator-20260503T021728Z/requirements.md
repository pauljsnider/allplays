# PR 724 Remediator Requirements

Subagent orchestration note: role-specific sessions_spawn was unavailable in this runtime (`agentId is not allowed`), so this note records the inline requirements analysis.

## Acceptance Criteria
- Public registration writes only accept `participant` and `guardian` payloads when each is a map of flat string values.
- Public registration writes reject nested maps, arrays, numbers, booleans, or other non-string values inside `participant` and `guardian`.
- Public registration form labels render Firestore-provided metadata as text, not HTML.
- Required field marker is appended separately so required labels still render clearly.
- Scope stays limited to `firestore.rules`, `registration.html`, and direct unit coverage.

## Ambiguity
- Firestore Rules do not support general-purpose iteration. Use a bounded field-count helper to validate dynamic maps without introducing form-schema denormalization.
