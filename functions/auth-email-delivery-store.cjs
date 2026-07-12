'use strict';

function createAuthEmailDeliveryStore({
  firestore,
  Timestamp,
  FieldValue,
  logger,
  cooldownMs,
  buildRateLimitId,
  buildMailDocId,
  buildMailJob,
  normalizeEmail,
  hashRecipient,
  now = Date.now,
  passwordResetRequestTtlMs = 24 * 60 * 60 * 1000
}) {
  async function reserve(type, email, scope = '') {
    const requestedAt = now();
    const limitRef = firestore.collection('authEmailRateLimits').doc(buildRateLimitId(type, email, scope));
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(limitRef);
      const nextAllowedAt = snapshot.data()?.nextAllowedAt;
      const nextAllowedMillis = typeof nextAllowedAt?.toMillis === 'function'
        ? nextAllowedAt.toMillis()
        : new Date(nextAllowedAt || 0).getTime();
      if (Number.isFinite(nextAllowedMillis) && nextAllowedMillis > requestedAt) {
        return false;
      }

      transaction.set(limitRef, {
        type,
        recipientHash: hashRecipient(normalizeEmail(email)),
        nextAllowedAt: Timestamp.fromMillis(requestedAt + cooldownMs),
        updatedAt: FieldValue.serverTimestamp()
      });
      return true;
    });
  }

  async function release(type, email, scope = '') {
    const limitRef = firestore.collection('authEmailRateLimits').doc(buildRateLimitId(type, email, scope));
    await limitRef.delete().catch((error) => {
      logger.warn('Unable to release failed authentication email reservation.', {
        code: error?.code || null,
        type
      });
    });
  }

  async function queue({
    type,
    email,
    actionUrl,
    displayName = '',
    contextLabel = '',
    uid = null,
    inviteCodeId = null,
    deliveryId = null
  }) {
    const job = buildMailJob({
      type,
      email,
      actionUrl,
      displayName,
      contextLabel,
      uid,
      inviteCodeId
    });
    const mailRef = firestore.collection('mail').doc(deliveryId || buildMailDocId(type, email));
    await mailRef.create({
      ...job,
      createdAt: FieldValue.serverTimestamp()
    });
    return mailRef.id;
  }

  async function enqueuePasswordResetRequest(email) {
    const requestedAt = now();
    const requestRef = firestore.collection('authEmailRequests').doc();
    await requestRef.create({
      type: 'password_reset',
      email: normalizeEmail(email),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(requestedAt + passwordResetRequestTtlMs)
    });
    return requestRef.id;
  }

  return { reserve, release, queue, enqueuePasswordResetRequest };
}

module.exports = { createAuthEmailDeliveryStore };
