# Problem Statement

ALL PLAYS lacks one authoritative gate for moving `allplays.ai` from GitHub
Pages to Firebase Hosting. Operators need a repeatable cutover and rollback
procedure that preserves the existing security controls.

# User Segments Impacted

- Release and DNS operators need explicit go/no-go, rollback, and evidence gates.
- Coaches and parents need authenticated access to survive the origin change.
- Public visitors and scoreboard consumers need stable routes, runtime config,
  TLS, and response headers.

# Acceptance Criteria

1. Name `https://game-flow-c6311.web.app` as the candidate origin and the
   pre-cutover GitHub Pages deployment as the rollback target.
2. Require successful public, response-header, and authenticated candidate
   smoke evidence before DNS changes.
3. Keep every Firebase API **Unenforced** in App Check during candidate
   validation and cutover observation.
4. Validate authoritative DNS, at least two public recursive resolvers, TTL
   convergence, and A, AAAA, or CNAME values for `allplays.ai` and
   `www.allplays.ai`.
5. Validate the TLS trust chain, hostname/SAN coverage, validity period, and
   HTTPS behavior without certificate bypasses.
6. Provide ordered rollback steps that restore the exact captured GitHub Pages
   DNS record set and verify DNS, TLS, public smoke, and authenticated smoke.
7. Require objective DNS, TLS, header, smoke, monitoring, and approval evidence
   before removing the temporary meta CSP bridge.

# Non-Goals

- Executing DNS changes or a production cutover.
- Removing GitHub Pages or the meta CSP bridge.
- Changing hosting configuration.
- Enabling App Check enforcement.

# Edge Cases

- Apex and `www` records converge at different times.
- IPv4 converges while stale IPv6 continues to reach the old origin.
- TLS is ready for one canonical hostname but not the other.
- Public routes pass while authenticated navigation fails.
- A smoke test is skipped because credentials are unavailable.
- Rollback DNS is authoritative but remains stale in recursive caches.

# Open Questions

- The operator must capture the actual pre-cutover provider export because it is
  the rollback source of truth.
- The change record must name the cutover owner, rollback owner, DNS operator,
  and evidence location.
- The operator must select two independent networks or external probes for TLS
  validation.
