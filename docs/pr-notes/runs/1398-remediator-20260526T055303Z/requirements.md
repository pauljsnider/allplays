# Requirements

- Staff & Permissions pending admin invites must include only unused `admin_invite` records for the current team that are still valid.
- Expired invites must be excluded because redemption rejects them after the 7-day validity window.
- Non-active invites, including revoked, explicitly inactive, or cancelled/non-pending statuses, must not appear.
- Parent/non-manager users must not trigger invite loading.
