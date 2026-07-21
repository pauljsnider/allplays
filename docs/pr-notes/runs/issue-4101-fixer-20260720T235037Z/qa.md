# Risk Matrix

| Risk | Level | Mitigation |
|---|---|---|
| Email PII remains in normalized auth/session errors | High | Test `normalizeErrorForLogging` with a representative account email. |
| Nested/free-form values bypass redaction | High | Test direct `sanitizeForLogging` with plus-address and multi-part domain. |
| Existing token/secret redaction regresses | Medium | Retain the focused logger suite unchanged. |
| Regex over-redacts diagnostic text | Low | Use a bounded conventional-email pattern and preserve surrounding text. |
| Signing-dependent work enters scope | High | Limit the diff to logger implementation, test, and run notes. |

# Automated Tests To Add/Update

- Add a focused logger regression covering normalized `Error.message` email PII.
- Cover plus-addressed and multi-part-domain email text through the shared sanitizer.
- Run the complete focused logger test file to retain credential-redaction coverage.

# Manual Test Plan

No user-facing behavior changes. Inspect a representative sanitized auth failure and confirm the email is replaced while operation/error context remains.

# Negative Tests

- Existing bearer token, URL secret, structured secret-key, circular value, and truncation cases remain green.
- Confirm ordinary non-email prose is unchanged.

# Release Gates

- Focused logger test passes.
- `git diff --check` passes.
- No auth persistence, bootstrap hint, install epoch, association, signing, or native build files change.

# Post-Deploy Checks

Sample auth/session diagnostics for one release window and verify account emails are absent while error scopes and status metadata remain usable.

## Role Conflict Note

QA initially recommended bootstrap-hint minimization. The orchestrator selected logger redaction because three roles converged on it and it has the smaller state and routing blast radius. Bootstrap hints remain an independent follow-up PR.
