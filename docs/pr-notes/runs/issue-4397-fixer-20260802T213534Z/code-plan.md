# Code plan

**Bound to HEAD:** `54bc9505593c74407a05c7c93cb38aca909b70a5`

## API and validation

Add `extractVerifiedFriendInviteRecipientIdentities(auth, HttpsError)` returning `{ uid, email, phone }`.

- Require nonempty `auth.uid` and a token object.
- Read email only from `auth.token.email`, require `email_verified === true`, normalize with trim and lowercase, and validate with `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
- Read phone only from `auth.token.phone_number`, trim it, and require `/^\+[1-9]\d{7,14}$/`.
- Exclude invalid individual claims and reject only when neither identity remains.
- Throw `new HttpsError('permission-denied', 'Unable to redeem friend invite.')` for every rejection, with no details or sensitive values.

## Apply order

1. Add focused tests against the proposed export and confirm they fail because the helper is absent.
2. Add the dependency-light CommonJS helper.
3. Run `node --test functions/test/friend-invite-redemption.test.cjs`.
4. Inspect the exact diff and commit all code, tests, and role artifacts together.

## Root cause and prevention

Friend-invite redemption lacks a reusable server-side identity boundary. For recipient-bound server mutations, derive identity exclusively from authoritative Auth claims at one tested boundary, require canonical formats, and expose one generic rejection contract before any protected data read.

**Recurrence risk:** Medium until issues #4398 and #4399 make this helper the enforced transaction and callable boundary.

## Scope conflict resolution

Firebase's standard `phone_number` claim is the verified linked-phone assertion; no standard `phone_number_verified` claim exists. Invalid optional claims are ignored when another usable verified identity exists. No invite reads, writes, friendship creation, callable registration, rules, or client changes belong in this slice.
