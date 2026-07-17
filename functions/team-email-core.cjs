function normalizeText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeRecipientSelector(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const separatorIndex = raw.indexOf(':');
  if (separatorIndex < 0) return raw;
  const kind = raw.slice(0, separatorIndex).trim().toLowerCase();
  const id = raw.slice(separatorIndex + 1).trim();
  if (!id) return '';
  if (kind === 'email') {
    const email = normalizeEmail(id);
    return email ? `email:${email}` : '';
  }
  if (kind === 'player' || kind === 'user') {
    return `${kind}:${id}`;
  }
  return raw;
}

function isEmailEnabledContact(contact = {}) {
  return contact.emailEnabled !== false &&
    contact.receiveEmail !== false &&
    contact.receivesEmail !== false &&
    contact.notificationsEnabled !== false &&
    contact.unsubscribed !== true;
}

function addRecipient(recipientsByEmail, email, metadata = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  if (!recipientsByEmail.has(normalizedEmail)) {
    recipientsByEmail.set(normalizedEmail, {
      email: normalizedEmail,
      playerIds: new Set(),
      userIds: new Set(),
      roles: new Set()
    });
  }
  const recipient = recipientsByEmail.get(normalizedEmail);
  if (metadata.playerId) recipient.playerIds.add(String(metadata.playerId));
  if (metadata.userId) recipient.userIds.add(String(metadata.userId));
  if (metadata.role) recipient.roles.add(String(metadata.role));
}

function addPlayerContacts(recipientsByEmail, player = {}) {
  if (player.active === false) return;
  const playerId = player.id || player.playerId || '';
  if (isEmailEnabledContact(player)) {
    addRecipient(recipientsByEmail, player.email, { playerId, userId: player.userId, role: 'player' });
  }
  const contacts = [
    ...(Array.isArray(player.parents) ? player.parents : []),
    ...(Array.isArray(player.guardians) ? player.guardians : []),
    ...(Array.isArray(player.familyContacts) ? player.familyContacts : [])
  ];
  contacts.forEach((contact) => {
    if (!isEmailEnabledContact(contact)) return;
    addRecipient(recipientsByEmail, contact.email, { playerId, userId: contact.userId, role: 'guardian' });
  });
}

function serializeRecipients(recipientsByEmail) {
  return Array.from(recipientsByEmail.values()).map((recipient) => ({
    email: recipient.email,
    playerIds: Array.from(recipient.playerIds).sort(),
    userIds: Array.from(recipient.userIds).sort(),
    roles: Array.from(recipient.roles).sort()
  })).sort((a, b) => a.email.localeCompare(b.email));
}

function resolveTeamEmailRecipients({ targetType = 'full_team', recipientIds = [], players = [], team = {}, ownerUser = null } = {}) {
  const recipientsByEmail = new Map();
  const selectedIds = new Set((Array.isArray(recipientIds) ? recipientIds : [])
    .map(normalizeRecipientSelector)
    .filter(Boolean));
  const activePlayers = players.filter((player) => player && player.active !== false);

  if (targetType === 'staff') {
    (Array.isArray(team.adminEmails) ? team.adminEmails : []).forEach((email) => {
      addRecipient(recipientsByEmail, email, { role: 'staff' });
    });
    if (ownerUser?.email) {
      addRecipient(recipientsByEmail, ownerUser.email, { userId: team.ownerId, role: 'owner' });
    }
    return serializeRecipients(recipientsByEmail);
  }

  if (targetType === 'individuals' && selectedIds.size > 0) {
    activePlayers.forEach((player) => {
      const playerId = String(player.id || player.playerId || '');
      const playerSelector = normalizeRecipientSelector(`player:${playerId}`);
      const playerSelected = selectedIds.has(playerSelector) || selectedIds.has(playerId);
      const matchingContacts = [];
      const contacts = [
        ...(Array.isArray(player.parents) ? player.parents : []),
        ...(Array.isArray(player.guardians) ? player.guardians : []),
        ...(Array.isArray(player.familyContacts) ? player.familyContacts : [])
      ];
      contacts.forEach((contact) => {
        const userId = contact?.userId ? normalizeRecipientSelector(`user:${contact.userId}`) : '';
        const email = contact?.email ? normalizeRecipientSelector(`email:${contact.email}`) : '';
        if (playerSelected || selectedIds.has(userId) || selectedIds.has(email)) {
          matchingContacts.push(contact);
        }
      });
      if (playerSelected) {
        addPlayerContacts(recipientsByEmail, player);
      } else {
        matchingContacts.forEach((contact) => {
          if (!isEmailEnabledContact(contact)) return;
          addRecipient(recipientsByEmail, contact.email, { playerId, userId: contact.userId, role: 'guardian' });
        });
      }
    });
    return serializeRecipients(recipientsByEmail);
  }

  activePlayers.forEach((player) => addPlayerContacts(recipientsByEmail, player));
  return serializeRecipients(recipientsByEmail);
}

function findUnknownTeamEmailRecipientIds({ recipientIds = [], players = [] } = {}) {
  const requestedIds = Array.from(new Set((Array.isArray(recipientIds) ? recipientIds : [])
    .map(normalizeRecipientSelector)
    .filter(Boolean)));
  const eligibleIds = new Set();

  players.filter((player) => player && player.active !== false).forEach((player) => {
    const playerId = String(player.id || player.playerId || '').trim();
    if (playerId) {
      eligibleIds.add(playerId);
      eligibleIds.add(`player:${playerId}`);
    }
    const contacts = [
      ...(Array.isArray(player.parents) ? player.parents : []),
      ...(Array.isArray(player.guardians) ? player.guardians : []),
      ...(Array.isArray(player.familyContacts) ? player.familyContacts : [])
    ];
    contacts.filter(isEmailEnabledContact).forEach((contact) => {
      const userId = String(contact?.userId || '').trim();
      const email = normalizeEmail(contact?.email);
      if (userId) {
        eligibleIds.add(userId);
        eligibleIds.add(`user:${userId}`);
      }
      if (email) eligibleIds.add(`email:${email}`);
    });
  });

  return requestedIds.filter((recipientId) => !eligibleIds.has(recipientId));
}

function buildVerifiedTeamEmailAttachmentRecord(attachment, objectMetadata) {
  const storagePath = String(attachment?.storagePath || '').trim();
  const objectName = String(objectMetadata?.name || '').trim();
  const size = Number(objectMetadata?.size);
  const contentType = String(objectMetadata?.contentType || 'application/octet-stream').trim();
  if (!storagePath || objectName !== storagePath || !Number.isFinite(size) || size <= 0 || contentType.length > 160) {
    throw new Error('Team email attachment metadata could not be verified.');
  }
  return {
    name: String(attachment?.name || '').trim(),
    storagePath,
    contentType,
    size
  };
}

function buildTeamEmailMailJob({ email, subject, body, teamId, messageId, senderUid, attachments = [], attachmentTotalBytes = 0 }) {
  const safeBody = normalizeText(body, 20000);
  const html = safeBody
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char])).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return {
    to: [email],
    message: {
      subject,
      text: safeBody,
      html
    },
    metadata: {
      teamId,
      teamEmailMessageId: messageId,
      type: 'team_email',
      senderUid,
      attachments,
      attachmentTotalBytes
    }
  };
}

module.exports = {
  normalizeText,
  normalizeEmail,
  isEmailEnabledContact,
  resolveTeamEmailRecipients,
  findUnknownTeamEmailRecipientIds,
  buildVerifiedTeamEmailAttachmentRecord,
  buildTeamEmailMailJob
};
