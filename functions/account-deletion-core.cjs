'use strict';

const crypto = require('node:crypto');
const diamondDomainEngine = require('./diamond-engine');
const diamondPrivateNoteCore = require('./diamond-private-note-core.cjs');

const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';
const ACCOUNT_DELETION_MAX_DAYS = 30;
const ACCOUNT_DELETION_MAX_AUTH_AGE_SECONDS = 5 * 60;
const ACCOUNT_MEDIA_CLEANUP_PAGE_SIZE = 250;
const ACCOUNT_STORAGE_DELETE_CONCURRENCY = 10;
const ACCOUNT_CALENDAR_CREDENTIAL_PAGE_SIZE = 250;
const ACCOUNT_CALENDAR_CREDENTIAL_TRANSACTION_SIZE = 100;
const ACCOUNT_REPLAY_ARCHIVE_ATTRIBUTION_FIELDS = Object.freeze(['linkedBy', 'updatedBy']);
const ACCOUNT_REPLAY_ARCHIVE_PAGE_SIZE = 250;
const ACCOUNT_REPLAY_ARCHIVE_TRANSACTION_SIZE = 100;
const ACCOUNT_DIAMOND_PRIVATE_NOTE_PAGE_SIZE = 250;
const ACCOUNT_DIAMOND_PRIVATE_NOTE_TRANSACTION_SIZE = 50;
const ACCOUNT_DIAMOND_AUTH_DELETE_BARRIER_COLLECTION = 'accountDiamondPrivateNoteAuthDeleteBarriers';
const ACCOUNT_DIAMOND_AUTH_DELETE_BARRIER_TYPE = 'diamond-private-note-auth-delete-barrier';
const ACCOUNT_DIAMOND_DELETION_BARRIER_ACCOUNT_REQUEST = 'account-request';
const ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE = 'auth-delete';
const CALENDAR_TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;

function isValidAccountUid(value) {
  return typeof value === 'string'
    && value === value.trim()
    && Boolean(value)
    && value.length <= 128
    && !value.includes('/');
}

function isExactIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function accountDiamondPrivateNoteError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function throwDiamondPrivateNoteIntegrityFailure(message) {
  throw accountDiamondPrivateNoteError('diamond-private-note-integrity-failed', message);
}

function isPotentialLegacyPrivateNoteMaterialEvent(value) {
  return value?.type === 'private_note'
    || value?.type === 'void_event'
    || value?.type === 'supersede_event';
}

async function scanAccountDiamondLegacyPrivateNotes({
  firestore,
  uid,
  documentIdField,
  pageSize
}) {
  const sources = [
    {
      collectionGroup: 'notes',
      field: 'createdBy',
      matchesPath: (path) => Boolean(
        diamondPrivateNoteCore.diamondPrivateNotePathsFromNotePath(path)
      ),
      matchesValue: () => true
    },
    {
      collectionGroup: 'events',
      field: 'actorUid',
      matchesPath: (path) => Boolean(
        diamondPrivateNoteCore.diamondPrivateNotePathsFromEventPath(path)
      ),
      // Legacy corrections can contain a private reason or target a private
      // note even when their replacement is public. The collection-group
      // query cannot prove the target's material class without an unbounded
      // cross-ledger read, so account deletion fails closed for every legacy
      // correction authored by the deleting principal until it is migrated.
      matchesValue: isPotentialLegacyPrivateNoteMaterialEvent
    }
  ];

  let pagesRead = 0;
  for (const source of sources) {
    let cursor = null;
    while (true) {
      let query = firestore.collectionGroup(source.collectionGroup)
        .where(source.field, '==', uid)
        .orderBy(documentIdField)
        .limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      const documents = Array.isArray(snapshot?.docs) ? snapshot.docs : null;
      if (!documents || snapshot?.empty !== (documents.length === 0)) {
        throwDiamondPrivateNoteIntegrityFailure(
          'Diamond private-note legacy preflight returned an invalid snapshot.'
        );
      }
      if (!documents.length) break;
      pagesRead += 1;
      const legacyDocument = documents.find((document) => (
        source.matchesPath(document?.ref?.path)
        && source.matchesValue(document?.data?.() || {})
      ));
      if (legacyDocument) {
        throw accountDiamondPrivateNoteError(
          'diamond-private-note-migration-required',
          'Legacy Diamond private-note data must be migrated before account deletion can continue.'
        );
      }
      if (documents.length < pageSize) break;
      cursor = documents.at(-1);
    }
  }
  return pagesRead;
}

function canonicalStoredEvent(value, expectedInstanceId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throwDiamondPrivateNoteIntegrityFailure('The Diamond private-note event is missing.');
  }
  const { instanceId, ...event } = value;
  if (instanceId !== expectedInstanceId) {
    throwDiamondPrivateNoteIntegrityFailure('The Diamond private-note event instance is inconsistent.');
  }
  return event;
}

function directAuthDeletionBarrierPath(uid) {
  return `${ACCOUNT_DIAMOND_AUTH_DELETE_BARRIER_COLLECTION}/${uid}`;
}

function parseDirectAuthDeletionBarrier(snapshot, uid) {
  const value = snapshot?.exists === true ? snapshot.data() || {} : null;
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== 4
    || value.schemaVersion !== 1
    || value.type !== ACCOUNT_DIAMOND_AUTH_DELETE_BARRIER_TYPE
    || value.status !== 'auth-deleted'
    || !isExactIsoTimestamp(value.startedAt)
    || snapshot.ref?.path !== directAuthDeletionBarrierPath(uid)
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The direct Auth-deletion barrier is not authoritative.'
    );
  }
  return value;
}

function accountDiamondDeletionBarrierRef(firestore, uid, barrierKind) {
  if (barrierKind === ACCOUNT_DIAMOND_DELETION_BARRIER_ACCOUNT_REQUEST) {
    return firestore.doc(`accountDeletionRequests/${uid}`);
  }
  if (barrierKind === ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE) {
    return firestore.doc(directAuthDeletionBarrierPath(uid));
  }
  throw new TypeError('Account Diamond private-note deletion barrier is invalid.');
}

function requireAccountDiamondDeletionBarrier(snapshot, uid, barrierKind) {
  if (barrierKind === ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE) {
    parseDirectAuthDeletionBarrier(snapshot, uid);
    return;
  }
  const value = snapshot?.exists === true ? snapshot.data() || {} : null;
  if (!value || value.uid !== uid || value.status !== 'processing') {
    throwDiamondPrivateNoteIntegrityFailure(
      'The account-deletion request is not in its authoritative processing state.'
    );
  }
}

function requireDiamondPrivateNoteRoot(value, paths) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schemaVersion !== 2
    || value.trackingEngine !== diamondPrivateNoteCore.DIAMOND_ENGINE
    || value.privateNoteStorageVersion !== 1
    || !Number.isSafeInteger(value.privateNotePrivacyRevision)
    || value.privateNotePrivacyRevision < 0
    || value.teamId !== paths.teamId
    || value.gameId !== paths.gameId
    || !isValidAccountUid(value.instanceId)
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The Diamond private-note scorebook identity is inconsistent.'
    );
  }
  return value;
}

function requireDiamondPrivateNoteReceipt({ receipt, event, note, root }) {
  if (
    !receipt
    || typeof receipt !== 'object'
    || Array.isArray(receipt)
    || receipt.instanceId !== root.instanceId
    || receipt.commandId !== note.commandId
    || !isExactIsoTimestamp(receipt.acceptedAt)
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The Diamond private-note receipt identity is inconsistent.'
    );
  }
  try {
    diamondDomainEngine.verifyDiamondCommandReceipt(receipt);
  } catch {
    throwDiamondPrivateNoteIntegrityFailure(
      'The Diamond private-note receipt failed canonical verification.'
    );
  }
  const storedEventKeys = Object.keys(event).sort();
  const receiptEventKeys = Object.keys(receipt.event || {}).sort();
  if (
    storedEventKeys.length !== receiptEventKeys.length
    || !storedEventKeys.every((key, index) => key === receiptEventKeys[index])
    || diamondDomainEngine.hashDiamondValue(event)
      !== diamondDomainEngine.hashDiamondValue(receipt.event)
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The Diamond private-note event and receipt do not match.'
    );
  }
}

async function redactAccountDiamondPrivateNoteChunk({
  firestore,
  uid,
  redactedAt,
  candidates,
  barrierKind
}) {
  let reconciliationPlan = null;
  const run = async () => firestore.runTransaction(async (transaction) => {
    const barrierRef = accountDiamondDeletionBarrierRef(
      firestore,
      uid,
      barrierKind
    );
    const barrierSnapshot = await transaction.get(barrierRef);
    const noteSnapshots = await Promise.all(
      candidates.map((candidate) => transaction.get(candidate.ref))
    );
    requireAccountDiamondDeletionBarrier(barrierSnapshot, uid, barrierKind);

    const identities = noteSnapshots.map((snapshot) => {
      if (!snapshot?.exists) return null;
      const paths = diamondPrivateNoteCore.diamondPrivateNotePathsFromNotePath(
        snapshot.ref?.path
      );
      if (!paths) return null;
      const value = snapshot.data() || {};
      if (value.status === 'deleted') {
        return { snapshot, paths, value, commandId: value.commandId, alreadyRedacted: true };
      }
      if (!isValidAccountUid(value.commandId)) {
        throwDiamondPrivateNoteIntegrityFailure(
          'The Diamond private-note command identity is malformed.'
        );
      }
      return { snapshot, paths, value, commandId: value.commandId, alreadyRedacted: false };
    }).filter(Boolean);

    const references = new Map();
    const addReference = (path) => {
      if (!references.has(path)) references.set(path, firestore.doc(path));
    };
    identities.forEach(({ paths, commandId }) => {
      addReference(paths.scorebook);
      addReference(paths.event);
      addReference(paths.command(commandId));
      addReference(paths.privateProjection);
    });
    const detailSnapshots = await Promise.all(
      [...references.values()].map((reference) => transaction.get(reference))
    );
    const details = new Map(
      detailSnapshots.map((snapshot) => [snapshot.ref.path, snapshot])
    );

    const rootActions = new Map();
    const noteActions = [];
    identities.forEach((identity) => {
      const { snapshot, paths, value, commandId, alreadyRedacted } = identity;
      const rootSnapshot = details.get(paths.scorebook);
      const eventSnapshot = details.get(paths.event);
      const receiptSnapshot = details.get(paths.command(commandId));
      if (!rootSnapshot?.exists || !eventSnapshot?.exists || !receiptSnapshot?.exists) {
        throwDiamondPrivateNoteIntegrityFailure(
          'Diamond private-note authoritative records are incomplete.'
        );
      }
      const root = requireDiamondPrivateNoteRoot(rootSnapshot.data() || {}, paths);
      const event = canonicalStoredEvent(eventSnapshot.data() || {}, root.instanceId);
      if (
        event.eventId !== paths.eventId
        || event.before?.teamId !== paths.teamId
        || event.before?.gameId !== paths.gameId
        || event.after?.teamId !== paths.teamId
        || event.after?.gameId !== paths.gameId
      ) {
        throwDiamondPrivateNoteIntegrityFailure(
          'The Diamond private-note event path and ledger identity do not match.'
        );
      }
      let parsed;
      try {
        parsed = alreadyRedacted
          ? diamondPrivateNoteCore.parseDiamondPrivateNoteRedaction(
            value,
            event,
            root.instanceId,
            diamondDomainEngine
          )
          : diamondPrivateNoteCore.parseDiamondPrivateNoteRecord(
            value,
            event,
            root.instanceId,
            diamondDomainEngine
          );
      } catch {
        throwDiamondPrivateNoteIntegrityFailure(
          'The Diamond private-note record failed canonical verification.'
        );
      }
      requireDiamondPrivateNoteReceipt({
        receipt: receiptSnapshot.data() || {},
        event,
        note: parsed,
        root
      });
      if (alreadyRedacted) return;
      if (parsed.authorUid !== uid) {
        throwDiamondPrivateNoteIntegrityFailure(
          'The Diamond private-note author changed during account deletion.'
        );
      }
      let redaction;
      try {
        redaction = diamondPrivateNoteCore.buildDiamondPrivateNoteRedaction({
          event,
          instanceId: root.instanceId,
          redactedAt,
          domainEngine: diamondDomainEngine
        });
      } catch {
        throwDiamondPrivateNoteIntegrityFailure(
          'The Diamond private-note redaction could not be built safely.'
        );
      }
      noteActions.push({ ref: snapshot.ref, redaction, event, root });
      if (!rootActions.has(paths.scorebook)) {
        rootActions.set(paths.scorebook, {
          ref: rootSnapshot.ref,
          projectionRef: references.get(paths.privateProjection),
          expectedPrivacyRevision: root.privateNotePrivacyRevision + 1
        });
      }
    });

    const plan = {
      notesRedacted: noteActions.length,
      scorebooksFenced: rootActions.size,
      notes: noteActions.map(({ ref, redaction, event, root }) => ({
        ref,
        redaction,
        event,
        instanceId: root.instanceId
      })),
      roots: [...rootActions.values()]
    };
    reconciliationPlan = plan;
    noteActions.forEach(({ ref, redaction }) => transaction.set(ref, redaction));
    rootActions.forEach(({ ref, projectionRef, expectedPrivacyRevision }) => {
      transaction.update(ref, {
        privateNotePrivacyRevision: expectedPrivacyRevision,
        projectionStatus: 'pending',
        projectionLease: null,
        projectionFailure: null,
        updatedAt: redactedAt
      });
      transaction.delete(projectionRef);
    });
    return plan;
  });

  const isReconciled = async (plan) => {
    if (!plan) return false;
    const noteSnapshots = await Promise.all(plan.notes.map(({ ref }) => ref.get()));
    const rootSnapshots = await Promise.all(plan.roots.map(({ ref }) => ref.get()));
    const projectionSnapshots = await Promise.all(
      plan.roots.map(({ projectionRef }) => projectionRef.get())
    );
    try {
      plan.notes.forEach(({ redaction, event, instanceId }, index) => {
        const snapshot = noteSnapshots[index];
        const current = snapshot?.exists ? snapshot.data() || {} : null;
        diamondPrivateNoteCore.parseDiamondPrivateNoteRedaction(
          current,
          event,
          instanceId,
          diamondDomainEngine
        );
        if (
          diamondDomainEngine.hashDiamondValue(current)
          !== diamondDomainEngine.hashDiamondValue(redaction)
        ) {
          throw new Error('mismatched redaction');
        }
      });
      plan.roots.forEach(({ expectedPrivacyRevision }, index) => {
        const root = rootSnapshots[index]?.exists
          ? rootSnapshots[index].data() || {}
          : null;
        if (
          !root
          || root.privateNotePrivacyRevision < expectedPrivacyRevision
          || projectionSnapshots[index]?.exists
        ) {
          throw new Error('unreconciled scorebook fence');
        }
      });
      return true;
    } catch {
      return false;
    }
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    reconciliationPlan = null;
    try {
      const result = await run();
      return {
        notesRedacted: result.notesRedacted,
        scorebooksFenced: result.scorebooksFenced
      };
    } catch (error) {
      if (await isReconciled(reconciliationPlan)) {
        return {
          notesRedacted: reconciliationPlan.notesRedacted,
          scorebooksFenced: reconciliationPlan.scorebooksFenced
        };
      }
      if (attempt === 1) throw error;
    }
  }
  throwDiamondPrivateNoteIntegrityFailure(
    'Diamond private-note cleanup could not be reconciled.'
  );
}

async function cleanupAccountDiamondPrivateNotes({
  firestore,
  uid,
  documentIdField,
  redactedAt,
  pageSize = ACCOUNT_DIAMOND_PRIVATE_NOTE_PAGE_SIZE,
  transactionSize = ACCOUNT_DIAMOND_PRIVATE_NOTE_TRANSACTION_SIZE,
  barrierKind = ACCOUNT_DIAMOND_DELETION_BARRIER_ACCOUNT_REQUEST
}) {
  if (
    !firestore
    || typeof firestore.collectionGroup !== 'function'
    || typeof firestore.doc !== 'function'
    || typeof firestore.runTransaction !== 'function'
    || !isValidAccountUid(uid)
    || !documentIdField
    || !isExactIsoTimestamp(redactedAt)
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > ACCOUNT_DIAMOND_PRIVATE_NOTE_PAGE_SIZE
    || !Number.isSafeInteger(transactionSize)
    || transactionSize < 1
    || transactionSize > ACCOUNT_DIAMOND_PRIVATE_NOTE_TRANSACTION_SIZE
    || ![
      ACCOUNT_DIAMOND_DELETION_BARRIER_ACCOUNT_REQUEST,
      ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
    ].includes(barrierKind)
  ) {
    throw new TypeError('Account Diamond private-note cleanup dependencies are invalid.');
  }

  let pagesRead = await scanAccountDiamondLegacyPrivateNotes({
    firestore,
    uid,
    documentIdField,
    pageSize
  });
  let notesRedacted = 0;
  let scorebooksFenced = 0;
  let cursor = null;
  while (true) {
    let query = firestore.collectionGroup('notes')
      .where('authorUid', '==', uid)
      .orderBy(documentIdField)
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const documents = Array.isArray(snapshot?.docs) ? snapshot.docs : null;
    if (!documents || snapshot?.empty !== (documents.length === 0)) {
      throwDiamondPrivateNoteIntegrityFailure(
        'Diamond private-note cleanup returned an invalid snapshot.'
      );
    }
    if (!documents.length) break;
    pagesRead += 1;
    const candidates = documents.filter((document) => Boolean(
      diamondPrivateNoteCore.diamondPrivateNotePathsFromNotePath(document?.ref?.path)
    ));
    for (let index = 0; index < candidates.length; index += transactionSize) {
      const counts = await redactAccountDiamondPrivateNoteChunk({
        firestore,
        uid,
        redactedAt,
        candidates: candidates.slice(index, index + transactionSize),
        barrierKind
      });
      notesRedacted += counts.notesRedacted;
      scorebooksFenced += counts.scorebooksFenced;
    }
    if (documents.length < pageSize) break;
    cursor = documents.at(-1);
  }
  return { notesRedacted, pagesRead, scorebooksFenced };
}

async function establishDirectAuthDeletionBarrier({ firestore, uid, startedAt }) {
  const barrierRef = firestore.doc(directAuthDeletionBarrierPath(uid));
  const value = {
    schemaVersion: 1,
    type: ACCOUNT_DIAMOND_AUTH_DELETE_BARRIER_TYPE,
    status: 'auth-deleted',
    startedAt
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(barrierRef);
        if (snapshot?.exists) return parseDirectAuthDeletionBarrier(snapshot, uid);
        transaction.set(barrierRef, value);
        return value;
      });
    } catch (error) {
      try {
        const snapshot = await barrierRef.get();
        if (snapshot?.exists) return parseDirectAuthDeletionBarrier(snapshot, uid);
      } catch (reconciliationError) {
        if (reconciliationError?.code === 'diamond-private-note-integrity-failed') {
          throw reconciliationError;
        }
      }
      if (attempt === 1) throw error;
    }
  }
  throwDiamondPrivateNoteIntegrityFailure(
    'The direct Auth-deletion barrier could not be established.'
  );
}

async function retireDirectAuthDeletionBarrier({ firestore, uid }) {
  const barrierRef = firestore.doc(directAuthDeletionBarrierPath(uid));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(barrierRef);
        if (!snapshot?.exists) return;
        parseDirectAuthDeletionBarrier(snapshot, uid);
        transaction.delete(barrierRef);
      });
      return;
    } catch (error) {
      try {
        const snapshot = await barrierRef.get();
        if (!snapshot?.exists) return;
        parseDirectAuthDeletionBarrier(snapshot, uid);
      } catch (reconciliationError) {
        if (reconciliationError?.code === 'diamond-private-note-integrity-failed') {
          throw reconciliationError;
        }
      }
      if (attempt === 1) throw error;
    }
  }
  throwDiamondPrivateNoteIntegrityFailure(
    'The direct Auth-deletion barrier could not be retired.'
  );
}

function createAccountDiamondPrivateNoteAuthDeleteHandler({
  firestore,
  getDocumentIdField,
  now
}) {
  if (
    !firestore
    || typeof getDocumentIdField !== 'function'
    || typeof now !== 'function'
  ) {
    throw new TypeError('Direct Auth-deletion cleanup dependencies are invalid.');
  }

  return async (user, context = {}) => {
    const documentIdField = getDocumentIdField();
    if (
      typeof firestore.collectionGroup !== 'function'
      || typeof firestore.doc !== 'function'
      || typeof firestore.runTransaction !== 'function'
      || !documentIdField
    ) {
      throw new TypeError('Direct Auth-deletion cleanup dependencies are invalid.');
    }

    const uid = user?.uid;
    if (!isValidAccountUid(uid)) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The direct Auth-deletion principal is malformed.'
      );
    }
    const eventTimestamp = context?.timestamp;
    const requestedAt = eventTimestamp === undefined || eventTimestamp === null
      ? now()
      : eventTimestamp;
    if (!isExactIsoTimestamp(requestedAt)) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The direct Auth-deletion timestamp is malformed.'
      );
    }

    const barrier = await establishDirectAuthDeletionBarrier({
      firestore,
      uid,
      startedAt: requestedAt
    });
    await cleanupAccountDiamondPrivateNotes({
      firestore,
      uid,
      documentIdField,
      redactedAt: barrier.startedAt,
      barrierKind: ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
    });
    await retireDirectAuthDeletionBarrier({ firestore, uid });
    return null;
  };
}

function normalizeConfirmation(value) {
  return String(value || '').trim().toUpperCase();
}

function isTeamOwnedByAccount(team = {}, accountIdentity) {
  const identity = normalizeRosterContactIdentity(accountIdentity);
  const ownerId = String(team.ownerId || '').trim();
  if (ownerId) return Boolean(identity.uid && ownerId === identity.uid);
  const ownerEmails = [...new Set([team.ownerEmail, team.ownerEmailLower]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))];
  return Boolean(identity.email && ownerEmails.length === 1 && ownerEmails[0] === identity.email);
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
  if (isTeamOwnedByAccount(team, identity)) {
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

function isStorageObjectNotFound(error) {
  return error?.code === 404 ||
    error?.code === '404' ||
    error?.code === 'storage/object-not-found';
}

async function deleteAccountStoragePaths({
  primaryBucket,
  imageBucket,
  primaryPaths = [],
  imagePaths = [],
  maxConcurrentDeletes = ACCOUNT_STORAGE_DELETE_CONCURRENCY
}) {
  const deleteTargets = [
    ...primaryPaths.map((storagePath) => ({ bucket: primaryBucket, storagePath })),
    ...imagePaths.map((storagePath) => ({ bucket: imageBucket, storagePath }))
  ];
  for (let index = 0; index < deleteTargets.length; index += maxConcurrentDeletes) {
    await Promise.all(deleteTargets.slice(index, index + maxConcurrentDeletes).map(async ({ bucket, storagePath }) => {
      try {
        await bucket.file(storagePath).delete({ ignoreNotFound: true });
      } catch (error) {
        if (!isStorageObjectNotFound(error)) throw error;
      }
    }));
  }
}

async function deleteAccountMediaStoragePages({
  uid,
  queries = [],
  profilePhotoUrls = [],
  primaryBucket,
  imageBucket,
  documentIdField,
  pageSize = ACCOUNT_MEDIA_CLEANUP_PAGE_SIZE,
  maxConcurrentDeletes = ACCOUNT_STORAGE_DELETE_CONCURRENCY
}) {
  let documentsProcessed = 0;
  let pagesRead = 0;

  const profilePaths = classifyAccountStoragePaths(uid, [], profilePhotoUrls);
  await deleteAccountStoragePaths({
    primaryBucket,
    imageBucket,
    primaryPaths: profilePaths.primaryPaths,
    imagePaths: profilePaths.imagePaths,
    maxConcurrentDeletes
  });

  for (const baseQuery of queries) {
    let cursor = null;
    while (true) {
      let pageQuery = baseQuery.orderBy(documentIdField).limit(pageSize);
      if (cursor) pageQuery = pageQuery.startAfter(cursor);
      const snapshot = await pageQuery.get();
      if (snapshot.empty) break;

      const documents = snapshot.docs || [];
      pagesRead += 1;
      documentsProcessed += documents.length;
      const { primaryPaths, imagePaths } = classifyAccountStoragePaths(
        uid,
        collectAccountMediaStoragePaths(documents.map((document) => document.data() || {}))
      );
      await deleteAccountStoragePaths({
        primaryBucket,
        imageBucket,
        primaryPaths,
        imagePaths,
        maxConcurrentDeletes
      });

      if (documents.length < pageSize) break;
      cursor = documents[documents.length - 1];
    }
  }

  return { documentsProcessed, pagesRead };
}

async function deleteAccountQueryPages({
  firestore,
  query,
  pageSize = 250,
  maxConcurrentDeletes = 10
}) {
  if (!firestore || typeof firestore.recursiveDelete !== 'function') {
    throw new TypeError('Account query cleanup requires recursiveDelete.');
  }
  if (!query || typeof query.limit !== 'function') {
    throw new TypeError('Account query cleanup requires a Firestore query.');
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new TypeError('Account query cleanup page size is invalid.');
  }
  if (!Number.isSafeInteger(maxConcurrentDeletes) || maxConcurrentDeletes < 1 || maxConcurrentDeletes > 100) {
    throw new TypeError('Account query cleanup concurrency is invalid.');
  }

  let documentsProcessed = 0;
  let pagesRead = 0;
  while (true) {
    const snapshot = await query.limit(pageSize).get();
    if (!snapshot || typeof snapshot.empty !== 'boolean' || !Array.isArray(snapshot.docs)) {
      throw new TypeError('Account query cleanup received an invalid Firestore snapshot.');
    }
    if (snapshot.empty) {
      if (snapshot.docs.length) {
        throw new TypeError('Account query cleanup received an inconsistent Firestore snapshot.');
      }
      return { documentsProcessed, pagesRead };
    }
    if (!snapshot.docs.length) {
      throw new TypeError('Account query cleanup received an inconsistent Firestore snapshot.');
    }

    pagesRead += 1;
    documentsProcessed += snapshot.docs.length;
    for (let index = 0; index < snapshot.docs.length; index += maxConcurrentDeletes) {
      await Promise.all(snapshot.docs
        .slice(index, index + maxConcurrentDeletes)
        .map((docSnapshot) => firestore.recursiveDelete(docSnapshot.ref)));
    }
  }
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
    ['chat', 'senderId'],
    ['comments', 'authorId'],
    ['reactions', 'userId'],
    ['reactions', 'senderId'],
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

function getCanonicalCalendarCredentialPrincipal(credential = {}) {
  for (const field of ['uid', 'userId', 'createdBy']) {
    if (!Object.prototype.hasOwnProperty.call(credential, field)) continue;
    const originalValue = credential[field];
    if (originalValue === undefined || originalValue === null || originalValue === '') continue;
    if (
      typeof originalValue !== 'string'
      || originalValue !== originalValue.trim()
      || !originalValue
      || originalValue.length > 128
      || originalValue.includes('/')
    ) {
      return { field, valid: false, value: '' };
    }
    return { field, valid: true, value: originalValue };
  }
  return { field: '', valid: false, value: '' };
}

function calendarCredentialBelongsToAccount(credential, uid) {
  const principal = getCanonicalCalendarCredentialPrincipal(credential);
  return principal.valid && principal.value === uid;
}

function getCalendarCredentialTeamId(documentPath, collectionName) {
  const pathParts = String(documentPath || '').split('/');
  const collectionIndex = pathParts.lastIndexOf(collectionName);
  if (collectionIndex < 2 || pathParts[collectionIndex - 2] !== 'teams') return '';
  return pathParts[collectionIndex - 1] || '';
}

function getCalendarSubscriptionLookupPath(secretSnapshot, uid) {
  const secret = secretSnapshot?.data?.() || {};
  if (!calendarCredentialBelongsToAccount(secret, uid)) return '';
  const teamId = getCalendarCredentialTeamId(
    secretSnapshot?.ref?.path,
    'privateCalendarSubscriptions'
  );
  const tokenHash = secret.tokenHash;
  if (
    secret.schemaVersion !== 1
    || secret.teamId !== teamId
    || typeof tokenHash !== 'string'
    || !CALENDAR_TOKEN_HASH_PATTERN.test(tokenHash)
  ) {
    return '';
  }
  return `teams/${teamId}/calendarTokens/${tokenHash}`;
}

async function collectCalendarCredentialQueryPages({
  query,
  documentIdField,
  pageSize,
  candidates
}) {
  let cursor = null;
  let pagesRead = 0;
  while (true) {
    let pageQuery = query.orderBy(documentIdField).limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const snapshot = await pageQuery.get();
    const documents = snapshot.docs || [];
    if (!documents.length) break;
    pagesRead += 1;
    documents.forEach((document) => {
      if (document?.ref?.path) candidates.set(document.ref.path, document);
    });
    if (documents.length < pageSize) break;
    cursor = documents[documents.length - 1];
  }
  return pagesRead;
}

async function deleteCalendarLookupCandidates({ firestore, refs, uid, transactionSize }) {
  let deleted = 0;
  for (let index = 0; index < refs.length; index += transactionSize) {
    const refChunk = refs.slice(index, index + transactionSize);
    const chunkDeleted = await firestore.runTransaction(async (transaction) => {
      const currentSnapshots = await Promise.all(refChunk.map((ref) => transaction.get(ref)));
      const matchingRefs = currentSnapshots
        .filter((snapshot) => snapshot.exists)
        .filter((snapshot) => calendarCredentialBelongsToAccount(snapshot.data() || {}, uid))
        .map((snapshot) => snapshot.ref);
      matchingRefs.forEach((ref) => transaction.delete(ref));
      return matchingRefs.length;
    });
    deleted += chunkDeleted;
  }
  return deleted;
}

async function deleteCalendarSubscriptionCandidates({
  firestore,
  candidates,
  initialLookupPaths,
  uid,
  transactionSize
}) {
  let lookupsDeleted = 0;
  let secretsDeleted = 0;
  const candidateList = [...candidates.values()];
  for (let index = 0; index < candidateList.length; index += transactionSize) {
    const candidateChunk = candidateList.slice(index, index + transactionSize);
    const counts = await firestore.runTransaction(async (transaction) => {
      const currentSecrets = await Promise.all(
        candidateChunk.map((candidate) => transaction.get(candidate.ref))
      );
      const actions = currentSecrets
        .filter((snapshot) => snapshot.exists)
        .filter((snapshot) => calendarCredentialBelongsToAccount(snapshot.data() || {}, uid))
        .map((snapshot) => {
          const initialLookupPath = initialLookupPaths.get(snapshot.ref.path) || '';
          const currentLookupPath = getCalendarSubscriptionLookupPath(snapshot, uid);
          return {
            secretSnapshot: snapshot,
            currentLookupPath,
            lookupPaths: [...new Set([initialLookupPath, currentLookupPath].filter(Boolean))]
          };
        });
      const lookupRefsByPath = new Map();
      actions.forEach((action) => action.lookupPaths.forEach((lookupPath) => {
        lookupRefsByPath.set(lookupPath, firestore.doc(lookupPath));
      }));
      const lookupSnapshots = await Promise.all(
        [...lookupRefsByPath.values()].map((ref) => transaction.get(ref))
      );
      const lookupSnapshotsByPath = new Map(
        lookupSnapshots.map((snapshot) => [snapshot.ref.path, snapshot])
      );
      const lookupRefsToDelete = new Map();
      actions.forEach((action) => {
        action.lookupPaths.forEach((lookupPath) => {
          const lookupSnapshot = lookupSnapshotsByPath.get(lookupPath);
          if (!lookupSnapshot?.exists) return;
          const lookup = lookupSnapshot.data() || {};
          if (!calendarCredentialBelongsToAccount(lookup, uid)) {
            if (lookupPath === action.currentLookupPath) {
              const error = new Error('Calendar credential pair has a conflicting principal binding.');
              error.code = 'calendar-credential-binding-conflict';
              throw error;
            }
            return;
          }
          if (lookupPath === action.currentLookupPath) {
            const teamId = getCalendarCredentialTeamId(lookupPath, 'calendarTokens');
            const tokenHash = lookupPath.split('/').pop();
            if (lookup.teamId !== teamId || lookup.tokenHash !== tokenHash) {
              const error = new Error('Calendar credential pair has inconsistent lookup metadata.');
              error.code = 'calendar-credential-binding-conflict';
              throw error;
            }
          }
          lookupRefsToDelete.set(lookupPath, lookupSnapshot.ref);
        });
      });

      // The hashed lookup is the active bearer capability. Retire it in the
      // same transaction, before removing the raw secret document.
      lookupRefsToDelete.forEach((ref) => transaction.delete(ref));
      actions.forEach(({ secretSnapshot }) => transaction.delete(secretSnapshot.ref));
      return {
        lookupsDeleted: lookupRefsToDelete.size,
        secretsDeleted: actions.length
      };
    });
    lookupsDeleted += counts.lookupsDeleted;
    secretsDeleted += counts.secretsDeleted;
  }
  return { lookupsDeleted, secretsDeleted };
}

async function cleanupAccountCalendarCredentials({
  firestore,
  uid,
  documentIdField,
  pageSize = ACCOUNT_CALENDAR_CREDENTIAL_PAGE_SIZE,
  transactionSize = ACCOUNT_CALENDAR_CREDENTIAL_TRANSACTION_SIZE
}) {
  if (
    !firestore
    || typeof uid !== 'string'
    || uid !== uid.trim()
    || !uid
    || uid.length > 128
    || uid.includes('/')
    || !documentIdField
    || !Number.isInteger(pageSize)
    || pageSize < 1
    || pageSize > 250
    || !Number.isInteger(transactionSize)
    || transactionSize < 1
    || transactionSize > 200
  ) {
    throw new TypeError('Account calendar credential cleanup dependencies are invalid.');
  }

  const secretCandidates = new Map();
  const lookupCandidates = new Map();
  let pagesRead = 0;
  for (const field of ['uid', 'userId', 'createdBy']) {
    pagesRead += await collectCalendarCredentialQueryPages({
      query: firestore.collectionGroup('privateCalendarSubscriptions').where(field, '==', uid),
      documentIdField,
      pageSize,
      candidates: secretCandidates
    });
    pagesRead += await collectCalendarCredentialQueryPages({
      query: firestore.collectionGroup('calendarTokens').where(field, '==', uid),
      documentIdField,
      pageSize,
      candidates: lookupCandidates
    });
  }

  const initialLookupPaths = new Map();
  secretCandidates.forEach((snapshot, secretPath) => {
    const lookupPath = getCalendarSubscriptionLookupPath(snapshot, uid);
    if (lookupPath) initialLookupPaths.set(secretPath, lookupPath);
  });
  const pairedLookupPaths = new Set(initialLookupPaths.values());
  const standaloneLookupRefs = [...lookupCandidates.entries()]
    .filter(([lookupPath]) => !pairedLookupPaths.has(lookupPath))
    .map(([, snapshot]) => snapshot.ref);

  let lookupsDeleted = await deleteCalendarLookupCandidates({
    firestore,
    refs: standaloneLookupRefs,
    uid,
    transactionSize
  });
  const pairedCounts = await deleteCalendarSubscriptionCandidates({
    firestore,
    candidates: secretCandidates,
    initialLookupPaths,
    uid,
    transactionSize
  });
  lookupsDeleted += pairedCounts.lookupsDeleted;

  // If a queried secret disappeared or changed principals before its
  // transaction, its initially paired lookup was intentionally not deleted
  // with that secret. Re-read those candidates and remove only lookups still
  // canonically bound to the deleting account.
  const remainingPairedLookupRefs = [...pairedLookupPaths]
    .map((lookupPath) => firestore.doc(lookupPath));
  lookupsDeleted += await deleteCalendarLookupCandidates({
    firestore,
    refs: remainingPairedLookupRefs,
    uid,
    transactionSize
  });

  return {
    lookupCandidates: lookupCandidates.size,
    lookupsDeleted,
    pagesRead,
    secretCandidates: secretCandidates.size,
    secretsDeleted: pairedCounts.secretsDeleted
  };
}

function isAccountReplayArchiveDocument(document) {
  const path = typeof document?.ref?.path === 'string' ? document.ref.path : '';
  const segments = path.split('/');
  return document?.id === 'archive'
    && segments.length >= 4
    && segments.length % 2 === 0
    && segments.at(-2) === 'privateReplay'
    && segments.at(-1) === 'archive'
    && ['games', 'sharedGames'].includes(segments.at(-4));
}

function isValidAccountReplayAttributionUid(uid) {
  return typeof uid === 'string'
    && uid === uid.trim()
    && Boolean(uid)
    && uid.length <= 128
    && !uid.includes('/');
}

function buildReplayArchiveAttributionScrubPlan(archive = {}, uid = '') {
  if (!archive || typeof archive !== 'object' || Array.isArray(archive)
    || !isValidAccountReplayAttributionUid(uid)) {
    return { changed: false, fieldsToDelete: [] };
  }
  const fieldsToDelete = ACCOUNT_REPLAY_ARCHIVE_ATTRIBUTION_FIELDS.filter((field) => (
    archive[field] === uid
  ));
  return {
    changed: fieldsToDelete.length > 0,
    fieldsToDelete
  };
}

async function collectReplayArchiveAttributionQueryPages({
  firestore,
  uid,
  field,
  documentIdField,
  pageSize,
  processPage
}) {
  let cursor = null;
  let pagesRead = 0;
  let candidatesRead = 0;
  while (true) {
    let query = firestore.collectionGroup('privateReplay')
      .where(field, '==', uid)
      .orderBy(documentIdField)
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const documents = snapshot.docs || [];
    if (!documents.length) break;
    pagesRead += 1;
    candidatesRead += documents.length;
    await processPage(documents.filter(isAccountReplayArchiveDocument));
    if (documents.length < pageSize) break;
    cursor = documents[documents.length - 1];
  }
  return { candidatesRead, pagesRead };
}

async function anonymizeAccountReplayArchiveAttribution({
  firestore,
  uid,
  documentIdField,
  deleteFieldValue,
  pageSize = ACCOUNT_REPLAY_ARCHIVE_PAGE_SIZE,
  transactionSize = ACCOUNT_REPLAY_ARCHIVE_TRANSACTION_SIZE
}) {
  if (
    !firestore
    || typeof firestore.collectionGroup !== 'function'
    || typeof firestore.runTransaction !== 'function'
    || !isValidAccountReplayAttributionUid(uid)
    || !documentIdField
    || typeof deleteFieldValue !== 'function'
    || !Number.isInteger(pageSize)
    || pageSize < 1
    || pageSize > 250
    || !Number.isInteger(transactionSize)
    || transactionSize < 1
    || transactionSize > 200
  ) {
    throw new TypeError('Account replay archive anonymization dependencies are invalid.');
  }

  let archivesUpdated = 0;
  let attributionFieldsDeleted = 0;
  let candidatesRead = 0;
  let pagesRead = 0;
  const processPage = async (documents) => {
    for (let index = 0; index < documents.length; index += transactionSize) {
      const refs = documents.slice(index, index + transactionSize).map((document) => document.ref);
      const counts = await firestore.runTransaction(async (transaction) => {
        const currentSnapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        let transactionArchivesUpdated = 0;
        let transactionFieldsDeleted = 0;
        currentSnapshots.forEach((snapshot) => {
          if (!snapshot.exists || !isAccountReplayArchiveDocument(snapshot)) return;
          const plan = buildReplayArchiveAttributionScrubPlan(snapshot.data() || {}, uid);
          if (!plan.changed) return;
          const update = {};
          plan.fieldsToDelete.forEach((field) => {
            update[field] = deleteFieldValue();
          });
          transaction.update(snapshot.ref, update);
          transactionArchivesUpdated += 1;
          transactionFieldsDeleted += plan.fieldsToDelete.length;
        });
        return {
          archivesUpdated: transactionArchivesUpdated,
          attributionFieldsDeleted: transactionFieldsDeleted
        };
      });
      archivesUpdated += counts.archivesUpdated;
      attributionFieldsDeleted += counts.attributionFieldsDeleted;
    }
  };

  for (const field of ACCOUNT_REPLAY_ARCHIVE_ATTRIBUTION_FIELDS) {
    const queryCounts = await collectReplayArchiveAttributionQueryPages({
      firestore,
      uid,
      field,
      documentIdField,
      pageSize,
      processPage
    });
    candidatesRead += queryCounts.candidatesRead;
    pagesRead += queryCounts.pagesRead;
  }

  return {
    archivesUpdated,
    attributionFieldsDeleted,
    candidatesRead,
    pagesRead
  };
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

function summarizeOwnedTeams(snapshot, accountIdentity) {
  const seenTeamIds = new Set();
  return (snapshot?.docs || [])
    .filter((doc) => doc.data()?.active !== false)
    .filter((doc) => isTeamOwnedByAccount(doc.data() || {}, accountIdentity))
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

function getCurrentEnabledAuthEmail(authUser) {
  if (!authUser || authUser.disabled === true) return '';
  return String(authUser.email || '').trim();
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
  }, { uid, email: normalizedEmail });
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
  ACCOUNT_DIAMOND_PRIVATE_NOTE_PAGE_SIZE,
  ACCOUNT_DIAMOND_PRIVATE_NOTE_TRANSACTION_SIZE,
  ACCOUNT_CALENDAR_CREDENTIAL_PAGE_SIZE,
  ACCOUNT_CALENDAR_CREDENTIAL_TRANSACTION_SIZE,
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_MAX_AUTH_AGE_SECONDS,
  ACCOUNT_DELETION_MAX_DAYS,
  ACCOUNT_MEDIA_CLEANUP_PAGE_SIZE,
  ACCOUNT_REPLAY_ARCHIVE_ATTRIBUTION_FIELDS,
  ACCOUNT_REPLAY_ARCHIVE_PAGE_SIZE,
  ACCOUNT_REPLAY_ARCHIVE_TRANSACTION_SIZE,
  ACCOUNT_STORAGE_DELETE_CONCURRENCY,
  accountUsesAppleProvider,
  anonymizeAccountReplayArchiveAttribution,
  assertDeletionRequest,
  assertRecentAuthentication,
  buildChatConversationAccountScrubPlan,
  buildDeletionAuditId,
  buildRegistrationAccountScrubPlan,
  buildReplayArchiveAttributionScrubPlan,
  buildRosterParentScrubPlan,
  buildTeamAccountGrantScrubPlan,
  classifyAccountStoragePaths,
  collectAccountRosterScopes,
  collectAccountTeamIds,
  collectAccountMediaStoragePaths,
  cleanupAccountCalendarCredentials,
  cleanupAccountDiamondPrivateNotes,
  createAccountDiamondPrivateNoteAuthDeleteHandler,
  createAccountDeletionRequestHandler,
  deleteAccountMediaStoragePages,
  deleteAccountQueryPages,
  extractAccountProfileStoragePath,
  getAccountEmailQueryCandidates,
  getCanonicalCalendarCredentialPrincipal,
  getCurrentEnabledAuthEmail,
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
