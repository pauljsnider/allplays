# Account Entry and Public Team UX Requirements

Issue: #4066

## Scope

This pass covers the public account-entry and team-discovery journey: sign in, sign up, password recovery, join-code entry, public team search, and public team profiles.

## User requirements

### Account entry

- Present Sign in and Sign up as a semantic, keyboard-operable tab interface.
- Keep the selected tab, title, supporting copy, and visible fields synchronized.
- Let users reveal and hide password values without clearing them.
- Announce authentication errors and confirmations when they appear.
- Expose password recovery as an expanded/collapsed disclosure and reuse the email already entered when possible.
- Explain before submission that new accounts require a team or family join code.
- Avoid offering a redundant join-code path from a form that already requires the code.
- Preserve email/password, Google, native REST, invite, verification, and post-auth routing behavior.

### Join-code entry

- Announce invite processing, success, and failure states.
- Preserve manual code entry, pending-invite storage, email-link completion, and signed-in redemption behavior.

### Public team discovery

- Make each team-card destination a descriptive link named for the team.
- Keep search, clear, browse-all, and pagination behavior unchanged.
- Keep primary team-search actions at least 44px high or wide.
- Announce public-team loading and failure states.
- Provide Retry and Back to team search actions when a public profile fails to load.
- Return successful public profiles to `/teams/browse`, the surface where the visitor came from.
- Give visitors direct next steps to enter a join code or sign in.
- Continue loading public-safe team fields only.

## Acceptance criteria

- Authentication mode controls expose `tablist`, `tab`, `tabpanel`, selection, and panel relationships.
- Left/Right/Home/End keys switch authentication modes and move focus to the selected tab.
- Password and confirm-password controls expose Show/Hide labels and preserve typed values.
- Authentication and invite errors use alert semantics; progress and success use status/live semantics.
- Password recovery exposes `aria-expanded` and `aria-controls`, and opens with the primary email value when available.
- Invite-only sign-up guidance is explicit and the redundant Enter join code link is absent from sign-up mode.
- Public team cards use links with team-specific accessible names and 44px targets.
- Public profile loading is announced and failure offers Retry plus Back to team search.
- Public profile next actions link to join-code entry and sign in.
- Focused unit tests, a production app build, and mobile browser validation pass.
