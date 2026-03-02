# Current-State Read
`accept-invite.html` resolves admin invite email as `profile?.email || authEmail`. If both are empty, `redeemAdminInviteAcceptance` throws `Missing user email`.

# Proposed Design
Add a third fallback in `processInvite`: `validation?.data?.email`, sourced from invite payload created by `inviteAdmin`.

# Files And Modules Touched
- `accept-invite.html` (admin invite branch in `processInvite`)

# Data/State Impacts
- Read-only usage of existing `validation` data already fetched in function scope.
- No schema writes added.

# Security/Permissions Impacts
- No permission model changes.
- Uses email originally encoded in invite record; does not broaden access.

# Failure Modes And Mitigations
- If all sources missing, existing explicit error remains.
- If invite email malformed, downstream normalization/validation in `addTeamAdminEmail` and existing auth constraints still apply.
