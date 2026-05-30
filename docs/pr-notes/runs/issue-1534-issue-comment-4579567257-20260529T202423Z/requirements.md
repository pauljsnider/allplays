# Requirements, Issue #1534

## Acceptance Criteria
- If an online registration reserves capacity and Stripe checkout initiation throws, release that prepared registration before allowing retry.
- If checkout initiation returns no usable URL, release the same prepared registration before allowing retry.
- `registrationOptionCounts.<option>.enrolled` or `.waitlisted` returns to the pre-submit value after checkout initiation failure.
- Successful checkout behavior is unchanged: capacity remains reserved and the user navigates to Stripe.
- Paid registrations must never be downgraded or capacity-released by this path.

## User Impact
- Parents can retry checkout without consuming a scarce roster spot.
- Coaches and admins see accurate capacity during high-volume registration windows.
- Program managers avoid phantom enrollments caused by Stripe/network failures.

## Non-Goals
- No payment architecture redesign.
- No Stripe webhook behavior changes.
- No admin cleanup migration for historical orphaned records.
