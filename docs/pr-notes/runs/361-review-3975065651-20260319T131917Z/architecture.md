Objective: keep the smoke guard at the browser boundary while tightening the sequencing around homepage navigation.

Current state:
- The smoke test validates live footer support destinations on `/` and `/login.html`.
- Navigation to `help.html` is asserted in the homepage case.

Proposed state:
- Convert the homepage navigation assertion to a two-step sequence:
  1. create the `waitForURL('**/help.html')` promise
  2. click the Help Center link and await the already-registered waiter

Blast radius:
- Single test file plus run-note artifacts.

Controls and equivalence:
- Coverage stays at the user-visible DOM/navigation layer.
- No change to destination URLs, selectors, or workflow commands.
- Control is stronger because the waiter registration is explicit.

Rollback:
- Revert the single test hunk if the reviewer later prefers a different navigation assertion pattern.
