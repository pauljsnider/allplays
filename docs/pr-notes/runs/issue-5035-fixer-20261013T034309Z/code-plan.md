# Code plan

## Minimal patch

1. Update document-form tests to expect range assignment and exercise an
   ordered partial failure through the actual submit handler.
2. Confirm the focused form suite fails because no document range is requested.
3. Add `reserveOrders: true` to the document form's `uploadSelectedFiles` call.
4. Run the focused form and DB ordering suites.
5. Review the diff, verify the worktree, and commit all implementation, tests,
   and run artifacts with issue `#5035` in the message.

## Prevention / learning

When a shared helper separates optional value propagation from value
allocation, test each real caller rather than only the helper seam. Cover a
valid zero, a nonzero value, absence, and a downstream failure so form wiring
cannot silently fall back to a different allocation path.

The named role skills were not present in the workspace/catalog, and the four
required OpenClaw analysis sessions could not start because the configured
runtime returned `published reply runtime missing for main`. These artifacts
record the equivalent evidence-based role reviews performed by the main run.
