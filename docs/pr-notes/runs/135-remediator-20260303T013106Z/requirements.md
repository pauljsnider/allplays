# Requirements Role Notes

## Objective
Address all unresolved PR #135 review threads with minimal code changes focused on security and reliability.

## Required outcomes
- Remove hardcoded service account identity from function source.
- Eliminate unreliable in-memory cache behavior in Cloud Functions.
- Restrict CORS from wildcard to explicit allowlist behavior.
- Remove hardcoded Cloud Function URL from client utility code.
- Harden URL validation to block SSRF targets including private/link-local IP ranges and metadata endpoints.
- Ensure timeout/fetch failures are caught and surfaced as controlled errors.

## Constraints
- Keep changes scoped to `functions/index.js` and `js/utils.js` plus run notes.
- Preserve existing API response shape as much as possible.
- Prefer secure failure modes when configuration is missing.
