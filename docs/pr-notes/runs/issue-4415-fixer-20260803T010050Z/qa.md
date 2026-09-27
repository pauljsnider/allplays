# QA Strategy

Evidence baseline: `76ec5df958796c2724be0282a94d09d86e515f38`.

## Prevention gap

Existing tests exercise helpers and the transaction directly, so they cannot detect missing callable registration or unsafe forwarding at the request/Auth boundary.

## Focused regressions

- Missing auth and identity-less auth reject generically and never invoke the transaction.
- Verified mixed-case email is normalized; canonical phone is forwarded; both can be forwarded together.
- Conflicting payload UID, email, phone, recipient identities, profile, and fallback values are ignored. Deep equality proves the transaction receives only code plus Auth-derived identities.
- Payload-only identity cannot authorize redemption.
- Authentication failures, semantic transaction rejections, and unexpected failures expose identical code/message/no-details responses with no sensitive serialized values.
- Successful invocation returns the transaction result unchanged.

Smallest validation: `node --test functions/test/friend-invite-redemption.test.cjs`.
