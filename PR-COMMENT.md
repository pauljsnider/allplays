# 🧪 Comprehensive Testing Guide

## Summary of Changes

This PR fixes critical issues with basketball game tracking and Google authentication across 4 commits:

### ✅ Commit 1: `7a1dbf4` - Fix beta prompt for basketball games from calendar events
**Problem:** Calendar events (iCal/shared links) were bypassing the basketball tracker chooser modal
**Fix:** Added basketball detection to `trackCalendarEvent()` function
**Impact:** Calendar events now show "Standard vs Beta" modal for basketball games

### ✅ Commit 2: `399a507` - Fix Google sign-in SSL errors on restrictive networks
**Problem:** `signInWithPopup` was failing on public WiFi with SSL inspection/MITM
**Fix:** Switched to `signInWithRedirect` flow with `sessionStorage` for activation codes
**Impact:** Google sign-in now works on ALL network types (public WiFi, corporate, mobile)

### ✅ Commit 3: `372018c` - Fix race condition in Google sign-in validation
**Problem:** `checkAuth` could auto-redirect before activation code validation completed
**Fix:** Added `isProcessingAuth` flag to block redirects during validation
**Impact:** Security fix - prevents bypassing activation code requirement

### ✅ Commit 4: `1835b73` - Refactor basketball detection logic
**Problem:** Duplicate basketball detection code in two places
**Fix:** Extracted `isBasketballConfig()` helper function
**Impact:** DRY principle, easier maintenance

---

## 🎯 Critical Test Scenarios

### 1. Basketball Modal - Calendar Events (The Main Bug Fix)

<details>
<summary><b>Test 1.1: Calendar Event → Basketball Modal</b> ⭐ CRITICAL</summary>

**This was the original bug reported by the user!**

**Setup:**
- Team with basketball stat config
- Add iCal feed or shared calendar with basketball games

**Steps:**
1. Go to `edit-schedule.html`
2. Find a calendar event (shows 📅 Calendar badge)
3. Click "Track" button
4. **Expected:** Basketball tracker chooser modal appears
5. Click "Beta" → should navigate to `track-basketball.html`

**Pass Criteria:** ✅ Modal appears for calendar events (was missing before)

</details>

<details>
<summary><b>Test 1.2: Database Game → Basketball Modal</b></summary>

**Setup:**
- Create game in database with basketball config

**Steps:**
1. Go to `edit-schedule.html`
2. Click "Track" on database game
3. **Expected:** Basketball modal appears
4. Test both "Standard" and "Beta" buttons

**Pass Criteria:** ✅ Modal appears, both options work (regression test)

</details>

<details>
<summary><b>Test 1.3: Non-Basketball Games Skip Modal</b></summary>

**Setup:**
- Soccer/baseball team or non-basketball config

**Steps:**
1. Track a non-basketball game
2. **Expected:** Goes directly to `track.html` (no modal)

**Pass Criteria:** ✅ Non-basketball games unaffected

</details>

---

### 2. Google Sign-In - Network Compatibility (SSL Fix)

<details>
<summary><b>Test 2.1: Public WiFi / Restrictive Network</b> ⭐ CRITICAL</summary>

**This addresses the SSL error the user reported!**

**Setup:**
- Connect to public WiFi (Starbucks, airport, hotel)
- OR use iOS Safari
- OR use corporate network with SSL inspection

**Steps:**
1. Go to `login.html`
2. Click "Continue with Google"
3. **Expected:** Page redirects to Google (NOT popup)
4. Sign in with Google
5. **Expected:** Redirect back to app, no SSL errors

**Previous Behavior:** `ERR_SSL_PROTOCOL_ERROR` or `auth/popup-closed-by-user`
**New Behavior:** ✅ Works smoothly via redirect

</details>

<details>
<summary><b>Test 2.2: iOS Safari / Mobile</b></summary>

**Steps:**
1. Open app on iPhone/iPad with Safari
2. Click "Continue with Google"
3. **Expected:** Redirect flow (popups often blocked on iOS)
4. Complete sign-in
5. **Expected:** Returns to app successfully

**Pass Criteria:** ✅ Works on iOS (popup blockers bypassed)

</details>

<details>
<summary><b>Test 2.3: Cellular Data</b></summary>

**Steps:**
1. Use mobile device on cellular (no WiFi)
2. Google sign-in
3. **Expected:** Works (regression test)

**Pass Criteria:** ✅ Still works on unrestricted networks

</details>

---

### 3. Security - Activation Code Validation

<details>
<summary><b>Test 3.1: New User WITHOUT Activation Code (Login Mode)</b> ⭐ SECURITY</summary>

**Setup:**
- New Google account (not in system)
- Login page in LOGIN mode (not Sign Up)

**Steps:**
1. Go to `login.html` (stay in Login mode)
2. Click "Continue with Google"
3. Sign in with new Google account
4. **Expected:** User account DELETED, error: "Activation code is required"

**Pass Criteria:** ✅ New users cannot bypass activation requirement

</details>

<details>
<summary><b>Test 3.2: New User WITH Valid Activation Code</b></summary>

**Setup:**
- Valid activation code
- New Google account

**Steps:**
1. Click "Sign Up" on login page
2. Enter activation code
3. Click "Continue with Google"
4. Sign in with Google
5. **Expected:** Account created, redirects to dashboard

**Pass Criteria:** ✅ Valid codes work correctly

</details>

<details>
<summary><b>Test 3.3: Race Condition Prevention</b> ⭐ SECURITY</summary>

**Testing the fix for the race condition identified by code review**

**Steps:**
1. Sign Up mode with activation code
2. Click Google button → redirect to Google
3. Sign in and return to app
4. **Watch carefully:** Should NOT flash/redirect before validation
5. **Expected:** Validates code BEFORE any auto-redirect happens

**Pass Criteria:** ✅ No premature redirects, validation completes atomically

</details>

<details>
<summary><b>Test 3.4: SessionStorage Persistence</b></summary>

**Steps:**
1. Sign Up mode, enter code "TEST1234"
2. Click Google button (before redirect, open DevTools)
3. Check Application → Session Storage
4. **Expected:** `pendingActivationCode` = "TEST1234"
5. Complete sign-in flow
6. **Expected:** Key is removed after validation

**Pass Criteria:** ✅ Code persists across redirect, cleaned up after use

</details>

---

### 4. Regression Testing

<details>
<summary><b>Test 4.1: Email/Password Login</b></summary>

**Steps:**
1. Login with email/password
2. **Expected:** Works unchanged

</details>

<details>
<summary><b>Test 4.2: Email/Password Signup</b></summary>

**Steps:**
1. Sign up with email/password + activation code
2. **Expected:** Works unchanged

</details>

<details>
<summary><b>Test 4.3: Existing Google Users</b></summary>

**Steps:**
1. Sign in with existing Google account
2. **Expected:** No activation code required, works normally

</details>

<details>
<summary><b>Test 4.4: Forgot Password</b></summary>

**Steps:**
1. Click "Forgot Password", enter email
2. **Expected:** Reset email sent

</details>

---

## 🤖 Automated Test Suite

I've created automated tests to validate the core logic:

**Run tests:**
```bash
python3 -m http.server 8004
# Open: http://127.0.0.1:8004/test-pr-changes.html
```

**Test Coverage:**
- ✅ Basketball detection with config (10 tests)
- ✅ Session storage persistence (3 tests)
- ✅ Edge cases: null/undefined handling (7 tests)
- **Total: 20 automated tests**

**Expected Result:** All tests pass ✅

---

## 🔍 Code Quality Checks

- [x] **No code duplication** - Basketball logic extracted to `isBasketballConfig()`
- [x] **Null safety** - All functions handle null/undefined gracefully
- [x] **Security** - sessionStorage (not localStorage) for sensitive data
- [x] **Race condition fixed** - `isProcessingAuth` flag prevents premature redirects
- [x] **Comments added** - Explains WHY redirect is used instead of popup
- [x] **Backward compatible** - All existing flows unchanged
- [x] **Mobile friendly** - Redirect works better than popup on mobile

---

## 📋 Manual Testing Checklist

**Tester:** _______________
**Date:** _______________
**Environment:** Desktop ☐ / Mobile ☐ / Both ☐

### Basketball Modal Tests
- [ ] Calendar event → Basketball game → Modal appears ⭐
- [ ] Database game → Basketball game → Modal appears
- [ ] Soccer/other sport → No modal, goes to track.html
- [ ] Team sport fallback works (no config)
- [ ] Config overrides team sport

### Google Auth Tests
- [ ] Public WiFi → No SSL errors ⭐
- [ ] iOS Safari → Redirect works, no popup errors ⭐
- [ ] New user without code → Rejected ⭐
- [ ] New user with valid code → Account created
- [ ] New user with invalid code → Rejected
- [ ] Existing user → Works normally (no code required)
- [ ] Race condition prevented (no premature redirect) ⭐

### Regression Tests
- [ ] Email/password login works
- [ ] Email/password signup works
- [ ] Forgot password works
- [ ] Non-basketball games work
- [ ] Email verification flow works

### Network Conditions
- [ ] Cellular data works
- [ ] Public WiFi works (Starbucks, airport, etc.)
- [ ] Corporate network works
- [ ] Home WiFi works

---

## ✅ Testing Sign-Off

**Results:**
- [ ] All critical tests passed (marked with ⭐)
- [ ] Automated tests: ___/20 passed
- [ ] Manual tests completed: ___/15
- [ ] No regressions found
- [ ] Ready to merge

**Notes:**
```
______________________________________________________
______________________________________________________
______________________________________________________
```

---

## 🐛 Issues Found During Testing

_If any issues are found, document them here:_

| Issue | Severity | Steps to Reproduce | Status |
|-------|----------|-------------------|--------|
|       |          |                   |        |

---

## 📚 Documentation

- Full testing guide: `PR-TESTING-GUIDE.md`
- Automated tests: `test-pr-changes.html`
- Original issues fixed:
  - Beta prompt missing for calendar events
  - SSL errors on public WiFi
  - Race condition security issue
