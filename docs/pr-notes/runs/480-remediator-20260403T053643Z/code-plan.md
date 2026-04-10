Plan:
1. Update `login.html` to import `./js/login-page.js` with a bumped version token.
2. Update `createLoginAuthStateManager()` so null auth events clear `pendingRedirectUser`.
3. Add a unit test that buffers a user, receives a null auth state, finishes processing, and confirms no redirect user is replayed.
4. Run the targeted Vitest file, review diff, stage, and commit.
