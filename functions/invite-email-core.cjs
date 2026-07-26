'use strict';

const ALLPLAYS_ORIGIN = 'https://allplays.ai';

function normalizeInviteEmailType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'parent_invite') return 'parent';
  if (type === 'household_invite') return 'household';
  if (type === 'coparent_invite') return 'coparent';
  return '';
}

function isValidInviteRecipientEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInviteSignupUrl(code, inviteType, origin = ALLPLAYS_ORIGIN) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  const normalizedType = normalizeInviteEmailType(inviteType);
  if (!normalizedCode || !normalizedType) return '';
  const url = new URL('/accept-invite.html', origin);
  url.searchParams.set('code', normalizedCode);
  url.searchParams.set('type', normalizedType);
  return url.toString();
}

function buildLinkedTeamUrl(teamId, origin = ALLPLAYS_ORIGIN) {
  const normalizedTeamId = String(teamId || '').trim();
  const url = new URL('/app/', origin);
  url.hash = `/teams/${encodeURIComponent(normalizedTeamId)}`;
  return url.toString();
}

function isLinkedParentInvite(invite = {}) {
  if (normalizeInviteEmailType(invite.type) !== 'parent') return false;
  const status = String(invite.status || '').trim().toLowerCase();
  return invite.autoAccepted === true
    || (invite.used === true && status === 'accepted' && Boolean(String(invite.usedBy || '').trim()));
}

function shouldQueueInviteEmailOnCreate(invite = {}) {
  const inviteType = normalizeInviteEmailType(invite.type);
  return inviteType !== 'parent'
    && Boolean(inviteType)
    && isValidInviteRecipientEmail(invite.email);
}

function buildParentInviteEmailMessage(invite = {}, origin = ALLPLAYS_ORIGIN) {
  const code = String(invite.code || '').trim().toUpperCase();
  const inviteType = normalizeInviteEmailType(invite.type);
  const signupUrl = buildInviteSignupUrl(code, invite.type, origin);
  if (!code || !inviteType || !signupUrl) {
    throw new Error('A supported invite type and code are required.');
  }

  const playerName = String(invite.playerName || '').trim() || 'a player';
  const teamName = String(invite.teamName || '').trim();
  const relation = String(invite.relation || '').trim();
  if (isLinkedParentInvite(invite)) {
    const linkedTeamUrl = buildLinkedTeamUrl(invite.teamId, origin);
    const context = teamName ? `${playerName} on ${teamName}` : playerName;
    const subject = `You're connected to ${playerName} on ALL PLAYS`;
    const intro = `Your ALL PLAYS account was linked to ${context}${relation ? ` as ${relation}` : ''}.`;
    const text = [
      intro,
      '',
      `Open ALL PLAYS: ${linkedTeamUrl}`,
      '',
      'No acceptance step or invite code is needed.'
    ].join('\n');
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:560px;margin:0 auto">
        <h1 style="font-size:24px;margin:0 0 16px">You're connected on ALL PLAYS</h1>
        <p>${escapeHtml(intro)}</p>
        <p><a href="${escapeHtml(linkedTeamUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700">Open ALL PLAYS</a></p>
        <p style="font-size:13px;color:#4b5563">No acceptance step or invite code is needed.</p>
      </div>
    `.trim();
    return {
      subject,
      text,
      html,
      signupUrl: linkedTeamUrl,
      inviteType,
      messageKind: 'linked'
    };
  }
  const isHouseholdInvite = inviteType === 'household';
  const isCoParentInvite = inviteType === 'coparent';
  const subject = isHouseholdInvite
    ? `You're invited to help with ${playerName} on ALL PLAYS`
    : isCoParentInvite
      ? `You're invited to co-parent ${playerName} on ALL PLAYS`
      : `You're invited to follow ${playerName} on ALL PLAYS`;
  const context = teamName ? `${playerName} on ${teamName}` : playerName;
  const intro = isHouseholdInvite
    ? `A parent invited you to connect with ${context}${relation ? ` as ${relation}` : ''}.`
    : isCoParentInvite
      ? `A parent invited you to connect with ${context} as a co-parent.`
    : `A coach invited you to connect with ${context}${relation ? ` as ${relation}` : ''}.`;
  const text = [
    intro,
    '',
    `Invite code: ${code}`,
    `Sign up or accept the invite: ${signupUrl}`,
    '',
    'This invite expires in 7 days. If you already have an ALL PLAYS account, use the same email address that received this message.'
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:560px;margin:0 auto">
      <h1 style="font-size:24px;margin:0 0 16px">You're invited to ALL PLAYS</h1>
      <p>${escapeHtml(intro)}</p>
      <div style="margin:24px 0;padding:16px;border-radius:10px;background:#f3f4f6">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#4b5563">Invite code</div>
        <div style="font-family:monospace;font-size:24px;font-weight:700;letter-spacing:2px;color:#111827">${escapeHtml(code)}</div>
      </div>
      <p><a href="${escapeHtml(signupUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700">Sign up or accept invite</a></p>
      <p style="font-size:13px;color:#4b5563">This invite expires in 7 days. If you already have an ALL PLAYS account, use the same email address that received this message.</p>
      <p style="font-size:12px;color:#6b7280;word-break:break-all">${escapeHtml(signupUrl)}</p>
    </div>
  `.trim();

  return { subject, text, html, signupUrl, inviteType, messageKind: 'invite' };
}

module.exports = {
  ALLPLAYS_ORIGIN,
  buildInviteSignupUrl,
  buildLinkedTeamUrl,
  buildParentInviteEmailMessage,
  isValidInviteRecipientEmail,
  isLinkedParentInvite,
  normalizeInviteEmailType,
  shouldQueueInviteEmailOnCreate
};
