# Architecture

## Current State
- `edit-team.html` uses `inviteExistingTeamAdmin(...)` for existing-team admin invites.
- `buildAdminInviteFollowUp(...)` generates shareable invite URLs for code-based follow-up.
- `accept-invite.html` routes admin codes through `createInviteProcessor(...)` and `redeemAdminInviteAtomically(...)`, then redirects to `dashboard.html`.
- Coverage previously existed in isolated unit tests, not across the Team Management to accept-invite boundary.

## Architecture Decisions
1. Keep the patch minimal and static-site safe.
2. Add browser-level coverage with mocked Firebase module boundaries but real page scripts.
3. Preserve `type=admin` in generated admin invite URLs and post-auth redirect URLs so the logged-out admin path cannot silently downgrade to the parent flow.
4. Add page-level admin coverage to `accept-invite` alongside the existing parent page coverage.

## Risks
- Test brittleness from page-script harnesses and redirect timing.
- Silent regression risk if invite URLs or login redirects drop the admin type again.

## Rollback
- Revert the admin invite redirect/link changes and the added tests.
- No schema, rules, or production-data rollback is required.
