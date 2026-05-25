# Architecture

Decision: keep the patch local and minimal. Update `getIpv4MappedAddress` in both current validators so it recognizes expanded IPv4-mapped IPv6 addresses structurally, including zero-padded zero hextets, then delegates classification to the existing IPv4 private-address logic.

The helper accepts:
- `::ffff:<ipv4>` and `::ffff:<hex>:<hex>`
- `0:0:0:0:0:ffff:<ipv4>` and zero-padded equivalents
- `0000:0000:0000:0000:0000:ffff:<hex>:<hex>`

Risk: duplicated validator logic can drift. Mitigation in this scoped remediation is identical targeted changes and tests in both affected test tiers. A larger shared-helper refactor is intentionally out of scope for this review fix.
