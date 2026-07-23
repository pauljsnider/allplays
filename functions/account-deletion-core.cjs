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

function extractLegacyAccountProfileStoragePath(value) {
  const storagePath = extractFirebaseStoragePath(value);
  const pathParts = storagePath.split('/');
  return pathParts.length === 2 && pathParts[0] === 'user-photos' ? storagePath : '';
}

function getDeletableLegacyProfilePhotoPaths(uid, profilePhotoUrls = [], userDocuments = []) {
  const candidates = new Set(
    profilePhotoUrls.map(extractLegacyAccountProfileStoragePath).filter(Boolean)
  );
  userDocuments.forEach((document) => {
    if (document.id === uid) return;
    const referencedPath = extractLegacyAccountProfileStoragePath(document.data()?.photoUrl);
    if (referencedPath) candidates.delete(referencedPath);
  });
  return [...candidates];
}

function classifyAccountStoragePaths(uid, mediaStoragePaths = [], profilePhotoUrls = []) {
  const normalizedUid = String(uid || '').trim();
  const athletePrefix = `athlete-profile-media/${normalizedUid}/`;
  const primaryPaths = new Set();
  const imagePaths = new Set(
    profilePhotoUrls.map((url) => extractAccountProfileStoragePath(url, uid)).filter(Boolean)
  );

  mediaStoragePaths.forEach((value) => {
    const storagePath = String(value || '').trim();
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
    return [
      record?.storagePath,
      record?.path,
      record?.imagePath,
      ...attachments.flatMap((attachment) => [attachment?.storagePath, attachment?.path])
    ].map((value) => String(value || '').trim()).filter(Boolean);
  });
}

function getAccountDeletionCollectionQueries() {
  return [
    ['socialPosts', 'authorId', '=='],
    ['socialReports', 'reporterId', '=='],
    ['friendships', 'memberIds', 'array-contains'],
    ['publicOpportunities', 'ownerUserId', '=='],
    ['publicOpportunities', 'createdBy', '=='],
    ['publicOpportunityReports', 'reporterId', '=='],
    ['opportunityInquiries', 'senderId', '=='],
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
    ['notificationTargets', 'uid'],
    ['notificationRecipients', 'uid']
  ];
}

function assertDeletionRequest(data, HttpsError) {
  if (normalizeConfirmation(data?.confirmation) !== ACCOUNT_DELETION_CONFIRMATION) {
    throw new HttpsError('invalid-argument', `Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm permanent account deletion.`);
  }
}

function assertRecentAuthentication(context, HttpsError, nowSeconds = Math.floor(Date.now() / 1000)) {
  const authTime = Number(context?.auth?.token?.auth_time);
  if (
    !Number.isFinite(authTime) ||
    authTime <= 0 ||
    nowSeconds - authTime > ACCOUNT_DELETION_MAX_AUTH_AGE_SECONDS ||
    authTime - nowSeconds > 60
  ) {
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

async function loadOwnedTeams({ firestore, uid, email }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const emailCandidates = [...new Set([
    String(email || '').trim(),
    normalizedEmail
  ].filter(Boolean))];
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
    assertRecentAuthentication(context, HttpsError);
    assertDeletionRequest(data, HttpsError);

    const userRecord = await auth.getUser(uid).catch(() => null);
    const accountEmail = userRecord?.email || context.auth?.token?.email || '';
    const ownedTeams = await loadOwnedTeams({ firestore, uid, email: accountEmail });
    if (ownedTeams.length) {
      throw new HttpsError(
        'failed-precondition',
        'Transfer ownership or deactivate every team you own before deleting your account.',
        { ownedTeams }
      );
    }

    const now = Timestamp.now();
    await firestore.doc(`accountDeletionRequests/${uid}`).set({
      uid,
      requestedAt: now,
      updatedAt: now,
      status: 'queued',
      email: String(userRecord?.email || context.auth?.token?.email || '').trim().toLowerCase(),
      source: String(data?.source || 'app').slice(0, 40),
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
  assertDeletionRequest,
  assertRecentAuthentication,
  buildDeletionAuditId,
  classifyAccountStoragePaths,
  collectAccountMediaStoragePaths,
  createAccountDeletionRequestHandler,
  extractAccountProfileStoragePath,
  extractLegacyAccountProfileStoragePath,
  getDeletableLegacyProfilePhotoPaths,
  getAccountDeletionCollectionQueries,
  getAccountDeletionCollectionGroupQueries,
  loadOwnedTeams,
  normalizeConfirmation,
  shouldProcessAccountDeletionRequest,
  summarizeOwnedTeams
};
