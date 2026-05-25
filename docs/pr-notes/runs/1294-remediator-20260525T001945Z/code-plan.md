# Code Plan

1. Replace prefix-only mapped IPv6 detection in `functions/utils/security-utils.js` and `functions/utils/ip-address-validation.js` with a parser that accepts compressed mapped forms and expanded zero-padded mapped prefixes.
2. Preserve existing IPv4 conversion and delegate the embedded IPv4 back to `isPrivateIpAddress`.
3. Add regression tests in `tests/unit/is-private-ip-address.test.js` and `functions/test/ssrf.test.js`.
4. Run targeted tests and commit the scoped remediation.
