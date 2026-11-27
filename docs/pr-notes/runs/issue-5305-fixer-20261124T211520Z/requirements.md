# Requirements analysis

Issue #5305 adds one narrow authoritative state for individual Firebase function
targets: explicit update evidence. The existing application-wide and individual
current-evidence behavior must remain unchanged, and unchanged, partial, retry,
Hosting, and workflow-gating evidence stays out of scope.

Treat an update as explicit only when the evidence binds the expected project
and function target to both the expected artifact SHA and the expected
deployment identity. A status-only mutation is not proof of an update. Reject
missing, malformed, extra, mixed-state, or mismatched evidence fail closed.

The requested requirements skill was unavailable, and the spawned requirements
lane failed before analysis because its reply runtime was missing. This artifact
records the main-run fallback synthesis.
