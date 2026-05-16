# QA notes

## Automated validation
Run focused unit coverage for payment settings and registration flow:

```bash
npx vitest run tests/unit/admin-registration-forms.test.js tests/unit/registration-flow.test.js --reporter=dot
```

Run Firestore rules validation when available:

```bash
npm run ci:firebase-rules
```

## Manual validation
1. Admin creates/edits registration forms with offline payment on/off and online checkout on/off.
2. Public form shows correct copy for offline-only, online-planned-only, both, and neither.
3. Submission stores only normalized payment settings in the registration snapshot.
4. UI does not imply live online payment processing is currently available.
