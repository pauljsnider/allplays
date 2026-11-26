# Code plan

The requested `allplays-code-expert` skill was unavailable, and the required
role subagent failed with `published reply runtime missing for main`. This
fallback analysis applies the requested minimal-patch implementation role.

1. Update the aggregate verifier tests first with a quota-pressure partial case,
   a non-terminal identity case, and a terminal complete case.
2. Add a small incomplete-target failure helper in
   `scripts/verify-firebase-application-deployment.mjs` that emits a stable code
   and frozen target-name-only metadata.
3. In `verifyFunctionDeployments`, resolve all intended entries, classify only
   `updated`/`unchanged` entries as complete, and fail once with the ordered
   list of incomplete targets before returning results.
4. Preserve individual verification behavior and existing strict evidence-shape
   checks.
5. Run the single adjacent Vitest file, inspect the diff and worktree, then
   commit tests, implementation, and role artifacts together with issue #5291.

Recurrence risk is low after the regression because the aggregate completion
boundary becomes explicit; future evidence statuses must be deliberately added
to the terminal-status predicate before they can satisfy completeness.
