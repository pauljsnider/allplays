Scope: CI workflow only.

Root cause evidence:
- Failing step: `Prune stale Firebase preview channels`.
- Logged error: delete of `pr-424` returned HTTP 404 / Not Found.
- This indicates cleanup encountered an already-removed channel and exited non-zero.

Validation plan:
- Inspect workflow syntax after edit.
- Confirm only 404/not-found delete errors are ignored.
- Confirm other delete failures still emit logs and exit 1.

Residual risk:
- Match depends on Firebase CLI continuing to emit `HTTP Error: 404` or `Not Found` for the benign case.
- No local end-to-end Firebase validation is possible without CI secrets and hosted resources.
