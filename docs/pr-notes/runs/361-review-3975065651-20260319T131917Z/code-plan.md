Chosen thinking level: low
Reason: the review identifies a single localized sequencing concern in a test, and the smallest safe fix is explicit waiter registration before the click.

Implementation:
1. Replace the homepage `Promise.all([...])` navigation wait with a named `navigationPromise`.
2. Keep all existing destination assertions and shared-footer coverage unchanged.
3. Record role summaries for PR traceability under the run-scoped notes directory.

Fallback path:
- If the reviewer wants additional hardening, switch the shared-footer coverage from `login.html` to a lower-noise public page in a follow-up change.
