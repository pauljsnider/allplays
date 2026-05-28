# Architecture

- Keep eligibility local to TeamFeesComponent mapping and avoid widening the change.
- Add a small balance helper that mirrors the callable's getTeamFeeBalanceCents fallback behavior for the fields used by fee recipients.
- Continue to treat explicit balanceDueCents / remainingBalanceCents as authoritative, matching the server helper.
- Blast radius is limited to displaying/hiding the parent checkout button; checkout service behavior is unchanged.
