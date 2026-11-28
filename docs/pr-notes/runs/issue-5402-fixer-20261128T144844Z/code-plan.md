# Code plan

The requested `allplays-code-expert` skill was unavailable, and the required role subagent failed with `published reply runtime missing for main`. This fallback analysis applies the requested minimal-patch implementation role.

1. Add a workflow contract regression that fails while the targeted deploy is not followed by verification.
2. Add a narrow deploy-log adapter that imports the existing verifier without changing its implementation.
3. Copy and hash-pin both scripts in the trusted production handoff.
4. Preserve the successful targeted attempt log and call the adapter immediately after that deploy.
5. Run the focused workflow contract, direct adapter success/failure checks, YAML parsing, and the existing Firebase deploy-gate validator.
6. Commit the workflow, adapter, test, and role artifacts together with issue #5402.

Recurrence risk is low after the ordering and trust-boundary regression; Firebase CLI wording changes remain the main risk and fail closed as missing evidence.
