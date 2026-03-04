# Code Role Notes

## Minimal Change Plan
1. Update `canShowRideshareForEvent` in `parent-dashboard.html` to require `event.isDbGame`.
2. Keep all existing null/cancelled guards intact.
3. Run lightweight validation (`git diff`, optional grep check) and commit with scoped message.
