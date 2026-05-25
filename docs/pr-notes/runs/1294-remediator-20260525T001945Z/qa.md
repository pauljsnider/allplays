# QA

Plan:

1. Add unit coverage for zero-padded expanded IPv4-mapped IPv6 private addresses.
2. Add unit coverage for zero-padded expanded public mapped IPv4 addresses to avoid overblocking.
3. Add SSRF/security utility coverage proving `assertPublicHost` rejects a direct zero-padded expanded mapped loopback address.
4. Run targeted tests for the affected unit file and the functions SSRF test.

Commands:

```bash
npx vitest run tests/unit/is-private-ip-address.test.js --reporter=verbose
node --test functions/test/ssrf.test.js
```
