# Code plan

1. Add focused Vitest coverage for the application-wide current evidence contract.
2. Add a pure exported validator with exact supported literals and strict object/field validation.
3. Compare project, deploy-target, deploy-label, and artifact SHA evidence to explicit expected deployment identity.
4. Reject extra or unsupported evidence fields so out-of-scope states remain fail closed.
5. Run only the focused Vitest file, inspect the diff, and commit the test and implementation together.

Only the main issue-fixer run edits, validates, stages, and commits. Role lanes are analysis-only.
