# Requirements Role Notes

## Objective
Prevent stale `pendingActivationCode` values from persisting after Google redirect sign-up failures so later auth attempts cannot reuse an unintended code.

## Current State
`pendingActivationCode` is set before hybrid Google auth starts. Cleanup on failure is reliable in popup-only failure handling, but redirect processing errors can bypass that path.

## Proposed State
Guarantee cleanup in redirect result processing so any redirect-based success/failure consumes and clears pending activation state.

## Risk Surface / Blast Radius
- Surface: `js/auth.js` Google OAuth redirect flow only.
- Blast radius: login/signup auth UX only; no Firestore schema/rules changes.

## Assumptions
- Redirect flow must preserve activation code until `getRedirectResult` returns and signup logic runs.
- Clearing activation code after redirect result handling is safe for both new and existing users.

## Recommendation
Use a redirect-handler `finally` cleanup around result processing to make cleanup path-independent.
