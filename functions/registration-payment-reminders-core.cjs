const REGISTRATION_PAYMENT_REMINDER_CADENCE_DAYS = 3;

function normalizeFirestoreId(value, label) {
  const id = String(value || '').trim();
  if (!id || id.includes('/')) {
    throw new Error(`${label} is required.`);
  }
  return id;
}

function buildRegistrationPaymentRetryUrl(appUrl, input = {}) {
  const publicCheckoutCapability = String(input.publicCheckoutCapability || '').trim();
  if (!publicCheckoutCapability) {
    return '';
  }
  const baseUrl = String(appUrl || 'https://allplays.ai').replace(/\/$/, '');
  const params = new URLSearchParams({
    teamId: normalizeFirestoreId(input.teamId, 'teamId'),
    formId: normalizeFirestoreId(input.formId, 'formId'),
    retryPayment: '1',
    publicCheckoutCapability
  });
  return `${baseUrl}/registration.html?${params.toString()}`;
}

function formatRegistrationReminderAmount(amountCents, currency = 'USD') {
  const cents = Math.max(0, Math.round(Number(amountCents || 0)));
  const normalizedCurrency = String(currency || 'USD').trim().toUpperCase() || 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency
    }).format(cents / 100);
  } catch (error) {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function sanitizeHttpUrl(value) {
  const trimmedValue = String(value || '').trim();
  if (!trimmedValue) {
    return '';
  }
  try {
    const parsedUrl = new URL(trimmedValue);
    return parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:'
      ? parsedUrl.toString()
      : '';
  } catch (error) {
    return '';
  }
}

function buildRegistrationPaymentReminderMailDocId({ teamId, formId, registrationId, eventId, sequence = 'initial' } = {}) {
  const parts = [teamId, formId, registrationId, eventId, sequence]
    .map((part) => String(part || '').trim().replace(/[^\w.-]+/g, '_').slice(0, 120))
    .filter(Boolean);
  return `registrationPayment_${parts.join('_')}`.slice(0, 500);
}

function buildQueuedReminderAuditEntry({ kind = 'initial', eventId = '', mailDocId = '', queuedAtIso = '' } = {}) {
  return {
    kind,
    eventId: String(eventId || '').trim() || null,
    mailDocId: String(mailDocId || '').trim() || null,
    queuedAt: String(queuedAtIso || '').trim() || null
  };
}

function buildRegistrationPaymentReminderMessage({
  programName = 'your registration',
  amountDueCents = 0,
  currency = 'USD',
  retryUrl = '',
  reminderLabel = 'We could not process your registration payment.'
} = {}) {
  const safeProgramName = String(programName || 'your registration').trim() || 'your registration';
  const amountLabel = formatRegistrationReminderAmount(amountDueCents, currency);
  const safeRetryUrl = sanitizeHttpUrl(retryUrl);
  return {
    subject: `Payment reminder: ${safeProgramName}`,
    text: [
      reminderLabel,
      '',
      `Program: ${safeProgramName}`,
      `Amount due: ${amountLabel}`,
      '',
      safeRetryUrl ? `Retry payment: ${safeRetryUrl}` : '',
      '',
      'If your payment has already gone through, you can ignore this email.'
    ].filter(Boolean).join('\n'),
    html: `<p>${escapeHtml(reminderLabel)}</p>
<p><strong>Program:</strong> ${escapeHtml(safeProgramName)}<br />
<strong>Amount due:</strong> ${escapeHtml(amountLabel)}</p>
${safeRetryUrl ? `<p><a href="${escapeHtml(safeRetryUrl)}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;">Retry payment</a></p>` : ''}
<p>If your payment has already gone through, you can ignore this email.</p>`
  };
}

function buildRegistrationFailedPaymentReminderState({
  registration = {},
  input = {},
  eventId = '',
  appUrl = '',
  queuedAtIso = '',
  mailDocId = '',
  cadenceDays = REGISTRATION_PAYMENT_REMINDER_CADENCE_DAYS
} = {}) {
  const amountDueCents = Math.max(0, Math.round(Number(
    registration.feeSnapshot?.finalAmountDueCents ?? registration.feeAmountCents ?? 0
  )));
  const nextReminderAt = new Date(Date.parse(String(queuedAtIso || new Date().toISOString())) + cadenceDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    status: 'active',
    cadenceDays,
    reminderCount: 1,
    recipientEmail: String(
      registration.guardian?.email || registration.guardian?.guardianEmail || registration.guardian?.parentEmail || ''
    ).trim().toLowerCase() || null,
    amountDueCents,
    currency: String(registration.currency || 'USD').trim().toUpperCase() || 'USD',
    retryUrl: buildRegistrationPaymentRetryUrl(appUrl, {
      teamId: input.teamId,
      formId: input.formId,
      publicCheckoutCapability: input.publicCheckoutCapability || ''
    }),
    lastEventId: String(eventId || '').trim() || null,
    firstQueuedAt: queuedAtIso,
    lastQueuedAt: queuedAtIso,
    nextReminderAt,
    lastMailId: String(mailDocId || '').trim() || null,
    lastReminderKind: 'initial',
    lastAudit: buildQueuedReminderAuditEntry({
      kind: 'initial',
      eventId,
      mailDocId,
      queuedAtIso
    })
  };
}

function shouldStopRegistrationPaymentReminders(registration = {}) {
  const paymentStatus = String(registration.paymentStatus || '').trim().toLowerCase();
  const status = String(registration.status || '').trim().toLowerCase();
  return paymentStatus === 'paid' ||
    paymentStatus === 'checkout_cancelled' ||
    paymentStatus === 'checkout_canceled' ||
    paymentStatus === 'checkout_expired' ||
    ['cancelled', 'canceled', 'closed'].includes(status);
}

module.exports = {
  REGISTRATION_PAYMENT_REMINDER_CADENCE_DAYS,
  buildQueuedReminderAuditEntry,
  buildRegistrationFailedPaymentReminderState,
  buildRegistrationPaymentReminderMailDocId,
  buildRegistrationPaymentReminderMessage,
  buildRegistrationPaymentRetryUrl,
  formatRegistrationReminderAmount,
  shouldStopRegistrationPaymentReminders
};
