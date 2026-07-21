# Current-State Read

The shared logger redacts secret-shaped keys, bearer tokens, sensitive URL parameters, and assignments, but not identity-shaped PII embedded in ordinary strings. Auth/session errors can therefore leak email addresses after passing through the approved logger.

# Proposed Design

Add a small email-address redactor to the existing free-form sanitizer composition. Keep `sanitizeValue` as the single entry point so direct messages, nested values, normalized errors, and telemetry consumers inherit the protection.

# Files And Modules Touched

- `apps/app/src/lib/logger.ts`
- `apps/app/src/lib/logger.test.ts`

# Data/State Impacts

No persisted data, schema, auth state, session state, cache, or Firebase changes. Only emitted diagnostic text changes.

# Security/Permissions Impacts

PII exposure is reduced without changing permissions, tenant isolation, plugins, native shells, credentials, or signing policy.

# Failure Modes And Mitigations

- Conservative false positives are acceptable in logs; surrounding diagnostic context remains.
- Unusual internationalized address forms may be missed; broader PII detection is a separate reviewed slice.
- Existing sanitizer tests protect token and secret behavior from composition regressions.
- Raw `console.*` calls remain outside this slice.
