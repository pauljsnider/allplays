# Requirements

Acceptance criteria for PR #1294 remediation:

1. Zero-padded expanded IPv4-mapped IPv6 literals such as `0000:0000:0000:0000:0000:ffff:7f00:0001` are classified by their embedded IPv4 address.
2. Private, loopback, unspecified, and link-local embedded IPv4 addresses remain blocked in compressed, expanded, and zero-padded mapped forms.
3. Public embedded IPv4 addresses remain allowed.
4. Invalid IP inputs remain fail-closed.
5. `assertPublicHost` rejects direct zero-padded mapped private hosts before any fetch path is used.

Non-goals: no calendar UX changes, no fetch/redirect redesign, no broad IPv6 validator rewrite beyond mapped-address recognition.
