# Architecture Review

## Current and proposed state

Current state derives family invite identity from `context.auth.token?.email || data?.authEmail`, allowing caller data to authorize durable parent access. Proposed state introduces a dependency-injected CommonJS resolver that accepts only authenticated context and Admin Auth `getUser`, prefers the normalized token email, and falls back to the Auth user record.

Resolve identity once outside the Firestore transaction to avoid external calls during transaction retries. Compare it with the latest invite email inside each transaction before the first mutation, preserving race safety and the zero-write denial guarantee.

## Blast radius and failure behavior

The security blast radius contracts from any authenticated UID able to assert an email to the Auth identity bound to that UID. Missing or mismatched authoritative email fails with `permission-denied`; Auth lookup infrastructure failures propagate safely before the transaction. Email-less invites and all success response fields remain unchanged.

Remove `authEmail` from the three `js/db.js` callable payloads while retaining public function signatures. React and Capacitor already share this adapter. Because `js/db.js` is cache-critical, bump affected runtime importers and validate the cache-bust guard.

## Verification

Unit-test token precedence, Admin Auth fallback, normalization, missing email, lookup failure, and ignored request/profile inputs. Add three-handler source contracts proving resolver use, no request fallback, and denial before mutation. Run the focused Vitest files and cache-bust guard.
