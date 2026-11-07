# Requirements analysis

The app service must expose the authenticated parent's submitted registration applications without changing the legacy query or rendering them yet. The loader should use the auth UID for submitter matching and include the email only when Auth reports it as verified.

The returned contract must preserve every normalized legacy application field, both pagination cursors, `hasMore`, and structured retryable errors. Partial query or enrichment failures must not discard successful applications.

Out of scope: UI changes, status mutations, Firestore rules or index changes, and legacy query changes.

Root cause: the application-history capability exists only behind the legacy database module; the React adapter and focused registration service never exposed its contract.
