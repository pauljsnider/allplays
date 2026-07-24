'use strict';

const crypto = require('node:crypto');

const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';
const ACCOUNT_DELETION_MAX_DAYS = 30;
const ACCOUNT_DELETION_MAX_AUTH_AGE_SECONDS = 5 * 60;

function normalizeConfirmation(value) {
  return String(value || '').trim().toUpperCase();
}

function buildDeletionAuditId(uid) {
  return crypto.createHash('sha256').update(String(uid || '')).digest('hex');
}

function shouldProcessAccountDeletionRequest(beforeSnapshot, afterSnapshot) {
  if (!afterSnapshot?.exists) return false;
  const beforeStatus = String(beforeSnapshot?.data?.()?.status || '').trim().toLowerCase();
  const afterStatus = String(afterSnapshot.data()?.status || '').trim().toLowerCase();
  return afterStatus === 'queued' && beforeStatus !== 'queued';
}

function extractFirebaseStoragePath(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';

  try {
    const url = new URL(rawValue);
    if (url.hostname === 'firebasestorage.googleapis.com') {
      const match = url.pathname.match(/\/o\/(.+)$/);
      return match ? decodeURIComponent(match[1]) : '';
    } else if (url.hostname === 'storage.googleapis.com') {
      const pathParts = url.pathname.split('/').filter(Boolean);
      return pathParts.slice(1).join('/');
    }
  } catch {
    return '';
  }
  return '';
}

function extractAccountProfileStoragePath(value, uid) {
  const storagePath = extractFirebaseStoragePath(value);
  const normalizedUid = String(uid || '').trim();
  const scopedPrefix = `user-photos/${normalizedUid}/`;
  if (normalizedUid && storagePath.startsWith(scopedPrefix)) return storagePath;
  return '';
}

function getLegacyUnscopedProfilePhotoPaths(profilePhotoUrls = []) {
  return [...new Set(profilePhotoUrls.map((value) => {
    const storagePath = extractFirebaseStoragePath(value);
    const pathParts = storagePath.split('/');
    return pathParts.length === 2 && pathParts[0] === 'user-photos' ? storagePath : '';
  }).filter(Boolean))];
}

function collectAccountRosterScopes(userData = {}) {
  const normalizeDocumentId = (value) => {
    const normalized = String(value || '').trim();
    return normalized && normalized.length <= 200 && !normalized.includes('/') ? normalized : '';
  };
  const playerPaths = new Set();
  const teamIds = new Set(
    (Array.isArray(userData.parentTeamIds) ? userData.parentTeamIds : [])
      .map(normalizeDocumentId)
      .filter(Boolean)
  );
  (Array.isArray(userData.parentOf) ? userData.parentOf : []).forEach((link) => {
    const teamId = normalizeDocumentId(link?.teamId);
    const playerId = normalizeDocumentId(link?.playerId);
    if (teamId) teamIds.add(teamId);
    if (teamId && playerId) playerPaths.add(`teams/${teamId}/players/${playerId}`);
  });
  (Array.isArray(userData.parentPlayerKeys) ? userData.parentPlayerKeys : []).forEach((key) => {
    const [rawTeamId, rawPlayerId] = String(key || '').split('::');
    const teamId = normalizeDocumentId(rawTeamId);
    const playerId = normalizeDocumentId(rawPlayerId);
    if (teamId) teamIds.add(teamId);
    if (teamId && playerId) playerPaths.add(`teams/${teamId}/players/${playerId}`);
  });
  return {
    playerPaths: [...playerPaths],
    teamIds: [...teamIds]
  };
}

function getParentContactUserId(parent = {}) {
  return String(
    parent.userId ||
    parent.uid ||
    parent.parentUserId ||
    parent.accountUserId ||
    parent.guardianUserId ||
    ''
  ).trim();
}

function normalizeRosterContactIdentity(identity) {
  const source = typeof identity === 'string' ? { uid: identity } : (identity || {});
  return {
    uid: String(source.uid || '').trim(),
    email: String(source.email || '').trim().toLowerCase(),
    phone: String(source.phone || source.phoneNumber || '').replace(/\D/g, '')
  };
}

function matchesRosterContactIdentity(contact = {}, identity = {}) {
  const contactUid = getParentContactUserId(contact);
  const contactEmail = String(
    contact.email || contact.emailAddress || contact.parentEmail || contact.guardianEmail || ''
  ).trim().toLowerCase();
  const contactPhone = String(
    contact.phone || contact.phoneNumber || contact.parentPhone || contact.guardianPhone || ''
  ).replace(/\D/g, '');
  if (contactUid) {
    return Boolean(identity.uid && contactUid === identity.uid);
  }
  if (contactEmail) {
    return Boolean(identity.email && contactEmail === identity.email);
  }
  return Boolean(identity.phone.length >= 7 && contactPhone === identity.phone);
}

function buildRosterParentScrubPlan(record = {}, accountIdentity) {
  const identity = normalizeRosterContactIdentity(accountIdentity);
  if (!identity.uid && !identity.email && !identity.phone) {
    return {
      changed: false,
      contacts: [],
      contactsChanged: false,
      familyContacts: [],
      familyContactsChanged: false,
      guardians: [],
      guardiansChanged: false,
      parents: [],
      parentsChanged: false,
      fieldsToDelete: []
    };
  }
  const parents = Array.isArray(record.parents) ? record.parents : [];
  const contacts = Array.isArray(record.contacts) ? record.contacts : [];
  const guardians = Array.isArray(record.guardians) ? record.guardians : [];
  const familyContacts = Array.isArray(record.familyContacts) ? record.familyContacts : [];
  const filteredParents = parents.filter((parent) => !matchesRosterContactIdentity(parent, identity));
  const filteredContacts = contacts.filter((contact) => !matchesRosterContactIdentity(contact, identity));
  const filteredGuardians = guardians.filter((guardian) => !matchesRosterContactIdentity(guardian, identity));
  const filteredFamilyContacts = familyContacts.filter((contact) => !matchesRosterContactIdentity(contact, identity));
  const parentsChanged = filteredParents.length !== parents.length;
  const contactsChanged = filteredContacts.length !== contacts.length;
  const guardiansChanged = filteredGuardians.length !== guardians.length;
  const familyContactsChanged = filteredFamilyContacts.length !== familyContacts.length;
  const fieldsToDelete = [];
  if (matchesRosterContactIdentity({
    userId: record.parentUserId,
    email: record.parentEmail,
    phone: record.parentPhone
  }, identity)) {
    fieldsToDelete.push('parentUserId', 'parentEmail', 'parentName', 'parentPhone', 'parentRelation');
  }
  if (matchesRosterContactIdentity({
    userId: record.guardianUserId,
    email: record.guardianEmail,
    phone: record.guardianPhone
  }, identity)) {
    fieldsToDelete.push('guardianUserId', 'guardianEmail', 'guardianName', 'guardianPhone', 'guardianRelation');
  }
  return {
    changed: parentsChanged || contactsChanged || guardiansChanged || familyContactsChanged ||
      fieldsToDelete.length > 0,
    contacts: filteredContacts,
    contactsChanged,
    familyContacts: filteredFamilyContacts,
    familyContactsChanged,
    guardians: filteredGuardians,
    guardiansChanged,
    parents: filteredParents,
    parentsChanged,
    fieldsToDelete
  };
}

function getAccountEmailQueryCandidates(email) {
  const original = String(email || '').trim();
  const normalized = original.toLowerCase();
  return [...new Set([
    original,
    normalized,
    ` ${original}`,
    `${original} `,
    ` ${original} `,
    ` ${normalized}`,
    `${normalized} `,
    ` ${normalized} `
  ].filter((value) => value.trim()))];
}

function collectAccountTeamIds(userData = {}) {
  const teamIds = new Set();
  ['coachOf', 'parentTeamIds', 'teamMediaUploadTeamIds', 'mediaUploadTeamIds'].forEach((field) => {
    (Array.isArray(userData[field]) ? userData[field] : []).forEach((value) => {
      const normalized = String(value || '').trim();
      if (normalized && normalized.length <= 200 && !normalized.includes('/')) teamIds.add(normalized);
    });
  });
  return [...teamIds];
}

function buildTeamAccountGrantScrubPlan(team = {}, accountIdentity) {
  const identity = normalizeRosterContactIdentity(accountIdentity);
  const update = {};
  const fieldsToDelete = [];
  const filterEmailArray = (field) => {
    if (!Array.isArray(team[field]) || !identity.email) return;
    const filtered = team[field].filter((value) => String(value || '').trim().toLowerCase() !== identity.email);
    if (filtered.length !== team[field].length) update[field] = filtered;
  };
  const filterUidArray = (field) => {
    if (!Array.isArray(team[field]) || !identity.uid) return;
    const filtered = team[field].filter((value) => String(value || '').trim() !== identity.uid);
    if (filtered.length !== team[field].length) update[field] = filtered;
  };
  filterEmailArray('adminEmails');
  filterEmailArray('streamVolunteerEmails');
  ['adminIds', 'coachIds', 'staffIds', 'managerIds'].forEach(filterUidArray);
  ['admins', 'coaches', 'staff'].forEach((field) => {
    if (!Array.isArray(team[field])) return;
    const filtered = team[field].filter((entry) => {
      if (typeof entry === 'string') return String(entry).trim() !== identity.uid;
      return !matchesRosterContactIdentity(entry, identity);
    });
    if (filtered.length !== team[field].length) update[field] = filtered;
  });
  if (team.teamPermissions && typeof team.teamPermissions === 'object') {
    const nextPermissions = {};
    let permissionsChanged = false;
    Object.entries(team.teamPermissions).forEach(([key, permission]) => {
      if (!permission || typeof permission !== 'object' || !Array.isArray(permission.memberIds)) {
        nextPermissions[key] = permission;
        return;
      }
      const memberIds = permission.memberIds.filter((value) => String(value || '').trim() !== identity.uid);
      nextPermissions[key] = memberIds.length === permission.memberIds.length
        ? permission
        : { ...permission, memberIds };
      permissionsChanged ||= memberIds.length !== permission.memberIds.length;
    });
    if (permissionsChanged) update.teamPermissions = nextPermissions;
  }
  if (
    (identity.uid && String(team.ownerId || '').trim() === identity.uid) ||
    (identity.email && [team.ownerEmail, team.ownerEmailLower]
      .some((value) => String(value || '').trim().toLowerCase() === identity.email))
  ) {
    fieldsToDelete.push('ownerId', 'ownerEmail', 'ownerEmailLower');
  }
  return {
    changed: Object.keys(update).length > 0 || fieldsToDelete.length > 0,
    update,
    fieldsToDelete
  };
}

function buildChatConversationAccountScrubPlan(conversation = {}, accountIdentity) {
  const identity = normalizeRosterContactIdentity(accountIdentity);
  const update = {};
  const fieldsToDelete = [];
  const matchesParticipant = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    if (identity.uid && (normalized === identity.uid || normalized === `user:${identity.uid}`)) return true;
    return Boolean(
      identity.email &&
      normalized.toLowerCase() === `email:${identity.email}`
    );
  };
  const filterIdentityArray = (field) => {
    if (!Array.isArray(conversation[field])) return;
    const filtered = conversation[field].filter((value) => !matchesParticipant(value));
    if (filtered.length !== conversation[field].length) update[field] = filtered;
  };

  filterIdentityArray('participantIds');
  filterIdentityArray('directUserIds');
  filterIdentityArray('mutedBy');
  if (identity.uid && String(conversation.initiatedBy || '').trim() === identity.uid) {
    fieldsToDelete.push('initiatedBy');
  }
  const friendshipIds = String(conversation.friendshipId || '').split('__').map((value) => value.trim());
  if (identity.uid && friendshipIds.includes(identity.uid)) fieldsToDelete.push('friendshipId');

  return {
    changed: Object.keys(update).length > 0 || fieldsToDelete.length > 0,
    update,
    fieldsToDelete
  };
}

function buildRegistrationAccountScrubPlan(registration = {}, accountIdentity) {
  const identity = normalizeRosterContactIdentity(accountIdentity);
  const update = {};
  const fieldsToDelete = [];
  const submittedByMatches = Boolean(
    (identity.uid && [
      registration.submittedByUserId,
      registration.submittedBy,
      registration.submittedByUid
    ].some((value) => String(value || '').trim() === identity.uid)) ||
    (identity.email && String(registration.submittedByEmail || '').trim().toLowerCase() === identity.email)
  );
  const guardianMatches = matchesRosterContactIdentity(registration.guardian || {}, identity);
  const topLevelGuardianMatches = matchesRosterContactIdentity({
    userId: registration.guardianUserId,
    email: registration.guardianEmail,
    phone: registration.guardianPhone
  }, identity);

  if (guardianMatches) update.guardian = { redacted: true };
  if (Array.isArray(registration.guardians)) {
    const guardians = registration.guardians.filter((guardian) => (
      !matchesRosterContactIdentity(guardian, identity)
    ));
    if (guardians.length !== registration.guardians.length) update.guardians = guardians;
  }
  if (submittedByMatches) {
    fieldsToDelete.push('submittedByUserId', 'submittedBy', 'submittedByUid', 'submittedByEmail', 'submittedByName');
  }
  if (topLevelGuardianMatches) {
    fieldsToDelete.push('guardianUserId', 'guardianEmail', 'guardianName', 'guardianPhone', 'guardianRelation');
  }

  return {
    changed: Object.keys(update).length > 0 || fieldsToDelete.length > 0,
    update,
    fieldsToDelete
  };
}

function classifyAccountStoragePaths(uid, mediaStoragePaths = [], profilePhotoUrls = []) {
  const normalizedUid = String(uid || '').trim();
  const athletePrefix = `athlete-profile-media/${normalizedUid}/`;
  const primaryPaths = new Set();
  const imagePaths = new Set(
    profilePhotoUrls.map((url) => extractAccountProfileStoragePath(url, uid)).filter(Boolean)
  );

  mediaStoragePaths.forEach((value) => {
    const rawValue = String(value || '').trim();
    const storagePath = extractFirebaseStoragePath(rawValue) || rawValue;
    if (storagePath.startsWith(`primary://${athletePrefix}`)) {
      primaryPaths.add(storagePath.slice('primary://'.length));
    } else if (storagePath.startsWith(athletePrefix)) {
      imagePaths.add(storagePath);
    } else {
      const primaryStoragePath = storagePath.startsWith('primary://')
        ? storagePath.slice('primary://'.length)
        : storagePath;
      const pathParts = primaryStoragePath.split('/');
      if (
        normalizedUid &&
        pathParts.length >= 5 &&
        pathParts[0] === 'team-media' &&
        pathParts[3] === normalizedUid
      ) {
        primaryPaths.add(primaryStoragePath);
      } else if (
        normalizedUid &&
        pathParts.length >= 6 &&
        pathParts[0] === 'stat-sheets' &&
        pathParts[1] === 'team-chat' &&
        pathParts[4] === normalizedUid
      ) {
        primaryPaths.add(primaryStoragePath);
      } else if (
        normalizedUid &&
        pathParts.length >= 5 &&
        pathParts[0] === 'stat-sheets' &&
        pathParts[1] === 'team-chat' &&
        pathParts[3] === normalizedUid
      ) {
        primaryPaths.add(primaryStoragePath);
      }
    }
  });
  return {
    primaryPaths: [...primaryPaths],
    imagePaths: [...imagePaths]
  };
}

function collectAccountMediaStoragePaths(mediaRecords = []) {
  return mediaRecords.flatMap((record) => {
    const attachments = Array.isArray(record?.attachments) ? record.attachments : [];
    const media = Array.isArray(record?.media) ? record.media : [];
    return [
      record?.storagePath,
      record?.path,
      record?.imagePath,
      ...attachments.flatMap((attachment) => [
        attachment?.storagePath,
        attachment?.path,
        attachment?.url,
        attachment?.thumbnailUrl
      ]),
      ...media.flatMap((item) => [
        item?.storagePath,
        item?.path,
        item?.url,
        item?.thumbnailUrl
      ])
    ].map((value) => String(value || '').trim()).filter(Boolean);
  });
}

function getAccountTeamPermissionQueryFields() {
  return [
    'teamPermissions.scorekeeping.memberIds',
    'teamPermissions.streaming.memberIds',
    'teamPermissions.videography.memberIds',
    'teamPermissions.teamMediaManagement.memberIds'
  ];
}

function getAccountDeletionCollectionQueries() {
  return [
    ['socialPosts', 'authorId', '=='],
    ['socialReports', 'reporterId', '=='],
    ['friendships', 'memberIds', 'array-contains'],
    ['publicOpportunities', 'ownerUserId', '=='],
    ['publicOpportunities', 'createdBy', '=='],
    ['publicOpportunities', 'authorId', '=='],
    ['publicOpportunityReports', 'reporterId', '=='],
    ['opportunityInquiries', 'senderId', '=='],
    ['opportunityInquiries', 'participantIds', 'array-contains'],
    ['opportunityInquiries', 'recipientUserIds', 'array-contains'],
    ['athleteProfiles', 'parentUserId', '=='],
    ['accountMergeRequests', 'requestedBy', '=='],
    ['familyShareTokens', 'ownerUserId', '=='],
    ['accessCodes', 'generatedBy', '=='],
    ['accessCodes', 'usedBy', '==']
  ];
}

function getAccountDeletionCollectionGroupQueries() {
  return [
    ['messages', 'authorId'],
    ['chatMessages', 'senderId'],
    ['comments', 'authorId'],
    ['reactions', 'userId'],
    ['rsvps', 'userId'],
    ['rideOffers', 'driverUserId'],
    ['rideRequests', 'parentUserId'],
    ['media', 'uploadedBy'],
    ['mediaItems', 'uploadedBy'],
    ['membershipRequests', 'requesterUserId'],
    ['notificationTargets', 'uid'],
    ['notificationRecipients', 'uid']
  ];
}

function assertDeletionRequest(data, HttpsError) {
  if (normalizeConfirmation(data?.confirmation) !== ACCOUNT_DELETION_CONFIRMATION) {
    throw new HttpsError('invalid-argument', `Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm permanent account deletion.`);
  }
}

function hasRecentAuthentication(context, nowSeconds = Math.floor(Date.now() / 1000)) {
  const authTime = Number(context?.auth?.token?.auth_time);
  return (
    Number.isFinite(authTime) &&
    authTime > 0 &&
    nowSeconds - authTime <= ACCOUNT_DELETION_MAX_AUTH_AGE_SECONDS &&
    authTime - nowSeconds <= 60
  );
}

function assertRecentAuthentication(context, HttpsError, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!hasRecentAuthentication(context, nowSeconds)) {
    throw new HttpsError(
      'failed-precondition',
      'For your security, sign in again before permanently deleting your account.'
    );
  }
}

function summarizeOwnedTeams(snapshot) {
  const seenTeamIds = new Set();
  return (snapshot?.docs || [])
    .filter((doc) => doc.data()?.active !== false)
    .filter((doc) => {
      if (seenTeamIds.has(doc.id)) return false;
      seenTeamIds.add(doc.id);
      return true;
    })
    .map((doc) => ({
      id: doc.id,
      name: String(doc.data()?.name || doc.id)
    }));
}

function accountUsesAppleProvider(userRecord = {}, authToken = {}) {
  return Boolean(
    (userRecord.providerData || []).some((provider) => provider?.providerId === 'apple.com') ||
    authToken.firebase?.sign_in_provider === 'apple.com'
  );
}

function getAccountReauthenticationProvider(userRecord = {}, authToken = {}) {
  const providerIds = new Set(
    (userRecord.providerData || [])
      .map((provider) => String(provider?.providerId || '').trim())
      .filter(Boolean)
  );
  const signInProvider = String(authToken.firebase?.sign_in_provider || '').trim();
  if (signInProvider) providerIds.add(signInProvider);
  if (providerIds.has('apple.com')) return 'apple';
  if (providerIds.has('google.com')) return 'google';
  if (providerIds.has('password')) return 'password';
  return 'unknown';
}

async function loadOwnedTeams({ firestore, uid, email }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const emailCandidates = getAccountEmailQueryCandidates(email);
  const queries = [
    firestore.collection('teams').where('ownerId', '==', uid).get()
  ];
  if (normalizedEmail) {
    queries.push(firestore.collection('teams').where('ownerEmailLower', '==', normalizedEmail).get());
    emailCandidates.forEach((candidate) => {
      queries.push(firestore.collection('teams').where('ownerEmail', '==', candidate).get());
    });
  }

  const snapshots = await Promise.all(queries);
  return summarizeOwnedTeams({
    docs: snapshots.flatMap((snapshot) => snapshot.docs || [])
  });
}

function createAccountDeletionRequestHandler({ firestore, auth, Timestamp, HttpsError }) {
  return async (data, context = {}) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in before requesting account deletion.');
    }
    assertDeletionRequest(data, HttpsError);

    const userRecord = await auth.getUser(uid).catch(() => null);
    if (!hasRecentAuthentication(context)) {
      return {
        success: false,
        status: 'requires-recent-auth',
        provider: getAccountReauthenticationProvider(userRecord, context.auth?.token),
        completionTargetDays: ACCOUNT_DELETION_MAX_DAYS
      };
    }
    const accountEmail = userRecord?.email || context.auth?.token?.email || '';
    const ownedTeams = await loadOwnedTeams({ firestore, uid, email: accountEmail });
    if (ownedTeams.length) {
      throw new HttpsError(
        'failed-precondition',
        'Transfer ownership or deactivate every team you own before deleting your account.',
        { ownedTeams }
      );
    }
    const userDoc = await firestore.doc(`users/${uid}`).get();
    const legacyProfilePhotoPaths = getLegacyUnscopedProfilePhotoPaths([
      userDoc.data()?.photoUrl,
      userRecord?.photoURL
    ]);
    if (legacyProfilePhotoPaths.length) {
      throw new HttpsError(
        'failed-precondition',
        'Your legacy profile photo must be migrated before account deletion can complete. Contact support.',
        { reason: 'legacy-profile-photo-migration-required' }
      );
    }

    if (accountUsesAppleProvider(userRecord, context.auth?.token) && data?.appleAuthorizationRevoked !== true) {
      return {
        success: false,
        status: 'requires-apple-reauth',
        completionTargetDays: ACCOUNT_DELETION_MAX_DAYS
      };
    }

    const now = Timestamp.now();
    await firestore.doc(`accountDeletionRequests/${uid}`).set({
      uid,
      requestedAt: now,
      updatedAt: now,
      status: 'queued',
      email: String(userRecord?.email || context.auth?.token?.email || '').trim().toLowerCase(),
      source: String(data?.source || 'app').slice(0, 40),
      appleAuthorizationRevoked: data?.appleAuthorizationRevoked === true,
      completionTargetDays: ACCOUNT_DELETION_MAX_DAYS
    }, { merge: true });

    return {
      success: true,
      status: 'queued',
      completionTargetDays: ACCOUNT_DELETION_MAX_DAYS
    };
  };
}

module.exports = {
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_MAX_AUTH_AGE_SECONDS,
  ACCOUNT_DELETION_MAX_DAYS,
  accountUsesAppleProvider,
  assertDeletionRequest,
  assertRecentAuthentication,
  buildChatConversationAccountScrubPlan,
  buildDeletionAuditId,
  buildRegistrationAccountScrubPlan,
  buildRosterParentScrubPlan,
  buildTeamAccountGrantScrubPlan,
  classifyAccountStoragePaths,
  collectAccountRosterScopes,
  collectAccountTeamIds,
  collectAccountMediaStoragePaths,
  createAccountDeletionRequestHandler,
  extractAccountProfileStoragePath,
  getAccountEmailQueryCandidates,
  getAccountReauthenticationProvider,
  getAccountTeamPermissionQueryFields,
  getLegacyUnscopedProfilePhotoPaths,
  getAccountDeletionCollectionQueries,
  getAccountDeletionCollectionGroupQueries,
  loadOwnedTeams,
  hasRecentAuthentication,
  normalizeConfirmation,
  shouldProcessAccountDeletionRequest,
  summarizeOwnedTeams
};
