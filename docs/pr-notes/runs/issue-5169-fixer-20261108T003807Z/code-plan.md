# Code plan

## Adapter

- Import `removeFamilyMember as legacy_removeFamilyMember` from `@legacy/family-plan.js`.
- Re-export it beside the existing household bindings.

## Service

- Import the adapter binding.
- Export `revokeParentHouseholdMemberAccess(user, membershipId)`.
- Validate auth and a trimmed nonempty membership ID before delegation.
- Return the adapter promise without translating failures.

## Tests

- Extend the hoisted adapter mock.
- Cover successful delegation/result, invalid ID shapes with no call, and unchanged failure propagation.
- Keep UI, backend, smoke, and cache-bust files untouched.
