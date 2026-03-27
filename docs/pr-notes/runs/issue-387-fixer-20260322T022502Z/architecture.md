Current state:
- `edit-roster.html` owns Bulk AI state inline with DOM event handlers.
- Image preview reset logic exists only inside the remove-image button handler.
- Cancel and apply success paths partially duplicate reset behavior and omit image cleanup.

Proposed state:
- Introduce a small local helper for Bulk AI input reset.
- Reuse that helper from Cancel and successful Apply reset paths to keep state transitions consistent.

Controls and blast radius:
- Change remains client-side and page-local.
- No Firestore, auth, storage, or AI API contract changes.
- Test harness will mock imported modules and AI calls to isolate the page behavior.

Tradeoff:
- A helper adds one more function in the page script, but removes duplicated reset logic and keeps future reset changes in one place.
