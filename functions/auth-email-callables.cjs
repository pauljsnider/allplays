'use strict';

function isAuthUserNotFoundError(error) {
  return error?.code === 'auth/user-not-found' || error?.code === 'user-not-found';
}

function createAuthEmailCallableHandlers({
  auth,
  HttpsError,
  logger,
  types,
  normalizeEmail,
  isValidEmail,
  checkPasswordResetRateLimit,
  reserveDelivery,
  releaseDelivery,
  queueDelivery,
  getActionSettings,
  getInviteContinueUrl,
  findOwnedInviteCode,
  allowedInviteTypes,
  isInviteExpired,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  minimumPasswordResetResponseMs = 250
}) {
  async function safeRelease(type, email, scope = '') {
    try {
      await releaseDelivery(type, email, scope);
    } catch (error) {
      logger.warn('Unable to release authentication email reservation.', {
        code: error?.code || null,
        type
      });
    }
  }

  async function neutralPasswordResetResponse(startedAt) {
    const remaining = minimumPasswordResetResponseMs - Math.max(0, now() - startedAt);
    if (remaining > 0) {
      await sleep(remaining);
    }
    return { queued: true };
  }

  async function queuePasswordResetEmail(data, context = {}) {
    const email = normalizeEmail(data?.email);
    if (!isValidEmail(email)) {
      throw new HttpsError('invalid-argument', 'Enter a valid email address.');
    }

    const startedAt = now();
    let reserved = false;
    try {
      const requestLimit = checkPasswordResetRateLimit(context.rawRequest || {});
      if (!requestLimit.allowed) {
        logger.warn('Password-reset email request rate limit reached.', {
          retryAfterSeconds: requestLimit.retryAfterSeconds
        });
        return await neutralPasswordResetResponse(startedAt);
      }

      reserved = await reserveDelivery(types.PASSWORD_RESET, email);
      if (!reserved) {
        return await neutralPasswordResetResponse(startedAt);
      }

      let user;
      try {
        user = await auth.getUserByEmail(email);
      } catch (error) {
        if (!isAuthUserNotFoundError(error)) {
          logger.error('Unable to look up password-reset recipient.', { code: error?.code || null });
          await safeRelease(types.PASSWORD_RESET, email);
          reserved = false;
        }
        return await neutralPasswordResetResponse(startedAt);
      }

      try {
        const actionUrl = await auth.generatePasswordResetLink(
          email,
          getActionSettings(types.PASSWORD_RESET)
        );
        await queueDelivery({
          type: types.PASSWORD_RESET,
          email,
          actionUrl,
          displayName: user.displayName || '',
          uid: user.uid
        });
      } catch (error) {
        logger.error('Unable to generate or queue password-reset email.', {
          code: error?.code || null,
          uid: user.uid
        });
        await safeRelease(types.PASSWORD_RESET, email);
        reserved = false;
      }
      return await neutralPasswordResetResponse(startedAt);
    } catch (error) {
      if (reserved) {
        await safeRelease(types.PASSWORD_RESET, email);
      }
      logger.error('Unable to process password-reset email request.', { code: error?.code || null });
      return await neutralPasswordResetResponse(startedAt);
    }
  }

  async function resolveVerificationUser(data, context) {
    let uid = String(context.auth?.uid || '').trim();
    if (!uid && data?.idToken) {
      try {
        const decoded = await auth.verifyIdToken(String(data.idToken));
        uid = String(decoded?.uid || '').trim();
      } catch (error) {
        logger.warn('Rejected invalid native authentication token for auth email request.', {
          code: error?.code || null
        });
      }
    }
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in before requesting this email.');
    }
    return auth.getUser(uid);
  }

  async function queueEmailVerification(data, context = {}) {
    const user = await resolveVerificationUser(data, context);
    const email = normalizeEmail(user.email);
    if (!isValidEmail(email)) {
      throw new HttpsError('failed-precondition', 'The signed-in account does not have a valid email address.');
    }
    if (user.emailVerified) {
      return { alreadyVerified: true };
    }

    const reserved = await reserveDelivery(types.VERIFICATION, email, user.uid);
    if (!reserved) {
      return { queued: true };
    }

    try {
      const actionUrl = await auth.generateEmailVerificationLink(
        email,
        getActionSettings(types.VERIFICATION)
      );
      await queueDelivery({
        type: types.VERIFICATION,
        email,
        actionUrl,
        displayName: user.displayName || '',
        uid: user.uid
      });
      return { queued: true };
    } catch (error) {
      await safeRelease(types.VERIFICATION, email, user.uid);
      logger.error('Unable to generate or queue verification email.', {
        code: error?.code || null,
        uid: user.uid
      });
      throw new HttpsError('internal', 'Verification email could not be queued.');
    }
  }

  async function getExistingInviteRecipient(email) {
    try {
      const recipient = await auth.getUserByEmail(email);
      return { existingUser: true, displayName: recipient.displayName || '' };
    } catch (error) {
      if (isAuthUserNotFoundError(error)) {
        return { existingUser: false, displayName: '' };
      }
      throw error;
    }
  }

  async function queueInviteSignInEmail(data, context = {}) {
    const uid = String(context.auth?.uid || '').trim();
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in before sending an invite email.');
    }
    const code = String(data?.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      throw new HttpsError('invalid-argument', 'A valid eight-character invite code is required.');
    }

    const invite = await findOwnedInviteCode(code, uid, allowedInviteTypes);
    if (!invite) {
      throw new HttpsError('not-found', 'Invite could not be found.');
    }
    const inviteType = String(invite.data.type || '').trim().toLowerCase();
    const email = normalizeEmail(invite.data.email);
    if (!isValidEmail(email) || invite.data.used === true || invite.data.revoked === true || isInviteExpired(invite.data.expiresAt)) {
      throw new HttpsError('failed-precondition', 'Invite is not eligible for email delivery.');
    }

    const reserved = await reserveDelivery(types.SIGN_IN, email);
    if (!reserved) {
      try {
        const { existingUser } = await getExistingInviteRecipient(email);
        return { queued: false, existingUser };
      } catch (error) {
        logger.warn('Unable to look up a rate-limited invite recipient.', { code: error?.code || null });
        return { queued: false, existingUser: false };
      }
    }

    try {
      const continueUrl = getInviteContinueUrl(code, inviteType);
      const actionUrl = await auth.generateSignInWithEmailLink(
        email,
        getActionSettings(types.SIGN_IN, continueUrl)
      );
      const { existingUser, displayName } = await getExistingInviteRecipient(email);
      await queueDelivery({
        type: types.SIGN_IN,
        email,
        actionUrl,
        displayName,
        contextLabel: String(invite.data.teamName || '').trim(),
        uid: null,
        inviteCodeId: invite.id
      });
      return { queued: true, existingUser };
    } catch (error) {
      await safeRelease(types.SIGN_IN, email);
      logger.error('Unable to generate or queue invite sign-in email.', {
        code: error?.code || null,
        inviteCodeId: invite.id,
        inviterUid: uid
      });
      throw new HttpsError('internal', 'Invite email could not be queued.');
    }
  }

  return {
    queuePasswordResetEmail,
    queueEmailVerification,
    queueInviteSignInEmail
  };
}

module.exports = {
  createAuthEmailCallableHandlers,
  isAuthUserNotFoundError
};
