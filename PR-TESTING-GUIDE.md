# Testing Guide for PR: Fix Beta Game Prompt & Google Auth Issues

## Overview
This PR includes 4 commits that fix critical issues with basketball game tracking and Google authentication:
1. **7a1dbf4** - Fix beta prompt for basketball games from calendar events
2. **399a507** - Fix Google sign-in SSL errors on restrictive networks
3. **372018c** - Fix race condition in Google sign-in validation
4. **1835b73** - Refactor basketball detection logic

---

## 🎯 Critical Test Areas

### 1. Basketball Tracker Selection Modal

#### Test 1.1: Database Games - Basketball Config
**Setup:**
- Create a team with sport = "Basketball"
- Add a basketball stat tracker config
- Create a game with that config assigned

**Steps:**
1. Go to edit-schedule.html for the team
2. Click "Track" on the game
3. **Expected:** Basketball tracker chooser modal appears with "Standard" and "Beta" options
4. Click "Standard" → should go to `track.html`
5. Repeat and click "Beta" → should go to `track-basketball.html`
6. Click "Cancel" → modal should close

**Pass Criteria:** ✅ Modal appears, both options work correctly

---

#### Test 1.2: Calendar Events - Basketball Game
**Setup:**
- Team with basketball stat config selected
- Add an iCal feed with basketball games
- OR import a shared calendar link with games

**Steps:**
1. Go to edit-schedule.html
2. Find a calendar event (shows 📅 Calendar badge)
3. Click "Track" on the calendar event
4. **Expected:** Game is created, basketball tracker chooser modal appears
5. Choose "Beta" → should go to `track-basketball.html` with new game

**Pass Criteria:** ✅ Calendar events now show the modal (this was the bug!)

---

#### Test 1.3: Non-Basketball Games
**Setup:**
- Create a team with sport = "Soccer" or other non-basketball
- Create a game with soccer config (or no config)

**Steps:**
1. Go to edit-schedule.html
2. Click "Track" on the game
3. **Expected:** NO modal appears, goes directly to `track.html`

**Pass Criteria:** ✅ Non-basketball games skip modal

---

#### Test 1.4: Basketball Detection Edge Cases

**Test Case A: Team sport fallback**
- Team sport = "Basketball"
- Game with no statTrackerConfigId
- **Expected:** Modal appears (falls back to team sport)

**Test Case B: Config overrides team**
- Team sport = "Soccer"
- Game with basketball config
- **Expected:** Modal appears (config takes precedence)

**Test Case C: Case insensitivity**
- Config with baseType = "BASKETBALL" (uppercase)
- **Expected:** Detected as basketball

**Test Case D: Sport name contains basketball**
- Team sport = "Youth Basketball League"
- No config on game
- **Expected:** Detected as basketball (uses .includes())

---

### 2. Google Sign-In (Redirect Flow)

#### Test 2.1: Existing User Login
**Setup:**
- Existing Google-authenticated user in the system

**Steps:**
1. Sign out if signed in
2. Go to login.html
3. Click "Continue with Google"
4. **Expected:** Redirect to Google sign-in page
5. Sign in with existing Google account
6. **Expected:** Redirect back to login.html, then auto-redirect to dashboard

**Pass Criteria:** ✅ Smooth redirect flow, no errors, lands on correct dashboard

---

#### Test 2.2: New User Signup (Login Mode - Should Fail)
**Setup:**
- Google account NOT in the system
- In LOGIN mode (not signup mode)

**Steps:**
1. Go to login.html (stay in Login mode, don't click "Sign Up")
2. Click "Continue with Google"
3. Sign in with new Google account
4. **Expected:** User account is DELETED, error message: "Activation code is required for new accounts"

**Pass Criteria:** ✅ New user cannot sign in without activation code

---

#### Test 2.3: New User Signup (Signup Mode - With Code)
**Setup:**
- Valid activation code
- Google account NOT in the system

**Steps:**
1. Go to login.html
2. Click "Sign Up" to switch to signup mode
3. Enter activation code in the field
4. Click "Continue with Google"
5. Sign in with new Google account
6. **Expected:** User account created, profile populated, redirect to dashboard

**Pass Criteria:** ✅ New user can sign up with valid activation code

---

#### Test 2.4: New User Signup (Signup Mode - Invalid Code)
**Setup:**
- Invalid/used activation code
- Google account NOT in the system

**Steps:**
1. Go to login.html → click "Sign Up"
2. Enter invalid activation code
3. Click "Continue with Google"
4. Sign in with new Google account
5. **Expected:** User account DELETED, error message about invalid code

**Pass Criteria:** ✅ Invalid activation codes are rejected

---

#### Test 2.5: Race Condition Prevention
**Setup:**
- Valid activation code
- New Google account

**Steps:**
1. Go to login.html → Sign Up mode
2. Enter activation code
3. Click "Continue with Google"
4. Sign in with Google
5. **Expected:** Page loads, validates activation code BEFORE any auto-redirect
6. Should not flash/redirect to dashboard before validation completes

**Pass Criteria:** ✅ No premature redirects, validation completes first

---

### 3. Network Conditions Testing

#### Test 3.1: Public WiFi (SSL Inspection)
**Setup:**
- Connect to public WiFi (Starbucks, airport, hotel, etc.)
- iOS device or restrictive network

**Steps:**
1. Go to login.html
2. Click "Continue with Google"
3. **Expected:** Redirect to Google (NOT popup error)
4. Complete sign-in
5. **Expected:** Redirect back successfully

**Pass Criteria:** ✅ No SSL errors, no "popup closed" errors

---

#### Test 3.2: Mobile Safari / iOS
**Setup:**
- iOS device with Safari
- Any network (cellular or WiFi)

**Steps:**
1. Go to login.html
2. Click "Continue with Google"
3. **Expected:** Page redirects (not popup)
4. Google sign-in page loads
5. Sign in
6. **Expected:** Returns to app successfully

**Pass Criteria:** ✅ Works on iOS Safari (popups often blocked)

---

#### Test 3.3: Firewall/Corporate Network
**Setup:**
- Corporate network with firewall
- Popup blockers enabled

**Steps:**
1. Attempt Google sign-in
2. **Expected:** Redirect flow works even with popup blockers

**Pass Criteria:** ✅ Bypasses popup blockers

---

### 4. Session Storage Persistence

#### Test 4.1: Activation Code Survives Redirect
**Steps:**
1. Login page → Sign Up mode
2. Enter activation code "TEST1234"
3. Click Google button (redirects to Google)
4. Open browser DevTools → Application → Session Storage
5. **Expected:** Key "pendingActivationCode" = "TEST1234"
6. Complete Google sign-in
7. After redirect back, check sessionStorage again
8. **Expected:** Key is removed after validation

**Pass Criteria:** ✅ Code persists during redirect, cleared after use

---

### 5. Regression Testing

#### Test 5.1: Email/Password Login Still Works
**Steps:**
1. Login with email/password
2. **Expected:** Works as before, no changes

---

#### Test 5.2: Email/Password Signup Still Works
**Steps:**
1. Sign up with email/password + activation code
2. **Expected:** Works as before

---

#### Test 5.3: Forgot Password Still Works
**Steps:**
1. Click "Forgot Password"
2. Enter email
3. **Expected:** Reset email sent

---

#### Test 5.4: Non-Basketball Tracking Unchanged
**Steps:**
1. Track a soccer/baseball/other sport game
2. **Expected:** Goes directly to track.html (no modal)

---

#### Test 5.5: Existing Google Users Unaffected
**Steps:**
1. Sign in with existing Google account
2. **Expected:** No activation code required, works normally

---

### 6. Integration Testing

#### Test 6.1: Full Calendar Event → Track → Save Flow
**Steps:**
1. Add calendar feed with basketball games
2. Track a calendar game → choose "Beta" tracker
3. Track the game (add stats)
4. Finish and save
5. **Expected:** Game saves to Firestore, email recap sent

---

#### Test 6.2: Parent Invite Flow with Google
**Setup:**
- Parent invite code

**Steps:**
1. Use invite link
2. Sign in with Google (new account)
3. **Expected:** Account linked to parent role

---

## 🔍 Code Review Checklist

- [x] Basketball detection logic is DRY (no duplication)
- [x] isBasketballConfig() handles null/undefined gracefully
- [x] sessionStorage used (not localStorage) for security
- [x] Race condition prevented with isProcessingAuth flag
- [x] Error messages are user-friendly
- [x] All auth flows preserve existing functionality
- [x] Comments explain why (redirect vs popup)

---

## 📊 Automated Tests

Run the test suite:
```bash
# Open in browser
open test-pr-changes.html
# Or serve with:
python3 -m http.server 8004
# Then visit: http://127.0.0.1:8004/test-pr-changes.html
```

**Expected Results:**
- ✅ All tests pass (20/20)
- Basketball detection logic: 10 tests
- Session storage: 3 tests
- Edge cases: 7 tests

---

## 🐛 Known Issues / Future Improvements

None identified. All changes are backward compatible.

---

## ✅ Sign-Off

**Tested By:** _____________
**Date:** _____________
**Environment:** Desktop / Mobile / Both
**Network:** Cellular / WiFi / Public WiFi / Corporate

**Results:**
- [ ] All basketball modal tests passed
- [ ] All Google auth tests passed
- [ ] Network condition tests passed
- [ ] Regression tests passed
- [ ] No issues found

**Notes:**
_______________________________________
_______________________________________
