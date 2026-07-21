# Problem Statement

Current logging sanitizes credentials but leaves email addresses intact in free-form messages and normalized errors. Auth/session failures can therefore expose parent, coach, athlete, or administrator identity data. The narrowest self-contained PR is email redaction in the shared logger.

# User Segments Impacted

- Parents, coaches, and administrators whose account identifiers may appear in diagnostics.
- Support and engineering operators, who still need safe error type, status, operation, and message context.

# Acceptance Criteria

1. Conventional email addresses in strings processed by the shared sanitizer become `[REDACTED_EMAIL]`.
2. Mixed-case, plus-addressed, and multi-part-domain addresses are covered.
3. `Error.message`, nested structured values, and direct logger messages use the same redaction path.
4. Existing credential redaction and safe diagnostic context remain unchanged.
5. Auth/session UI and authorization behavior do not change.
6. Focused regression tests fail on current master and pass after the fix.

# Non-Goals

- Secure session storage, image-upload session migration, install epochs, or bootstrap-hint minimization.
- Association-file enforcement, signing evidence, session purge, or auth-routing changes.
- Reviving or rebasing the frozen #4046 branch.

# Edge Cases

- Multiple and nested email addresses.
- Plus-addresses and multi-label domains.
- Email and token data in the same message.
- Non-email text containing `@` should not be broadly erased.

# Open Questions

None blocking.
