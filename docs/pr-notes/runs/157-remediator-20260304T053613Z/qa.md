# QA Role Notes

## Risk to Validate
- Regression: rideshare should still appear for DB games and DB practices (including expanded recurring DB practices with per-instance IDs).
- Fix validation: rideshare should not appear for ICS-derived non-DB practice events.

## Manual Checks
1. Parent dashboard event list shows rideshare controls on DB game/practice events.
2. ICS-only recurring practice entries show no rideshare section.
3. Existing rideshare offers remain readable on DB events.
