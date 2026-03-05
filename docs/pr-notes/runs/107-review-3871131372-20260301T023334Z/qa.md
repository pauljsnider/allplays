# QA Role - PR #107 review 3871131372

## Test Strategy
Target resolver-level regression checks for tampering scenarios and scope-preserving behavior.

## Added Coverage
- Mixed valid/invalid explicit `childIds` returns only in-scope IDs.
- Out-of-scope explicit `childId` returns empty list.
- Existing explicit valid ID and fallback scoped selection behavior remain intact.

## Validation Commands
- `node --input-type=module <<'EOF' ...resolver assertions... EOF`

## Residual Risk
No server-side guard in `submitRsvp`; this fix hardens client behavior but does not prevent malicious direct Firestore writes by privileged clients. Firebase rules remain primary boundary.
