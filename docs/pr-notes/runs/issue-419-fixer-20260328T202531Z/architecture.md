Objective: close the coverage gap without widening the runtime blast radius.

Current state:
- `accept-invite.html` wires auth, DOM state, and invite processing inside one inline module.
- The shared invite processor already handles parent/admin branching correctly once invoked.

Proposed state:
- Test the page by executing the real inline module with stubbed imports and a lightweight mock DOM.
- Keep the runtime fix inside `accept-invite.html` as a page-scoped guard against duplicate processing for the same user/code pair.

Risk surface and blast radius:
- The new tests are isolated to one file and do not change production behavior.
- The runtime change is local to invite processing entry points and does not modify Firestore logic or shared auth utilities.

Tradeoffs:
- This is not a full browser-plus-Firebase integration test.
- It is the smallest change that verifies the page contract users depend on and guards the duplicate-auth edge case.
