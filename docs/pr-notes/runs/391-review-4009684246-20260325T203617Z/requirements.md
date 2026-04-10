Objective: close PR #391 review feedback with evidence that the parent dashboard RSVP refactor preserves grouped and per-child RSVP behavior.

Current state: commit `eee4b13` fixes the runtime TDZ and stale schedule capture, but the focused unit file still reflects the pre-fix controller API and fails.
Proposed state: keep the shipped controller fix, update tests to the getter-based contract, and add a regression that proves post-init schedule reassignment still submits correctly.

Risk surface: parent dashboard RSVP submissions for parents across grouped rows and per-child cards. Blast radius stays limited to test coverage and review traceability in this pass.
Acceptance: focused RSVP unit tests pass on the PR head and include coverage for late-bound schedule data plus handler export ordering.
