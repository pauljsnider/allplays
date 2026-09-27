# Risk Matrix

- High: poisoned stored metadata can currently bypass the server and reach share or clipboard APIs.
- High: an invalid server response can currently reach the same external boundaries.
- Medium: local active-link reuse bypasses current server eligibility and reuse decisions.
- Low: validation failure must clear busy state and preserve retry.

# Automated Tests To Add/Update

- Poisoned open stored URL plus valid regenerated server URL for share.
- Poisoned open stored URL plus valid regenerated server URL for copy.
- Valid stored and server-reused canonical URL, proving the server is still called.
- Invalid server destinations for share and copy, proving both public-action mocks remain untouched.
- Existing no-link generation happy path updated to the production canonical hostname.

# Manual Test Plan

- Verify staff share and copy for a new checkout and an existing open checkout.
- Verify a service failure shows an inline error and allows retry.
- Verify web clipboard fallback and native share use only `https://checkout.stripe.com/...` when preview infrastructure is available.

# Negative Tests

- Non-Stripe HTTPS host.
- Stripe lookalike host.
- HTTP Stripe URL.
- Credential-bearing URL.
- Missing or malformed URL.
- Server rejection or timeout.

# Release Gates

- `npm run test:app -- src/pages/TeamFees.test.tsx`
- `npm run app:build`
- Diff review confirms no stored checkout destination reaches share or clipboard directly.

# Post-Deploy Checks

- Confirm each staff action invokes the checkout operation before external sharing or copying.
- Confirm new and reused production destinations use `https://checkout.stripe.com/...`.
- Monitor validation rejections without logging full checkout URLs or session tokens.
