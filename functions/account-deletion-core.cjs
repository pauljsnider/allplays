'use strict';

const crypto = require('node:crypto');

const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';
const ACCOUNT_DELETION_MAX_DAYS = 30;

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

function extractAccountProfileStoragePath(value, uid) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';

  let storagePath = '';
  try {
    const url = new URL(rawValue);
    if (url.hostname === 'firebasestorage.googleapis.com') {
      const match = url.pathname.match(/\/o\/(.+)$/);
      storagePath = match ? decodeURIComponent(match[1]) : '';
    } else if (url.hostname === 'storage.googleapis.com') {
      const pathParts = url.pathname.split('/').filter(Boolean);
      storagePath = pathParts.slice(1).join('/');
    }
  } catch {
    return '';
  }

  const normalizedUid = String(uid || '').trim();
  const scopedPrefix = `user-photos/${normalizedUid}/`;
  if (normalizedUid && storagePath.startsWith(scopedPrefix)) return storagePath;
  if (/^user-photos\/[^/]+$/.test(storagePath)) return storagePath;
  return '';
}

function assertDeletionRequest(data, HttpsError) {
  if (normalizeConfirmation(data?.confirmation) !== ACCOUNT_DELETION_CONFIRMATION) {
    throw new HttpsError('invalid-argument', `Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm permanent account deletion.`);
  }
}

function summarizeOwnedTeams(snapshot) {
  return (snapshot?.docs || [])
    .filter((doc) => doc.data()?.active !== false)
    .map((doc) => ({
      id: doc.id,
      name: String(doc.data()?.name || doc.id)
    }));
}

function createAccountDeletionRequestHandler({ firestore, auth, Timestamp, HttpsError }) {
  return async (data, context = {}) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in before requesting account deletion.');
    }
    assertDeletionRequest(data, HttpsError);

    const ownedTeams = summarizeOwnedTeams(
      await firestore.collection('teams').where('ownerId', '==', uid).get()
    );
    if (ownedTeams.length) {
      throw new HttpsError(
        'failed-precondition',
        'Transfer ownership or deactivate every team you own before deleting your account.',
        { ownedTeams }
      );
    }

    const userRecord = await auth.getUser(uid).catch(() => null);
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
  ACCOUNT_DELETION_MAX_DAYS,
  assertDeletionRequest,
  buildDeletionAuditId,
  createAccountDeletionRequestHandler,
  extractAccountProfileStoragePath,
  normalizeConfirmation,
  shouldProcessAccountDeletionRequest,
  summarizeOwnedTeams
};
