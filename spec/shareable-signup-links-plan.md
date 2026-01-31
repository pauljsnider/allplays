# Shareable Signup Links

## Overview
Two changes: (1) `login.html` reads `?code=` from URL and auto-fills signup, (2) "Copy Signup Link" buttons added next to existing "Copy Code" buttons.

## Files to Modify

### 1. `login.html`
**Goal:** If URL contains `?code=XXXXXXXX`, auto-switch to signup mode with code pre-filled.

- After the Google redirect handler IIFE (line ~142), add a new IIFE that:
  - Reads `code` from `URLSearchParams(window.location.search)`
  - If present and 8 chars: programmatically clicks `#toggle-btn` to switch to signup mode
  - Sets `#activation-code` value to the code (uppercased), marks it `readOnly`, adds gray background styling
  - Inserts a friendly invite banner **above the form title** (`#form-title`) inside `.bg-white.p-8`:
    - Green-tinted box: "You've been invited to ALL PLAYS!" + "Your activation code has been applied. Just create your account below."
  - Hides the activation code field entirely since the code is auto-applied (cleaner UX than showing a locked field)
  - Updates the help text under the toggle to say "Already have an account? Login" stays visible

- If no `?code=` param: zero changes to existing behavior.

### 2. `profile.html`
**Goal:** Add "Copy Signup Link" button next to existing "Copy Code" in two places.

**Newly generated code display (lines 298-310):**
- After the existing `#copy-code-btn` button, add a second button `#copy-link-btn` styled indigo (to differentiate from the green "Copy Code") with a link icon and text "Copy Signup Link"

**Historical codes list (lines 426-492, the `.map()`):**
- After each existing `copyHistoryCode` button, add a `copyHistoryLink` button (indigo, smaller, "Copy Link")
- Only show the "Copy Link" button for **unused** codes (no point sharing a used code's link)

**JavaScript (after line 603):**
- Add `copySignupLink(code)` helper: builds `${window.location.origin}/login.html?code=${code}` and copies to clipboard
- Add click handler for `#copy-link-btn` (newly generated code)
- Add global `window.copyHistoryLink` function (for historical codes)
- All copy buttons show "Copied!" feedback for 2 seconds

### 3. `edit-roster.html`
**Goal:** Add "Copy Signup Link" below code display in all 3 invite modal states.

**Email sent fallback (lines 252-259):**
- After the code copy row, add a full-width "Copy Signup Link" button (`#copy-fallback-link-btn`)

**Existing user code (lines 283-291):**
- After the code copy row, add "Copy Signup Link" button (`#copy-existing-link-btn`)
- Update text from "They can enter this code at allplays.ai/accept-invite.html" to "Or share this direct signup link:"

**Manual code (lines 305-312):**
- After the code copy row, add "Copy Signup Link" button (`#copy-manual-link-btn`)
- Update text from "They can use this code to sign up at allplays.ai" to "Or share a direct signup link:"

**JavaScript (after line 619):**
- Add `copySignupLink(code)` helper (same pattern as profile.html)
- Add `setupCopyLinkButton(buttonId, codeId)` helper alongside existing `setupCopyButton`
- Wire up all 3 new buttons: `copy-fallback-link-btn`, `copy-existing-link-btn`, `copy-manual-link-btn`

## UX Details

**Invite banner on login.html:**
- Rounded box with green background, checkmark icon
- "You've been invited to ALL PLAYS!" as heading
- "Your activation code has been applied. Just create your account below." as body
- Code field hidden (already applied) to keep the form clean and focused

**Copy Signup Link buttons:**
- Indigo colored (distinct from green "Copy Code" buttons)
- Link icon (chain link SVG)
- "Copied!" feedback with checkmark for 2 seconds
- URL uses `window.location.origin` so it works in local dev and production

## Verification
1. Open `login.html` — confirm normal login/signup works unchanged
2. Open `login.html?code=TESTTEST` — confirm it auto-switches to signup, shows banner, hides code field
3. On `profile.html`, generate a code — confirm "Copy Signup Link" appears next to "Copy Code"
4. Click "Copy Signup Link" — paste into browser, confirm it loads login.html with code pre-filled
5. On `edit-roster.html`, trigger parent invite — confirm "Copy Signup Link" button in modal
6. Verify historical codes only show "Copy Link" for unused codes
