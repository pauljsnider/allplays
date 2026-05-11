# Requirements notes

- Household invite redemption must not leave user, player, membership, or access-code state inconsistent when any post-claim write fails.
- A household invite with an invited email must only be redeemable by the signed-in user with the matching email, including a post-claim validation before side effects.
- Concurrent redemption attempts must be limited by the existing transactional code claim and must re-check invite email after the claim path.
- Accept-invite processing must convert household invite redemption failures into user-friendly errors for common cases: missing team/player, permission denied, network/unavailable, and invalid/expired/used invite.
