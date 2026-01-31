# Shareable Signup Links - Implementation Progress

## Tasks
- [x] 1. login.html — Read ?code= from URL, auto-switch to signup, show invite banner
- [x] 2. profile.html — Add "Copy Signup Link" buttons (new code + historical codes)
- [x] 3. edit-roster.html — Add "Copy Signup Link" buttons (all 3 invite modal states)
- [x] 4. All implementations complete

## Status: COMPLETE

## Changes Made

### login.html (lines 144-178)
- Added URL param check: reads `?code=XXXXXXXX` on page load
- Auto-switches to signup mode (sets isLogin=false, shows confirm password, hides forgot password)
- Pre-fills activation code input (hidden from user — auto-applied)
- Inserts green invite banner: "You've been invited to ALL PLAYS!"
- No changes to existing flow when no `?code=` param present

### profile.html
- Added "Copy Signup Link" button (indigo, with link icon) next to "Copy Code" in generated code display
- Added "Copy Link" button to historical codes list (only shown for unused/active codes)
- Added `copySignupLink` click handler for new code display
- Added global `window.copyHistoryLink` function for historical codes
- All buttons show "Copied Link!" feedback for 2 seconds

### edit-roster.html
- Added "Copy Signup Link" button to email-sent fallback state
- Added "Copy Signup Link" button to existing-user state
- Added "Copy Signup Link" button to manual-code state (with "Or share a direct signup link:" text)
- Added `setupCopyLinkButton` helper function + wired up all 3 buttons
- All buttons show "Copied Link!" feedback for 2 seconds

## Link Format
`${window.location.origin}/login.html?code=XXXXXXXX`
- Works in local dev (http://localhost:8000)
- Works in production (https://allplays.ai)
