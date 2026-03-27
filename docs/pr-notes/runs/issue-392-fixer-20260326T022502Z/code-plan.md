# Code role output

## Smallest viable change
1. Extract login-page redirect coordination into `js/login-page.js`.
2. Add a focused state variable that remembers whether invite redemption is allowed for the current auth redirect sequence.
3. Wire `login.html` to call the shared initializer.
4. Add unit tests for login-mode redemption, signup-mode suppression, and default authenticated invite redemption.

## Why this path
- It fixes the bug at the page behavior layer without changing auth or invite backend logic.
- It gives the repo executable coverage for a user-visible race that current helper-only tests miss.
