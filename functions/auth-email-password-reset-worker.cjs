'use strict';

function isAuthUserNotFoundError(error) {
  return error?.code === 'auth/user-not-found' || error?.code === 'user-not-found';
}

function createPasswordResetEmailWorker({
  auth,
  logger,
  types,
  normalizeEmail,
  isValidEmail,
  getActionSettings,
  queueDelivery,
  releaseDelivery,
  isAlreadyExistsError
}) {
  async function safeRelease(email) {
    try {
      await releaseDelivery(types.PASSWORD_RESET, email);
    } catch (error) {
      logger.warn('Unable to release password-reset email reservation.', {
        code: error?.code || null
      });
    }
  }

  async function processPasswordResetRequest(data = {}, {
    requestId = '',
    deleteRequest = async () => {}
  } = {}) {
    const email = normalizeEmail(data.email);
    try {
      if (data.type !== types.PASSWORD_RESET || !isValidEmail(email) || !requestId) {
        logger.error('Rejected malformed password-reset processing request.', { requestId });
        if (isValidEmail(email)) await safeRelease(email);
        return;
      }

      const user = await auth.getUserByEmail(email);
      const actionUrl = await auth.generatePasswordResetLink(
        email,
        getActionSettings(types.PASSWORD_RESET)
      );
      try {
        await queueDelivery({
          type: types.PASSWORD_RESET,
          email,
          actionUrl,
          displayName: user.displayName || '',
          uid: user.uid,
          deliveryId: `auth_password_reset_${requestId}`
        });
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
      }
    } catch (error) {
      if (!isAuthUserNotFoundError(error)) {
        logger.error('Unable to process password-reset email.', {
          code: error?.code || null,
          requestId
        });
      }
      await safeRelease(email);
    } finally {
      await deleteRequest();
    }
  }

  return { processPasswordResetRequest };
}

module.exports = {
  createPasswordResetEmailWorker,
  isAuthUserNotFoundError
};
