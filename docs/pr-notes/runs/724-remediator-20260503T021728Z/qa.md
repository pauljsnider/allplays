# PR 724 Remediator QA Plan

Subagent orchestration note: role-specific sessions_spawn was unavailable in this runtime (`agentId is not allowed`), so this note records the inline QA analysis.

## QA Plan
- Run unit tests for the registration flow.
- Verify the HTML source no longer assigns `field.label` through `innerHTML` and instead uses `textContent`.
- Verify Firestore Rules source requires `hasOnlyFlatStringValues(data.participant)` and `hasOnlyFlatStringValues(data.guardian)`.
- Validate Firestore Rules syntax with Firebase tooling if available.

## Manual Security Checks
- Malicious label like `<img src=x onerror=alert(1)>` should display as text in the label.
- Nested payload like `participant: { name: { first: 'Sam' } }` should fail rules because the value is not a string.
