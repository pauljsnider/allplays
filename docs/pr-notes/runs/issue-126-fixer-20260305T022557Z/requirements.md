# Requirements Role (fallback local synthesis)

## Objective
Prevent users from seeing a deterministic-fail AI action in the Finish Game flow when Firebase AI/billing is unavailable.

## User constraints
- Coaches finishing a game must complete the flow without avoidable errors.
- If AI capability is not enabled, UI must not present a primary action that fails.

## Acceptance criteria
- Finish modal no longer exposes active AI generation by default when capability flag is off.
- AI button is hidden/disabled before click-path runtime failure.
- Existing non-AI finish flow remains unchanged.
