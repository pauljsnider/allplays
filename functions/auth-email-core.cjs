'use strict';

const crypto = require('node:crypto');

const ALLPLAYS_ORIGIN = 'https://allplays.ai';
const AUTH_EMAIL_TYPES = Object.freeze({
  VERIFICATION: 'verification',
  PASSWORD_RESET: 'password_reset',
  SIGN_IN: 'sign_in'
});

function normalizeAuthEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidAuthEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeAuthEmail(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeHeaderText(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
}

function getAuthEmailActionSettings(type, continueUrl = '', origin = ALLPLAYS_ORIGIN) {
  const normalizedOrigin = String(origin || ALLPLAYS_ORIGIN).replace(/\/$/, '');
  if (type === AUTH_EMAIL_TYPES.SIGN_IN) {
    const url = new URL(String(continueUrl || ''), normalizedOrigin);
    if (url.origin !== new URL(normalizedOrigin).origin) {
      throw new Error('Email sign-in links must continue to the ALL PLAYS origin.');
    }
    return { url: url.toString(), handleCodeInApp: true };
  }
  if (type === AUTH_EMAIL_TYPES.VERIFICATION) {
    return {
      url: `${normalizedOrigin}/app/#/verify-pending`,
      handleCodeInApp: false
    };
  }
  if (type === AUTH_EMAIL_TYPES.PASSWORD_RESET) {
    return {
      url: `${normalizedOrigin}/reset-password.html`,
      handleCodeInApp: true
    };
  }
  throw new Error('Unsupported authentication email type.');
}

function getInviteContinueUrl(code, inviteType, origin = ALLPLAYS_ORIGIN) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  const normalizedType = String(inviteType || '').trim().toLowerCase();
  const type = normalizedType === 'admin_invite'
    ? 'admin'
    : normalizedType === 'parent_invite'
      ? 'parent'
      : normalizedType === 'household_invite'
        ? 'household'
        : normalizedType === 'coparent_invite'
          ? 'coparent'
        : '';
  if (!/^[A-Z0-9]{8}$/.test(normalizedCode) || !type) {
    throw new Error('A supported invite type and eight-character code are required.');
  }
  const url = new URL('/accept-invite.html', origin);
  url.searchParams.set('code', normalizedCode);
  url.searchParams.set('type', type);
  return url.toString();
}

function buildAuthEmailMessage({ type, actionUrl, displayName = '', contextLabel = '' } = {}) {
  const url = String(actionUrl || '').trim();
  if (!Object.values(AUTH_EMAIL_TYPES).includes(type) || !url.startsWith('https://')) {
    throw new Error('A supported authentication email type and secure action URL are required.');
  }

  const name = String(displayName || '').trim();
  const normalizedContextLabel = normalizeHeaderText(contextLabel);
  const greeting = name ? `Hi ${name},` : 'Hello,';
  const safeGreeting = escapeHtml(greeting);
  const safeUrl = escapeHtml(url);
  const safeContext = escapeHtml(normalizedContextLabel);

  let subject;
  let heading;
  let intro;
  let buttonLabel;
  let expirationCopy;

  if (type === AUTH_EMAIL_TYPES.VERIFICATION) {
    subject = 'Verify your ALL PLAYS email';
    heading = 'Verify your email';
    intro = 'Confirm this email address to finish setting up your ALL PLAYS account.';
    buttonLabel = 'Verify email';
    expirationCopy = 'If you did not create or update this account, you can ignore this email.';
  } else if (type === AUTH_EMAIL_TYPES.PASSWORD_RESET) {
    subject = 'Reset your ALL PLAYS password';
    heading = 'Reset your password';
    intro = 'We received a request to reset the password for your ALL PLAYS account.';
    buttonLabel = 'Reset password';
    expirationCopy = 'If you did not request a password reset, you can ignore this email.';
  } else {
    subject = normalizedContextLabel ? `You're invited to ${normalizedContextLabel} on ALL PLAYS` : "You're invited to ALL PLAYS";
    heading = "You're invited to ALL PLAYS";
    intro = normalizedContextLabel
      ? `Use this secure sign-in link to accept your invitation to ${normalizedContextLabel}.`
      : 'Use this secure sign-in link to accept your invitation.';
    buttonLabel = 'Accept invitation';
    expirationCopy = 'This link can be used only for the email address that received it.';
  }

  const text = [
    greeting,
    '',
    intro,
    normalizedContextLabel && type === AUTH_EMAIL_TYPES.SIGN_IN ? `Invitation: ${normalizedContextLabel}` : '',
    '',
    `${buttonLabel}: ${url}`,
    '',
    expirationCopy
  ].filter((line, index, lines) => line || (index > 0 && lines[index - 1] !== '')).join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:560px;margin:0 auto">
      <div style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#4f46e5;margin-bottom:18px">ALL PLAYS</div>
      <h1 style="font-size:26px;line-height:1.2;margin:0 0 16px">${escapeHtml(heading)}</h1>
      <p>${safeGreeting}</p>
      <p>${escapeHtml(intro)}</p>
      ${safeContext && type === AUTH_EMAIL_TYPES.SIGN_IN ? `<p><strong>Invitation:</strong> ${safeContext}</p>` : ''}
      <p style="margin:26px 0"><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(buttonLabel)}</a></p>
      <p style="font-size:13px;color:#4b5563">${escapeHtml(expirationCopy)}</p>
      <p style="font-size:12px;color:#6b7280;word-break:break-all">If the button does not work, copy and paste this link:<br>${safeUrl}</p>
    </div>
  `.trim();

  return { subject, text, html };
}

function buildAuthEmailMailDocId(type, email, now = Date.now(), randomValue = '') {
  const normalizedEmail = normalizeAuthEmail(email);
  const suffix = String(randomValue || crypto.randomBytes(6).toString('hex')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  const recipientHash = crypto.createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 16);
  return `auth_${String(type || '').replace(/[^a-z_]/g, '').slice(0, 24)}_${recipientHash}_${Number(now)}_${suffix}`;
}

function buildAuthEmailRateLimitId(type, email, scope = '') {
  return crypto.createHash('sha256')
    .update(`${String(type || '').trim()}:${normalizeAuthEmail(email)}:${String(scope || '').trim()}`)
    .digest('hex');
}

function buildAuthEmailMailJob({ type, email, actionUrl, displayName = '', contextLabel = '', uid = null, inviteCodeId = null, now = new Date() } = {}) {
  const normalizedEmail = normalizeAuthEmail(email);
  if (!isValidAuthEmail(normalizedEmail)) {
    throw new Error('A valid authentication email recipient is required.');
  }
  const message = buildAuthEmailMessage({ type, actionUrl, displayName, contextLabel });
  return {
    to: [normalizedEmail],
    message,
    createdAt: now,
    metadata: {
      type: `auth_${type}`,
      authUserId: uid || null,
      inviteCodeId: inviteCodeId || null,
      provider: 'resend'
    }
  };
}

module.exports = {
  ALLPLAYS_ORIGIN,
  AUTH_EMAIL_TYPES,
  buildAuthEmailMailDocId,
  buildAuthEmailMailJob,
  buildAuthEmailMessage,
  buildAuthEmailRateLimitId,
  getAuthEmailActionSettings,
  getInviteContinueUrl,
  isValidAuthEmail,
  normalizeAuthEmail
};
