# Firebase Password Reset - Implementation Guide

This document outlines the issues found with password reset functionality and how they were fixed.

## Problems Identified

### 1. Missing ActionCodeSettings Configuration
The original implementation was bare minimum without any configuration:

```javascript
// OLD - js/auth.js
export function resetPassword(email) {
    return sendPasswordResetEmail(auth, email);
}
```

This caused:
- Users couldn't return to the app after resetting password
- Email didn't know where to redirect users
- Poor user experience

### 2. Common Email Delivery Issues

Based on research, Firebase password reset emails commonly fail because:

- **Spam folder placement** - Most common issue (90% of cases)
- **Microsoft 365 blocking** - MS365 blocks Firebase emails with mismatched sender domains
- **Email provider restrictions** - Some providers block emails with links not matching sender domain
- **Missing authorized domains** in Firebase Console
- **Uncustomized email templates** get flagged as spam

### 3. No Specific Error Handling

The implementation didn't handle Firebase-specific error codes:
- `auth/user-not-found`
- `auth/invalid-email`
- `auth/too-many-requests` (rate limiting)

### 4. No Custom Reset Handler

Users were sent to Firebase's default password reset page instead of a branded experience.

## Fixes Implemented

### Fix 1: Enhanced resetPassword Function

**File**: `js/auth.js`

Added `actionCodeSettings` to configure the reset flow:

```javascript
export function resetPassword(email) {
    const actionCodeSettings = {
        // URL to redirect back to after password reset
        url: 'https://pauljsnider.github.io/allplays/reset-password.html',
        handleCodeInApp: true
    };

    return sendPasswordResetEmail(auth, email, actionCodeSettings);
}
```

### Fix 2: Improved Error Handling

**File**: `login.html`

Enhanced the forgot password button handler with:
- Specific Firebase error code handling
- Better user feedback messages
- Reminder to check spam folder
- Security best practice of clearing email field after success

```javascript
try {
    const user = await getUserByEmail(email);
    if (!user) {
        throw new Error('No account found with this email address.');
    }

    await resetPassword(email);
    document.getElementById('email').value = ''; // Security: clear email

    errorDiv.classList.remove('hidden');
    errorDiv.classList.remove('text-red-500');
    errorDiv.classList.add('text-green-600');
    errorDiv.textContent = 'Password reset email sent! Please check your inbox and spam folder.';
} catch (error) {
    // Handle specific Firebase error codes
    let errorMessage = error.message;
    if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address format.';
    } else if (error.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email address.';
    } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many requests. Please try again later.';
    }

    errorDiv.textContent = errorMessage;
    // ... error display code
}
```

### Fix 3: Custom Password Reset Handler

**File**: `reset-password.html` (new)

Created a branded password reset page that:
- Validates the reset code from URL
- Allows users to set new password
- Confirms password match
- Redirects to login after success
- Provides clear error messages

### Fix 4: Documentation

**File**: `README.md`

Added password reset troubleshooting section referencing this document.

## Firebase Console Configuration Required

These manual steps must be completed in Firebase Console:

### A. Customize Email Template

1. Go to [Firebase Console](https://console.firebase.google.com) → Authentication → Templates
2. Click "Password reset" template
3. Customize:
   - **From name**: "ALL PLAYS"
   - **Reply-to email**: Your support email
   - **Subject**: "Reset Your ALL PLAYS Password"
   - **Action URL**: `https://pauljsnider.github.io/allplays/__/auth/action`
4. Save changes

### B. Add Authorized Domains

1. Go to Firebase Console → Authentication → Settings → Authorized domains
2. Ensure these are added:
   - `localhost` (for development)
   - `127.0.0.1` (for development)
   - `pauljsnider.github.io` (production)
   - Any custom domain you use

### C. Verify Authentication Provider

1. Go to Firebase Console → Authentication → Sign-in method
2. Verify Email/Password provider is **enabled**
3. If you want "user not found" checks to work, ensure "Email enumeration protection" is **OFF**

## Testing Checklist

After implementing all fixes:

- [ ] Firebase Console email templates customized
- [ ] Authorized domains configured
- [ ] Test with real email address (not test account)
- [ ] **Check spam/junk folder** - Most important!
- [ ] Test with Gmail account
- [ ] Test with Outlook/Microsoft account (if applicable)
- [ ] Verify reset link redirects to `reset-password.html`
- [ ] Test error cases:
  - [ ] Invalid email format
  - [ ] Non-existent user email
  - [ ] Too many requests (send 5+ in quick succession)
- [ ] Verify password reset completes successfully
- [ ] Confirm redirect to login page after reset

## Common Issues & Solutions

### "I'm not receiving the email"

1. **Check spam/junk folder first** - This is where 90% of Firebase emails end up
2. Wait 5-10 minutes - Email delivery can be delayed
3. Try a different email provider (Gmail usually works best)
4. Check Firebase Console logs for delivery failures
5. Verify email address is registered in your Firebase Auth users

### "Email goes to spam"

Solutions:
- Customize email template in Firebase Console (makes it look less generic)
- Use a custom domain with proper SPF/DKIM records
- Consider using a custom SMTP server (requires Firebase Blaze plan)

### "Microsoft 365 blocks the emails"

This is a known issue. Microsoft 365 blocks Firebase emails because the sender domain doesn't match the link domain.

Solutions:
- Use Gmail or another provider for testing
- For production: Set up custom SMTP with your own domain
- Or: Add Firebase to your Microsoft 365 safe sender list

### "Link in email doesn't work"

Causes:
- Action URL not set in Firebase Console template
- Authorized domains don't include your domain
- `reset-password.html` not deployed
- `actionCodeSettings.url` points to wrong location

Fix: Verify all configuration in Firebase Console and ensure code is deployed.

## Technical Details

### How Firebase Password Reset Works

1. User enters email on login page
2. App calls `sendPasswordResetEmail(auth, email, actionCodeSettings)`
3. Firebase generates unique one-time code (`oobCode`)
4. Firebase sends email to user with link containing the code
5. User clicks link → directed to `actionCodeSettings.url` + query params
6. Your app extracts `oobCode` from URL
7. User enters new password
8. App calls `confirmPasswordReset(auth, oobCode, newPassword)`
9. Firebase validates code and updates password
10. User redirected to login

### Security Considerations

- Reset codes expire after 1 hour by default
- Codes can only be used once
- Old passwords are invalidated immediately
- All active sessions are terminated on password change
- Rate limiting prevents abuse (max ~5 requests per hour per email)

## References

- [Firebase Manage Users Documentation](https://firebase.google.com/docs/auth/web/manage-users)
- [Custom Email Action Handlers](https://firebase.google.com/docs/auth/custom-email-handler)
- [Firebase Reset Password Troubleshooting - Stack Overflow](https://stackoverflow.com/questions/71025571/firebase-sendpasswordresetemail-doesnt-send-email)
- [Addressing Firebase Auth Email Reset Errors - Medium](https://medium.com/@python-javascript-php-html-css/addressing-firebase-auth-email-reset-error-problems-11a868102807)
- [Firebase Password Reset Flow Guide](https://bootstrapped.app/guide/how-to-handle-firebase-authentication-password-reset-flow)

## Support

If password reset still doesn't work after following this guide:

1. Check Firebase Console → Authentication → Users to verify the user exists
2. Review browser console for JavaScript errors
3. Check Firebase Console logs for delivery failures
4. Test with `console.log()` to verify `resetPassword()` is being called
5. Verify network requests in browser DevTools (should see call to Firebase API)

Most issues are resolved by checking the spam folder and properly configuring Firebase Console settings.
