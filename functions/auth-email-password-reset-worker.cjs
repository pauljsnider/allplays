'use strict';

function isAuthUserNotFoundError(error) {
  return error?.code === 'auth/user-not-found' || error?.code === 'user-not-found';
}

function getTimestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const millis = Number(value);
  return Number.isFinite(millis) ? millis : null;
}

function createPasswordResetEmailWorker({
  auth,
  logger,
  types,
  normalizeEmail,
  isValidEmail,
  getActionSettings,
  queueDelivery,
  isAlreadyExistsError,
  now = Date.now
}) {
  async function processPasswordResetRequest(data = {}, {
    requestId = '',
    deleteRequest = async () => {}
  } = {}) {
    const email = normalizeEmail(data.email);
    const expiresAtMillis = getTimestampMillis(data.expiresAt);
    const malformed = data.type !== types.PASSWORD_RESET ||
      !isValidEmail(email) ||
      !requestId ||
      expiresAtMillis == null;
    if (malformed) {
      logger.error('Rejected malformed password-reset processing request.', { requestId });
      await deleteRequest();
      return;
    }
    if (now() >= expiresAtMillis) {
      logger.warn('Dropped expired password-reset processing request.', { requestId });
      await deleteRequest();
      return;
    }

    try {
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
      await deleteRequest();
    } catch (error) {
      if (isAuthUserNotFoundError(error)) {
        // Preserve the same cooldown as successful delivery so repeated requests
        // cannot distinguish missing accounts or amplify worker traffic.
        await deleteRequest();
        return;
      }

      const expired = now() >= expiresAtMillis;
      if (expired) {
        logger.warn('Password-reset processing request expired during an attempt.', { requestId });
        await deleteRequest();
        return;
      }
      logger.error('Password-reset processing failed and will be retried.', {
        code: error?.code || null,
        requestId
      });
      throw error;
    }
  }

  return { processPasswordResetRequest };
}

module.exports = {
  createPasswordResetEmailWorker,
  getTimestampMillis,
  isAuthUserNotFoundError
};
