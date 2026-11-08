# Requirements review

## Acceptance criteria

- Export one parent household service operation for revoking an existing household membership.
- Treat the membership document ID as the authoritative target identifier.
- Reject missing, empty, or whitespace-only membership IDs before invoking the legacy adapter.
- Delegate valid requests through `legacyParentTools` to the existing `removeFamilyMember` binding.
- Preserve authoritative success and failure semantics without recreating backend revocation logic.

## Root cause and scope

The callable and legacy client operation already exist, but the React compatibility adapter only exposes household read/create capabilities. This integration-surface omission prevents the parent household service from offering revocation. UI controls, confirmation/refresh behavior, backend callable changes, and mobile smoke coverage remain out of scope.

## Domain guardrails

- Name the target `membershipId` throughout.
- Validate before any side effect.
- Do not infer a membership from linked-family data.
- Allow adapter failures to reach callers.
