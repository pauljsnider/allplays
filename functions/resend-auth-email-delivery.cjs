'use strict';

const crypto = require('node:crypto');

const DEFAULT_FROM = 'ALL PLAYS <noreply@mail.allplays.ai>';
const DELIVERY_RETENTION_MS = 24 * 60 * 60 * 1000;
const FALLBACK_LEASE_MS = 5 * 60 * 1000;
const RESEND_EVENT_STATES = Object.freeze({
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.failed': 'failed',
  'email.suppressed': 'suppressed',
  'email.complained': 'complained'
});
const FALLBACK_EVENTS = new Set(['email.bounced', 'email.failed', 'email.suppressed']);
const ALERT_EVENTS = new Set([...FALLBACK_EVENTS, 'email.complained']);

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === '6' || error?.code === 'already-exists';
}

function sanitizeTagValue(value, fallback = 'unknown') {
  const sanitized = String(value || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 256);
  return sanitized || fallback;
}

function hashRecipient(email) {
  return crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
}

function buildIdempotencyKey(deliveryId) {
  return `allplays-auth-${sanitizeTagValue(deliveryId).slice(0, 220)}-v1`;
}

function getErrorStatus(error) {
  const status = Number(error?.statusCode ?? error?.status ?? error?.status_code);
  return Number.isFinite(status) ? status : null;
}

function serializeError(error) {
  return {
    code: String(error?.name || error?.code || 'unknown').slice(0, 100),
    message: String(error?.message || 'Email provider request failed.').slice(0, 500),
    statusCode: getErrorStatus(error)
  };
}

function isTransientResendError(error) {
  const status = getErrorStatus(error);
  if (status === 429 || (status != null && status >= 500)) return true;
  const code = String(error?.name || error?.code || '').toLowerCase();
  return [
    'application_error',
    'internal_server_error',
    'rate_limit_exceeded',
    'econnreset',
    'etimedout',
    'eai_again',
    'fetch_failed'
  ].some((candidate) => code.includes(candidate));
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const millis = new Date(value || 0).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function getHeader(req, name) {
  if (typeof req.get === 'function') return req.get(name) || '';
  return req.headers?.[name.toLowerCase()] || '';
}

function getRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body || {});
}

function normalizeResendResult(result) {
  if (result?.error) {
    const error = new Error(result.error.message || 'Resend rejected the email request.');
    Object.assign(error, result.error);
    throw error;
  }
  const providerMessageId = String(result?.data?.id || '').trim();
  if (!providerMessageId) throw new Error('Resend did not return an email ID.');
  return providerMessageId;
}

function createResendAuthEmailDelivery({
  firestore,
  FieldValue,
  logger,
  resend,
  webhookSecret,
  firebaseWebApiKey,
  fetchImpl = globalThis.fetch,
  from = DEFAULT_FROM,
  maxSendAttempts = 3,
  sleep = (millis) => new Promise((resolve) => setTimeout(resolve, millis)),
  now = () => new Date()
}) {
  if (!firestore || !FieldValue || !logger || !resend) {
    throw new Error('Firestore, FieldValue, logger, and Resend are required.');
  }

  async function ensureDelivery(deliveryId, job) {
    const deliveryRef = firestore.collection('authEmailDeliveries').doc(deliveryId);
    const recipient = String(job?.to?.[0] || '').trim().toLowerCase();
    const message = job?.message || {};
    const type = String(job?.metadata?.type || '').trim();
    if (!recipient || !message.subject || !message.text || !message.html || !type.startsWith('auth_')) {
      throw new Error('A complete authentication email job is required.');
    }

    try {
      await deliveryRef.create({
        recipient,
        recipientHash: hashRecipient(recipient),
        message: {
          subject: String(message.subject),
          text: String(message.text),
          html: String(message.html)
        },
        type,
        authUserId: job.metadata.authUserId || null,
        inviteCodeId: job.metadata.inviteCodeId || null,
        provider: 'resend-api',
        providerMessageId: null,
        state: 'created',
        attemptCount: 0,
        idempotencyKey: buildIdempotencyKey(deliveryId),
        fallbackState: 'not_requested',
        expiresAt: new Date(now().getTime() + DELIVERY_RETENTION_MS),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }

    const snapshot = await deliveryRef.get();
    if (!snapshot.exists) throw new Error('Authentication email delivery could not be loaded.');
    return { deliveryRef, delivery: snapshot.data() || {} };
  }

  async function send({ deliveryId, job }) {
    const normalizedDeliveryId = String(deliveryId || '').trim();
    if (!normalizedDeliveryId) throw new Error('An authentication email delivery ID is required.');
    const { deliveryRef, delivery } = await ensureDelivery(normalizedDeliveryId, job);
    if (delivery.providerMessageId) {
      return {
        deliveryId: normalizedDeliveryId,
        providerMessageId: delivery.providerMessageId,
        deduplicated: true
      };
    }

    const payload = {
      from,
      to: [delivery.recipient],
      subject: delivery.message.subject,
      text: delivery.message.text,
      html: delivery.message.html,
      tags: [
        { name: 'category', value: 'auth' },
        { name: 'auth_type', value: sanitizeTagValue(delivery.type.replace(/^auth_/, '')) },
        { name: 'delivery_id', value: sanitizeTagValue(normalizedDeliveryId) }
      ]
    };

    let lastError;
    for (let attempt = 1; attempt <= maxSendAttempts; attempt += 1) {
      await deliveryRef.set({
        state: 'sending',
        attemptCount: FieldValue.increment(1),
        lastAttemptAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      try {
        const providerMessageId = normalizeResendResult(await resend.emails.send(payload, {
          idempotencyKey: delivery.idempotencyKey
        }));
        const batch = firestore.batch();
        const acceptedUpdate = {
          providerMessageId,
          state: 'accepted',
          acceptedAt: FieldValue.serverTimestamp(),
          message: FieldValue.delete(),
          messageRedactedAt: FieldValue.serverTimestamp(),
          lastError: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp()
        };
        if (delivery.type !== 'auth_password_reset') {
          acceptedUpdate.recipient = FieldValue.delete();
          acceptedUpdate.recipientRedactedAt = FieldValue.serverTimestamp();
        }
        batch.set(deliveryRef, acceptedUpdate, { merge: true });
        batch.set(firestore.collection('resendEmailMessages').doc(providerMessageId), {
          deliveryId: normalizedDeliveryId,
          createdAt: FieldValue.serverTimestamp()
        });
        await batch.commit();
        return { deliveryId: normalizedDeliveryId, providerMessageId, deduplicated: false };
      } catch (error) {
        lastError = error;
        if (attempt < maxSendAttempts && isTransientResendError(error)) {
          await sleep(250 * (2 ** (attempt - 1)));
          continue;
        }
        break;
      }
    }

    await deliveryRef.set({
      state: 'send_failed',
      lastError: serializeError(lastError),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    logger.error('Authentication email provider request failed.', {
      deliveryId: normalizedDeliveryId,
      error: serializeError(lastError)
    });
    throw lastError;
  }

  async function findDeliveryId(providerMessageId) {
    const mapping = await firestore.collection('resendEmailMessages').doc(providerMessageId).get();
    if (mapping.exists && mapping.data()?.deliveryId) return mapping.data().deliveryId;
    const fallbackQuery = await firestore.collection('authEmailDeliveries')
      .where('providerMessageId', '==', providerMessageId)
      .limit(1)
      .get();
    return fallbackQuery.empty ? '' : fallbackQuery.docs[0].id;
  }

  async function sendFirebasePasswordReset(email) {
    if (!firebaseWebApiKey || typeof fetchImpl !== 'function') {
      const error = new Error('Firebase password-reset fallback is not configured.');
      error.definitiveFailure = true;
      throw error;
    }
    const response = await fetchImpl(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(firebaseWebApiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestType: 'PASSWORD_RESET',
          email,
          continueUrl: 'https://allplays.ai/reset-password.html',
          canHandleCodeInApp: true
        })
      }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.error) {
      const error = new Error(result?.error?.message || `Firebase fallback failed with HTTP ${response.status}.`);
      error.code = result?.error?.message || `http-${response.status}`;
      error.statusCode = response.status;
      error.definitiveFailure = true;
      throw error;
    }
    return result;
  }

  async function processVerifiedWebhook(event, webhookId) {
    const eventType = String(event?.type || '').trim();
    const providerMessageId = String(event?.data?.email_id || '').trim();
    const eventState = RESEND_EVENT_STATES[eventType];
    const webhookRef = firestore.collection('resendWebhookEvents').doc(webhookId);
    await webhookRef.set({
      eventType,
      providerMessageId: providerMessageId || null,
      eventCreatedAt: event?.created_at || null,
      status: 'processing',
      receivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    if (!providerMessageId || !eventState) {
      await webhookRef.set({ status: 'ignored', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ignored: true };
    }

    const deliveryId = await findDeliveryId(providerMessageId);
    if (!deliveryId) {
      await webhookRef.set({ status: 'pending_mapping', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      logger.warn('Resend webhook did not match an ALL PLAYS authentication delivery.', {
        eventType,
        providerMessageId,
        webhookId
      });
      const error = new Error('Resend webhook arrived before its delivery mapping was available.');
      error.code = 'delivery-mapping-pending';
      error.statusCode = 503;
      throw error;
    }

    const deliveryRef = firestore.collection('authEmailDeliveries').doc(deliveryId);
    const eventAt = String(event?.created_at || now().toISOString());
    const eventAtMillis = timestampMillis(eventAt);
    const claimedAt = now().toISOString();
    const claimedAtMillis = timestampMillis(claimedAt);
    const decision = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(deliveryRef);
      if (!snapshot.exists) {
        return {
          deliveryForAlert: null,
          eventWasApplied: false,
          fallback: null,
          fallbackInProgress: false
        };
      }
      const delivery = snapshot.data() || {};
      let fallback = null;
      let fallbackInProgress = false;
      let eventWasApplied = false;
      const currentEventMillis = timestampMillis(delivery.providerEventAt);
      const update = {
        lastWebhookId: webhookId,
        updatedAt: FieldValue.serverTimestamp()
      };
      if (!currentEventMillis || eventAtMillis >= currentEventMillis) {
        eventWasApplied = true;
        update.state = eventState;
        update.providerEventType = eventType;
        update.providerEventAt = eventAt;
      }

      if (
        eventWasApplied &&
        ['email.delivered', 'email.complained'].includes(eventType)
      ) {
        update.recipient = FieldValue.delete();
        update.recipientRedactedAt = FieldValue.serverTimestamp();
      }

      const fallbackLeaseExpired = delivery.fallbackState === 'claimed' &&
        claimedAtMillis - timestampMillis(delivery.fallbackClaimedAt) >= FALLBACK_LEASE_MS;
      const fallbackCanBeClaimed = ['not_requested', 'failed'].includes(delivery.fallbackState) ||
        (delivery.fallbackState === 'claimed' && fallbackLeaseExpired);
      const shouldFallback = FALLBACK_EVENTS.has(eventType) &&
        delivery.type === 'auth_password_reset' &&
        eventAtMillis >= currentEventMillis &&
        fallbackCanBeClaimed;
      if (shouldFallback) {
        update.fallbackState = 'claimed';
        update.fallbackClaimedAt = claimedAt;
        update.fallbackAttemptCount = FieldValue.increment(1);
        fallback = { email: delivery.recipient, deliveryId };
      } else if (
        FALLBACK_EVENTS.has(eventType) &&
        delivery.type === 'auth_password_reset' &&
        eventAtMillis >= currentEventMillis &&
        (
          (delivery.fallbackState === 'claimed' && !fallbackLeaseExpired) ||
          delivery.fallbackState === 'sending'
        )
      ) {
        fallbackInProgress = true;
      }
      transaction.set(deliveryRef, update, { merge: true });
      return {
        deliveryForAlert: { recipientHash: delivery.recipientHash || null },
        eventWasApplied,
        fallback,
        fallbackInProgress
      };
    });

    const {
      deliveryForAlert = null,
      eventWasApplied = false,
      fallback = null,
      fallbackInProgress = false
    } = decision || {};

    if (eventWasApplied && ALERT_EVENTS.has(eventType)) {
      const alertId = `${sanitizeTagValue(providerMessageId)}_${sanitizeTagValue(eventType)}`;
      await firestore.collection('emailDeliveryAlerts').doc(alertId).set({
        category: 'authentication_email_delivery',
        deliveryId,
        providerMessageId,
        eventType,
        recipientHash: deliveryForAlert?.recipientHash || null,
        status: 'open',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      logger.error('Authentication email reached a terminal provider state.', {
        deliveryId,
        eventType,
        providerMessageId
      });
    }

    if (fallback) {
      await deliveryRef.set({
        fallbackState: 'sending',
        fallbackSendingAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      try {
        await sendFirebasePasswordReset(fallback.email);
      } catch (error) {
        if (!error?.definitiveFailure) {
          await webhookRef.set({
            status: 'indeterminate',
            error: serializeError(error),
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
          logger.error('Firebase password-reset fallback outcome is indeterminate; automatic resend is blocked.', {
            deliveryId,
            providerMessageId,
            code: error?.code || error?.name || null
          });
          throw error;
        }
        await deliveryRef.set({
          fallbackState: 'failed',
          fallbackLastError: serializeError(error),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        await webhookRef.set({
          status: 'failed',
          error: serializeError(error),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        throw error;
      }

      try {
        await deliveryRef.set({
          fallbackState: 'sent',
          fallbackProvider: 'firebase-auth',
          fallbackSentAt: FieldValue.serverTimestamp(),
          fallbackLastError: FieldValue.delete(),
          recipient: FieldValue.delete(),
          recipientRedactedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (error) {
        await webhookRef.set({
          status: 'indeterminate',
          error: serializeError(error),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        logger.error('Firebase password-reset fallback was accepted but its sent state could not be persisted.', {
          deliveryId,
          providerMessageId,
          code: error?.code || error?.name || null
        });
        throw error;
      }
    }

    if (fallbackInProgress) {
      const error = new Error('Password-reset fallback is still in progress.');
      error.code = 'fallback-in-progress';
      throw error;
    }

    await webhookRef.set({
      deliveryId,
      status: 'processed',
      processedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { deliveryId, state: eventState, applied: eventWasApplied, fallbackSent: Boolean(fallback) };
  }

  async function handleWebhook(req, res) {
    if (req.method !== 'POST') {
      res.set('allow', 'POST').status(405).send('Method not allowed');
      return;
    }
    if (!webhookSecret) {
      logger.error('Resend webhook secret is unavailable.');
      res.status(503).send('Webhook unavailable');
      return;
    }

    const webhookId = String(getHeader(req, 'svix-id') || '').trim();
    let event;
    try {
      if (!webhookId) throw new Error('Missing webhook ID.');
      event = await resend.webhooks.verify({
        payload: getRawBody(req),
        headers: {
          id: webhookId,
          timestamp: getHeader(req, 'svix-timestamp'),
          signature: getHeader(req, 'svix-signature')
        },
        webhookSecret
      });
    } catch (error) {
      logger.warn('Rejected an invalid Resend webhook.', {
        code: error?.code || error?.name || null,
        webhookId: webhookId || null
      });
      res.status(400).send('Invalid webhook');
      return;
    }

    try {
      await processVerifiedWebhook(event, webhookId);
      res.status(200).send('ok');
    } catch (error) {
      logger.error('Resend webhook processing failed.', {
        code: error?.code || error?.name || null,
        webhookId
      });
      res.status(getErrorStatus(error) || 500).send('Webhook processing failed');
    }
  }

  return { handleWebhook, processVerifiedWebhook, send, sendFirebasePasswordReset };
}

module.exports = {
  ALERT_EVENTS,
  DEFAULT_FROM,
  FALLBACK_EVENTS,
  RESEND_EVENT_STATES,
  buildIdempotencyKey,
  createResendAuthEmailDelivery,
  hashRecipient,
  isTransientResendError,
  sanitizeTagValue
};
