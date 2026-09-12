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
const ACCOUNT_DIAMOND_RECONCILIATION_PAGE_SIZE = 250;
const ACCOUNT_DIAMOND_RECONCILIATION_INVENTORY_PAGE_BUDGET = 40;
const ACCOUNT_DIAMOND_MAX_CANONICAL_EVENTS = 20_000;
const ACCOUNT_DIAMOND_RECONCILIATION_COLLECTION = 'diamondReconciliations';
const ACCOUNT_DIAMOND_RECONCILIATION_TYPE = 'diamond-auth-delete-reconciliation';
const ACCOUNT_DIAMOND_RECONCILIATION_SCAN_COLLECTION = 'diamondReconciliationScans';
const ACCOUNT_DIAMOND_RECONCILIATION_SCAN_TYPE = 'diamond-auth-delete-scan';
const ACCOUNT_DIAMOND_AUTH_DELETE_BARRIER_COLLECTION = 'accountDiamondPrivateNoteAuthDeleteBarriers';
const ACCOUNT_DIAMOND_AUTH_DELETE_BARRIER_TYPE = 'diamond-private-note-auth-delete-barrier';
const ACCOUNT_DIAMOND_DELETION_BARRIER_ACCOUNT_REQUEST = 'account-request';
const ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE = 'auth-delete';
const CALENDAR_TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const DIAMOND_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const DIAMOND_EVENT_PATH_PATTERN = /^teams\/([^/]+)\/games\/([^/]+)\/diamondScorebooks\/v2\/events\/([^/]+)$/;
const DIAMOND_AUDIT_PATH_PATTERN = /^teams\/([^/]+)\/games\/([^/]+)\/diamondScorebooks\/v2\/audit\/([^/]+)$/;
const DIAMOND_CONFIGURATION_REQUEST_PATH_PATTERN = /^teams\/([^/]+)\/diamondConfigurationRequests\/([^/]+)$/;
const DIAMOND_ACTIVATION_GAME_ROLLBACK_FIELDS = Object.freeze([
  'trackingEngine', 'trackingEngineRevision', 'diamondProjectionRevision',
  'diamondProjectionCheckpointHash', 'diamondProjectionHash',
  'diamondProjectionStatus', 'diamondProjectionComplete',
  'diamondScorebookInstanceId', 'diamondStatConfigSnapshotHash',
  'diamondLifecycle', 'diamondPublicTeamStats', 'diamondAiState',
  'diamondHighlightClipsRevision', 'diamondHighlightClipsEffectKey',
  'trackingEngineActivatedAt', 'trackingEngineActivatedBy', 'homeScore',
  'awayScore', 'score', 'status', 'liveStatus', 'liveHasData',
  'currentInning', 'inningHalf', 'balls', 'strikes', 'outs',
  'opponentStats', 'highlightClips', 'aiRecap', 'gameRecap', 'recap',
  'aiInsights', 'gameInsights', 'insights'
]);
const DIAMOND_SHARED_PROJECTION_FIELDS = Object.freeze([
  'homeScore', 'awayScore', 'status', 'liveStatus', 'trackingEngine',
  'diamondProjectionRevision', 'diamondProjectionCheckpointHash',
  'diamondProjectionStatus', 'diamondSourceTeamId', 'diamondSourceGameId',
  'diamondScorebookInstanceId', 'diamondProjectionHash'
]);

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
  return `${ACCOUNT_DIAMOND_AUTH_DELETE_BARRIER_COLLECTION}/${diamondPrivateNoteCore.buildDiamondPrivateNoteAuthDeleteBarrierId(
    uid
  )}`;
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

function timestampsExactlyEqual(left, right) {
  let exactMatch = left === right;
  if (!exactMatch && typeof left?.isEqual === 'function') {
    try {
      exactMatch = left.isEqual(right) === true;
    } catch {
      exactMatch = false;
    }
  }
  if (!exactMatch) {
    exactMatch = Number.isSafeInteger(left?.seconds)
      && Number.isSafeInteger(left?.nanoseconds)
      && left.seconds === right?.seconds
      && left.nanoseconds === right?.nanoseconds;
  }
  return exactMatch;
}

function requireSnapshotCommitMillis(snapshot) {
  const createdTimestamp = snapshot?.createTime;
  const updatedTimestamp = snapshot?.updateTime;
  const value = createdTimestamp?.toMillis?.();
  if (!Number.isSafeInteger(value) || value < 0) {
    throwDiamondPrivateNoteIntegrityFailure(
      'Diamond Auth-deletion reconciliation is missing authoritative commit metadata.'
    );
  }
  const exactMatch = timestampsExactlyEqual(createdTimestamp, updatedTimestamp);
  if (!exactMatch) {
    throwDiamondPrivateNoteIntegrityFailure(
      'A Diamond Auth-deletion candidate is not an immutable create.'
    );
  }
  return value;
}

function reconciliationTaskPath(uid, scorebookPath) {
  const taskId = crypto.createHash('sha256')
    .update(`diamond-auth-delete-reconciliation:v1\0${scorebookPath}`)
    .digest('hex');
  return `${directAuthDeletionBarrierPath(uid)}/${ACCOUNT_DIAMOND_RECONCILIATION_COLLECTION}/${taskId}`;
}

function reconciliationScanPath(uid, scanId) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(scanId || '')) {
    throw new TypeError('Diamond Auth-deletion scan ID is malformed.');
  }
  return `${directAuthDeletionBarrierPath(uid)}/${ACCOUNT_DIAMOND_RECONCILIATION_SCAN_COLLECTION}/${scanId}`;
}

function parseReconciliationScan(snapshot, expected) {
  if (snapshot?.exists !== true) {
    return {
      schemaVersion: 1,
      type: ACCOUNT_DIAMOND_RECONCILIATION_SCAN_TYPE,
      source: expected.source,
      collectionGroup: expected.collectionGroup,
      field: expected.field,
      status: 'scanning',
      cursorPath: null,
      epoch: 0,
      startedAt: expected.startedAt
    };
  }
  const value = snapshot.data() || {};
  if (
    value.schemaVersion !== 1
    || value.type !== ACCOUNT_DIAMOND_RECONCILIATION_SCAN_TYPE
    || value.source !== expected.source
    || value.collectionGroup !== expected.collectionGroup
    || value.field !== expected.field
    || !['scanning', 'complete'].includes(value.status)
    || !Number.isSafeInteger(value.epoch)
    || value.epoch < 0
    || (value.cursorPath !== null && (
      typeof value.cursorPath !== 'string'
      || !value.cursorPath
      || value.cursorPath.length > 1024
    ))
    || value.startedAt !== expected.startedAt
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The durable Diamond Auth-deletion scan cursor is malformed.'
    );
  }
  return value;
}

async function runDurableEqualityScan({
  firestore,
  uid,
  barrier,
  documentIdField,
  source,
  collectionGroup,
  field,
  pageBudget,
  processDocument
}) {
  const scanRef = firestore.doc(reconciliationScanPath(uid, source));
  const expected = {
    source,
    collectionGroup,
    field,
    startedAt: barrier.startedAt
  };
  while (true) {
    const observedSnapshot = await scanRef.get();
    const observed = parseReconciliationScan(observedSnapshot, expected);
    if (observed.status === 'complete') return;
    if (!pageBudget || pageBudget.remaining <= 0) {
      throw accountDiamondPrivateNoteError(
        'unavailable',
        'Diamond Auth-deletion discovery made bounded durable progress; retry is required.'
      );
    }
    let query = firestore.collectionGroup(collectionGroup)
      .where(field, '==', uid)
      .orderBy(documentIdField)
      .limit(ACCOUNT_DIAMOND_RECONCILIATION_PAGE_SIZE);
    if (observed.cursorPath) {
      query = query.startAfter(firestore.doc(observed.cursorPath));
    }
    const querySnapshot = await query.get();
    const documents = Array.isArray(querySnapshot?.docs) ? querySnapshot.docs : null;
    if (
      !documents
      || querySnapshot?.empty !== (documents.length === 0)
      || documents.length > ACCOUNT_DIAMOND_RECONCILIATION_PAGE_SIZE
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'Diamond Auth-deletion candidate discovery returned an invalid page.'
      );
    }
    for (const document of documents) {
      await processDocument(document);
    }
    const next = {
      ...observed,
      status: documents.length < ACCOUNT_DIAMOND_RECONCILIATION_PAGE_SIZE
        ? 'complete'
        : 'scanning',
      cursorPath: documents.length
        ? documents.at(-1).ref.path
        : observed.cursorPath
    };
    let advanced = false;
    try {
      advanced = await firestore.runTransaction(async (transaction) => {
        const [barrierSnapshot, currentScanSnapshot] = await Promise.all([
          transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
          transaction.get(scanRef)
        ]);
        requireAccountDiamondDeletionBarrier(
          barrierSnapshot,
          uid,
          ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
        );
        const current = parseReconciliationScan(currentScanSnapshot, expected);
        if (
          current.epoch !== observed.epoch
          || current.status !== observed.status
          || current.cursorPath !== observed.cursorPath
        ) return false;
        transaction.set(scanRef, next);
        return true;
      });
    } catch (error) {
      let reconciled = null;
      try {
        reconciled = parseReconciliationScan(await scanRef.get(), expected);
      } catch {
        throw error;
      }
      const includesAdvance = reconciled.epoch === observed.epoch && (
        reconciled.status === 'complete'
        || (typeof reconciled.cursorPath === 'string'
          && typeof next.cursorPath === 'string'
          && reconciled.cursorPath >= next.cursorPath)
      );
      if (!includesAdvance) throw error;
      advanced = true;
    }
    if (advanced) pageBudget.remaining = Math.max(0, pageBudget.remaining - 1);
    if (advanced && next.status === 'complete') return;
  }
}

async function runDurableReconciliationTaskScan({
  firestore,
  uid,
  barrier,
  documentIdField,
  pageBudget,
  processDocument
}) {
  const source = 'existing-tasks';
  const scanRef = firestore.doc(reconciliationScanPath(uid, source));
  const expected = {
    source,
    collectionGroup: ACCOUNT_DIAMOND_RECONCILIATION_COLLECTION,
    field: 'document-id',
    startedAt: barrier.startedAt
  };
  const taskCollection = firestore.collection(
    `${directAuthDeletionBarrierPath(uid)}/${ACCOUNT_DIAMOND_RECONCILIATION_COLLECTION}`
  );
  while (true) {
    const observed = parseReconciliationScan(await scanRef.get(), expected);
    if (observed.status === 'complete') return;
    if (!pageBudget || pageBudget.remaining <= 0) {
      throw accountDiamondPrivateNoteError(
        'unavailable',
        'Diamond Auth-deletion task recovery made bounded durable progress; retry is required.'
      );
    }
    let query = taskCollection
      .orderBy(documentIdField)
      .limit(ACCOUNT_DIAMOND_RECONCILIATION_PAGE_SIZE);
    if (observed.cursorPath) {
      query = query.startAfter(firestore.doc(observed.cursorPath));
    }
    const querySnapshot = await query.get();
    const documents = Array.isArray(querySnapshot?.docs) ? querySnapshot.docs : null;
    if (
      !documents
      || querySnapshot?.empty !== (documents.length === 0)
      || documents.length > ACCOUNT_DIAMOND_RECONCILIATION_PAGE_SIZE
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'Diamond Auth-deletion task recovery returned an invalid page.'
      );
    }
    for (const document of documents) await processDocument(document);
    const next = {
      ...observed,
      status: documents.length < ACCOUNT_DIAMOND_RECONCILIATION_PAGE_SIZE
        ? 'complete'
        : 'scanning',
      cursorPath: documents.length
        ? documents.at(-1).ref.path
        : observed.cursorPath
    };
    let advanced = false;
    try {
      advanced = await firestore.runTransaction(async (transaction) => {
        const [barrierSnapshot, currentScanSnapshot] = await Promise.all([
          transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
          transaction.get(scanRef)
        ]);
        requireAccountDiamondDeletionBarrier(
          barrierSnapshot,
          uid,
          ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
        );
        const current = parseReconciliationScan(currentScanSnapshot, expected);
        if (
          current.epoch !== observed.epoch
          || current.status !== observed.status
          || current.cursorPath !== observed.cursorPath
        ) return false;
        transaction.set(scanRef, next);
        return true;
      });
    } catch (error) {
      let reconciled = null;
      try {
        reconciled = parseReconciliationScan(await scanRef.get(), expected);
      } catch {
        throw error;
      }
      if (reconciled.epoch > observed.epoch) {
        advanced = false;
        continue;
      }
      const includesAdvance = reconciled.epoch === observed.epoch && (
        reconciled.status === 'complete'
        || (typeof reconciled.cursorPath === 'string'
          && typeof next.cursorPath === 'string'
          && reconciled.cursorPath >= next.cursorPath)
      );
      if (!includesAdvance) throw error;
      advanced = true;
    }
    if (advanced && documents.length) {
      pageBudget.remaining = Math.max(0, pageBudget.remaining - 1);
    }
    if (advanced && next.status === 'complete') return;
  }
}

function scorebookIdentityFromPath(path, pattern) {
  const match = pattern.exec(typeof path === 'string' ? path : '');
  if (!match || !isValidAccountUid(match[1]) || !isValidAccountUid(match[2])) return null;
  const [, teamId, gameId, documentId] = match;
  return {
    teamId,
    gameId,
    documentId,
    scorebookPath: `teams/${teamId}/games/${gameId}/diamondScorebooks/v2`
  };
}

function canonicalReconciliationEvent(snapshot, identity, expectedInstanceId = null) {
  const value = snapshot?.exists === true ? snapshot.data() || {} : null;
  if (
    !value
    || value.eventId !== identity.documentId
    || !isValidAccountUid(value.commandId)
    || !isValidAccountUid(value.instanceId)
    || (expectedInstanceId && value.instanceId !== expectedInstanceId)
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < 1
    || value.revision !== value.sequence
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'A stale Diamond event has an invalid canonical identity.'
    );
  }
  const { instanceId, ...event } = value;
  return { event, instanceId };
}

async function staleDiamondMutationCandidate({
  firestore,
  uid,
  authDeleteEventMs,
  snapshot,
  kind
}) {
  if (kind === 'event' || kind === 'handoff') {
    const identity = scorebookIdentityFromPath(snapshot?.ref?.path, DIAMOND_EVENT_PATH_PATTERN);
    if (!identity) return null;
    const commitMs = requireSnapshotCommitMillis(snapshot);
    if (commitMs < authDeleteEventMs) return null;
    const { event, instanceId } = canonicalReconciliationEvent(snapshot, identity);
    if (kind === 'event' && event.actorUid !== uid) {
      throwDiamondPrivateNoteIntegrityFailure(
        'A stale Diamond event actor has an invalid identity.'
      );
    }
    if (kind === 'handoff' && (
      event.type !== 'scorer_handoff' || event.payload?.toUid !== uid
    )) {
      throwDiamondPrivateNoteIntegrityFailure(
        'A stale Diamond scorer handoff target has an invalid identity.'
      );
    }
    return {
      ...identity,
      kind,
      sourcePath: snapshot.ref.path,
      sourceCommitMs: commitMs,
      sequence: event.sequence,
      eventId: event.eventId,
      commandId: event.commandId,
      instanceId
    };
  }
  if (kind === 'note') {
    const paths = diamondPrivateNoteCore.diamondPrivateNotePathsFromNotePath(snapshot?.ref?.path);
    if (!paths) return null;
    const commitMs = requireSnapshotCommitMillis(snapshot);
    if (commitMs < authDeleteEventMs) return null;
    const note = snapshot.data() || {};
    if (
      note.authorUid !== uid
      || note.eventId !== paths.eventId
      || !isValidAccountUid(note.commandId)
      || !isValidAccountUid(note.instanceId)
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'A stale Diamond private-note sidecar has an invalid identity.'
      );
    }
    const eventSnapshot = await firestore.doc(paths.event).get();
    const identity = scorebookIdentityFromPath(paths.event, DIAMOND_EVENT_PATH_PATTERN);
    if (!identity) {
      throwDiamondPrivateNoteIntegrityFailure(
        'A stale Diamond private-note event path is malformed.'
      );
    }
    const eventCommitMs = requireSnapshotCommitMillis(eventSnapshot);
    if (!timestampsExactlyEqual(snapshot.createTime, eventSnapshot.createTime)) {
      throwDiamondPrivateNoteIntegrityFailure(
        'A stale Diamond private-note sidecar is not atomic with its event.'
      );
    }
    const { event, instanceId } = canonicalReconciliationEvent(
      eventSnapshot,
      identity,
      note.instanceId
    );
    if (event.commandId !== note.commandId) {
      throwDiamondPrivateNoteIntegrityFailure(
        'A stale Diamond private-note sidecar does not match its canonical event.'
      );
    }
    return {
      ...identity,
      kind: 'note',
      sourcePath: snapshot.ref.path,
      sourceCommitMs: commitMs,
      canonicalEventPath: paths.event,
      canonicalEventCommitMs: eventCommitMs,
      sequence: event.sequence,
      eventId: event.eventId,
      commandId: event.commandId,
      instanceId
    };
  }
  throw new TypeError('Unknown Diamond Auth-deletion mutation scan kind.');
}

async function loadCanonicalDiamondHistory(firestore, scorebookPath) {
  const documents = [];
  let afterSequence = 0;
  while (documents.length <= ACCOUNT_DIAMOND_MAX_CANONICAL_EVENTS) {
    const pageSize = Math.min(
      ACCOUNT_DIAMOND_RECONCILIATION_PAGE_SIZE,
      ACCOUNT_DIAMOND_MAX_CANONICAL_EVENTS + 1 - documents.length
    );
    const snapshot = await firestore.collection(`${scorebookPath}/events`)
      .where('sequence', '>', afterSequence)
      .orderBy('sequence', 'asc')
      .limit(pageSize)
      .get();
    const page = Array.isArray(snapshot?.docs) ? snapshot.docs : null;
    if (!page || page.length > pageSize) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The Diamond ledger rewind returned an invalid history page.'
      );
    }
    if (!page.length) return documents;
    for (const document of page) {
      const identity = scorebookIdentityFromPath(document?.ref?.path, DIAMOND_EVENT_PATH_PATTERN);
      if (!identity || identity.scorebookPath !== scorebookPath) {
        throwDiamondPrivateNoteIntegrityFailure(
          'The Diamond ledger rewind crossed a scorebook boundary.'
        );
      }
      const canonical = canonicalReconciliationEvent(document, identity);
      if (canonical.event.sequence !== afterSequence + 1) {
        throwDiamondPrivateNoteIntegrityFailure(
          'The Diamond ledger rewind found a sequence gap.'
        );
      }
      documents.push({ snapshot: document, identity, ...canonical });
      afterSequence = canonical.event.sequence;
    }
    if (documents.length > ACCOUNT_DIAMOND_MAX_CANONICAL_EVENTS) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The Diamond ledger rewind exceeded its canonical event bound.'
      );
    }
    if (page.length < pageSize) return documents;
  }
  throwDiamondPrivateNoteIntegrityFailure(
    'The Diamond ledger rewind exceeded its canonical event bound.'
  );
}

function verifyCanonicalDiamondHistory(root, history, identity) {
  if (
    !root
    || root.schemaVersion !== 2
    || root.trackingEngine !== diamondPrivateNoteCore.DIAMOND_ENGINE
    || root.teamId !== identity.teamId
    || root.gameId !== identity.gameId
    || root.instanceId !== identity.instanceId
    || !root.initialState
    || !root.checkpoint
    || root.checkpoint.sequence !== history.length
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The Diamond ledger root changed before rewind fencing.'
    );
  }
  let fullReplay;
  try {
    fullReplay = diamondDomainEngine.replayDiamondEvents(
      root.initialState,
      history.map(({ event }) => event)
    );
  } catch {
    throwDiamondPrivateNoteIntegrityFailure(
      'The Diamond ledger failed canonical replay before rewind.'
    );
  }
  if (
    fullReplay.checkpointHash !== root.checkpoint.previousHash
    || diamondDomainEngine.hashDiamondValue(fullReplay.state)
      !== diamondDomainEngine.hashDiamondValue(root.checkpoint.state)
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The Diamond ledger root does not match its canonical history.'
    );
  }
}

function requireReconciliationTask(value, expected = {}) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schemaVersion !== 1
    || value.type !== ACCOUNT_DIAMOND_RECONCILIATION_TYPE
    || !['retiring', 'complete'].includes(value.status)
    || !/^[a-f0-9]{64}$/.test(value.taskId || '')
    || (expected.taskId && value.taskId !== expected.taskId)
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The Diamond Auth-deletion reconciliation task is malformed.'
    );
  }
  if (value.status === 'complete') {
    if (
      Object.keys(value).sort().join('\0')
        !== ['completedAt', 'outcome', 'receiptHash', 'schemaVersion', 'status', 'taskId', 'type'].join('\0')
      || value.outcome !== 'generation-retired'
      || !DIAMOND_HASH_PATTERN.test(value.receiptHash || '')
      || !isExactIsoTimestamp(value.completedAt)
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The terminal Diamond Auth-deletion receipt is malformed.'
      );
    }
    return value;
  }
  if (
    !isValidAccountUid(value.teamId)
    || !isValidAccountUid(value.gameId)
    || !isValidAccountUid(value.instanceId)
    || !Number.isSafeInteger(value.throughSequence)
    || value.throughSequence < 1
    || (expected.teamId && value.teamId !== expected.teamId)
    || (expected.gameId && value.gameId !== expected.gameId)
    || (expected.instanceId && value.instanceId !== expected.instanceId)
    || !isExactIsoTimestamp(value.startedAt)
    || Object.keys(value).sort().join('\0') !== [
      'activationGameRollback', 'activationRollbackCreatedAt',
      'activationRollbackHash', 'activationSharedGameRollback',
      'activationSharedWithdrawal', 'artifactInventory',
      'expectedRootCheckpointHash', 'gameId',
      'instanceId', 'schemaVersion', 'sourceCommitMs', 'sourcePath',
      'startedAt', 'status', 'taskId', 'teamId', 'throughSequence', 'type'
    ].sort().join('\0')
    || !DIAMOND_HASH_PATTERN.test(value.activationRollbackHash || '')
    || !DIAMOND_HASH_PATTERN.test(value.expectedRootCheckpointHash || '')
    || !isExactIsoTimestamp(value.activationRollbackCreatedAt)
    || !Number.isSafeInteger(value.sourceCommitMs)
    || value.sourceCommitMs < 0
    || !(DIAMOND_EVENT_PATH_PATTERN.test(value.sourcePath || '')
      || diamondPrivateNoteCore.diamondPrivateNotePathsFromNotePath(value.sourcePath))
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The active Diamond Auth-deletion reconciliation task is malformed.'
    );
  }
  const gameRollback = requireRollbackBeforeImage(
    value.activationGameRollback,
    'Diamond activation game',
    DIAMOND_ACTIVATION_GAME_ROLLBACK_FIELDS
  );
  const sharedRollback = value.activationSharedGameRollback === null
    ? null
    : requireRollbackBeforeImage(
      value.activationSharedGameRollback,
      'Diamond activation shared-game',
      DIAMOND_SHARED_PROJECTION_FIELDS,
      true
    );
  requireSharedWithdrawalMode(value.activationSharedWithdrawal, sharedRollback);
  if (diamondDomainEngine.hashDiamondValue({
    schemaVersion: 1,
    type: 'diamond-activation-rollback-provenance',
    trackingEngine: diamondPrivateNoteCore.DIAMOND_ENGINE,
    teamId: value.teamId,
    gameId: value.gameId,
    instanceId: value.instanceId,
    game: gameRollback,
    sharedGame: sharedRollback,
    createdAt: value.activationRollbackCreatedAt
  }) !== value.activationRollbackHash) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The active Diamond Auth-deletion rollback provenance is corrupt.'
    );
  }
  requireReconciliationArtifactInventory(value.artifactInventory, value);
  return value;
}

function reconciliationFence(task) {
  return {
    schemaVersion: 1,
    type: ACCOUNT_DIAMOND_RECONCILIATION_TYPE,
    status: 'retiring',
    taskId: task.taskId,
    instanceId: task.instanceId,
    throughSequence: task.throughSequence,
    startedAt: task.startedAt
  };
}

function sameReconciliationFence(root, task) {
  return diamondDomainEngine.hashDiamondValue(root?.authDeleteReconciliation || null)
    === diamondDomainEngine.hashDiamondValue(reconciliationFence(task));
}

function requireRollbackBeforeImage(value, label, expectedFields, shared = false) {
  const expectedTopLevelKeys = shared
    ? ['existed', 'fields', 'path', 'schemaVersion']
    : ['fields', 'schemaVersion'];
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schemaVersion !== 1
    || Object.keys(value).sort().join('\0') !== expectedTopLevelKeys.sort().join('\0')
    || (shared && (typeof value.existed !== 'boolean'
      || !/^(organizations|tournaments)\/[^/]+\/sharedGames\/[^/]+$/.test(value.path)
      || value.path.split('/').some((part) => !part || part === '.' || part === '..' || part.length > 128)))
    || !value.fields
    || typeof value.fields !== 'object'
    || Array.isArray(value.fields)
  ) {
    throwDiamondPrivateNoteIntegrityFailure(`The ${label} rollback before-image is missing.`);
  }
  if (
    Object.keys(value.fields).sort().join('\0')
    !== [...expectedFields].sort().join('\0')
  ) {
    throwDiamondPrivateNoteIntegrityFailure(`The ${label} rollback field set is malformed.`);
  }
  for (const entry of Object.values(value.fields)) {
    if (
      !entry
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || typeof entry.present !== 'boolean'
      || (entry.present && !Object.prototype.hasOwnProperty.call(entry, 'value'))
      || (!entry.present && Object.keys(entry).some((key) => key !== 'present'))
    ) {
      throwDiamondPrivateNoteIntegrityFailure(`The ${label} rollback before-image is malformed.`);
    }
  }
  return value;
}

function rollbackPatch(beforeImage, deleteFieldValue) {
  return Object.fromEntries(
    Object.entries(beforeImage.fields).map(([field, entry]) => [
      field,
      entry.present ? entry.value : deleteFieldValue()
    ])
  );
}

function requireSharedWithdrawalMode(value, sharedRollback) {
  const allowed = new Set([
    'none',
    'sentinel-restore',
    'sentinel-delete',
    'absent',
    'preserved'
  ]);
  if (
    typeof value !== 'string'
    || !allowed.has(value)
    || (!sharedRollback && value !== 'none')
    || (sharedRollback && value === 'none')
    || (value === 'sentinel-restore' && sharedRollback?.existed !== true)
    || (['sentinel-delete', 'absent'].includes(value)
      && sharedRollback?.existed !== false)
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The Diamond shared-game retirement mode is malformed.'
    );
  }
  return value;
}

function retirementWithdrawalPatch(fields, retained, deleteFieldValue) {
  return Object.fromEntries(
    fields
      .filter((field) => !retained.has(field))
      .map((field) => [field, deleteFieldValue()])
  );
}

function reconciliationRetiringGeneration(task) {
  return `auth-delete-${task.taskId}`;
}

function retiringGameFieldsMatch(game, task) {
  if (
    !game
    || game.trackingEngine !== diamondPrivateNoteCore.DIAMOND_ENGINE
    || game.diamondScorebookInstanceId !== reconciliationRetiringGeneration(task)
  ) return false;
  return DIAMOND_ACTIVATION_GAME_ROLLBACK_FIELDS.every((field) => (
    field === 'trackingEngine'
    || field === 'diamondScorebookInstanceId'
    || !Object.prototype.hasOwnProperty.call(game, field)
  ));
}

function oldGenerationGameFieldsMatch(game, task) {
  return Boolean(
    game
    && game.trackingEngine === diamondPrivateNoteCore.DIAMOND_ENGINE
    && game.diamondScorebookInstanceId === task.instanceId
  );
}

function retiringSharedFieldsMatch(shared, task) {
  if (
    !shared
    || shared.trackingEngine !== diamondPrivateNoteCore.DIAMOND_ENGINE
    || shared.diamondSourceTeamId !== task.teamId
    || shared.diamondSourceGameId !== task.gameId
    || shared.diamondScorebookInstanceId !== reconciliationRetiringGeneration(task)
  ) return false;
  return DIAMOND_SHARED_PROJECTION_FIELDS.every((field) => (
    [
      'trackingEngine',
      'diamondSourceTeamId',
      'diamondSourceGameId',
      'diamondScorebookInstanceId'
    ].includes(field)
    || !Object.prototype.hasOwnProperty.call(shared, field)
  ));
}

function oldGenerationSharedFieldsMatch(shared, task) {
  return Boolean(
    shared
    && shared.trackingEngine === diamondPrivateNoteCore.DIAMOND_ENGINE
    && shared.diamondSourceTeamId === task.teamId
    && shared.diamondSourceGameId === task.gameId
    && shared.diamondScorebookInstanceId === task.instanceId
  );
}

function requireActivationRollbackProvenance(value, root, candidate) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [
      'createdAt', 'game', 'gameId', 'instanceId', 'schemaVersion',
      'sharedGame', 'teamId', 'trackingEngine', 'type'
    ].sort().join('\0')
    || value.schemaVersion !== 1
    || value.type !== 'diamond-activation-rollback-provenance'
    || value.trackingEngine !== diamondPrivateNoteCore.DIAMOND_ENGINE
    || value.teamId !== candidate.teamId
    || value.gameId !== candidate.gameId
    || value.instanceId !== candidate.instanceId
    || !isExactIsoTimestamp(value.createdAt)
    || diamondDomainEngine.hashDiamondValue(value) !== root.activationRollbackHash
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The Diamond activation rollback provenance is missing or corrupt.'
    );
  }
  requireRollbackBeforeImage(
    value.game,
    'Diamond activation game',
    DIAMOND_ACTIVATION_GAME_ROLLBACK_FIELDS
  );
  if (value.sharedGame !== null) {
    requireRollbackBeforeImage(
      value.sharedGame,
      'Diamond activation shared-game',
      DIAMOND_SHARED_PROJECTION_FIELDS,
      true
    );
  }
  return value;
}

async function stageDiamondReconciliationTask({
  firestore,
  uid,
  barrier,
  authDeleteEventMs,
  candidate,
  deleteFieldValue
}) {
  const taskPath = reconciliationTaskPath(uid, candidate.scorebookPath);
  const taskRef = firestore.doc(taskPath);
  const taskScanRef = firestore.doc(reconciliationScanPath(uid, 'existing-tasks'));
  const existingTaskSnapshot = await taskRef.get();
  if (existingTaskSnapshot?.exists) {
    return { ref: taskRef, task: requireReconciliationTask(existingTaskSnapshot.data() || {}) };
  }
  const rootRef = firestore.doc(candidate.scorebookPath);
  const rootSnapshot = await rootRef.get();
  const root = rootSnapshot?.exists ? rootSnapshot.data() || {} : null;
  const provenanceRef = firestore.doc(`${candidate.scorebookPath}/audit/activation-provenance`);
  const provenanceSnapshot = await provenanceRef.get();
  const provenance = requireActivationRollbackProvenance(
    provenanceSnapshot?.exists ? provenanceSnapshot.data() || {} : null,
    root || {},
    candidate
  );
  const history = await loadCanonicalDiamondHistory(firestore, candidate.scorebookPath);
  verifyCanonicalDiamondHistory(root, history, candidate);
  const taskId = taskPath.split('/').at(-1);
  const taskIdentity = {
    schemaVersion: 1,
    type: ACCOUNT_DIAMOND_RECONCILIATION_TYPE,
    status: 'retiring',
    taskId,
    teamId: candidate.teamId,
    gameId: candidate.gameId,
    instanceId: candidate.instanceId,
    throughSequence: root.checkpoint.sequence,
    activationGameRollback: provenance.game,
    activationSharedGameRollback: provenance.sharedGame,
    activationRollbackHash: root.activationRollbackHash,
    activationRollbackCreatedAt: provenance.createdAt,
    expectedRootCheckpointHash: root.checkpoint.previousHash,
    sourcePath: candidate.sourcePath,
    sourceCommitMs: candidate.sourceCommitMs,
    startedAt: barrier.startedAt
  };
  let stagedExpectedTask = null;
  const gameRef = firestore.doc(`teams/${candidate.teamId}/games/${candidate.gameId}`);
  const publicStateRef = firestore.doc(`teams/${candidate.teamId}/games/${candidate.gameId}/diamondPublic/state`);
  const publicReplayRef = firestore.doc(`teams/${candidate.teamId}/games/${candidate.gameId}/diamondPublic/replay`);
  const privateProjectionRef = firestore.doc(`${candidate.scorebookPath}/projections/current`);
  const cleanupLockRef = firestore.doc(`teams/${candidate.teamId}/diamondCleanupLocks/${candidate.gameId}`);
  await firestore.runTransaction(async (transaction) => {
    const sharedRollback = taskIdentity.activationSharedGameRollback;
    if (sharedRollback) {
      requireRollbackBeforeImage(
        sharedRollback,
        'Diamond activation shared-game',
        DIAMOND_SHARED_PROJECTION_FIELDS,
        true
      );
      if (typeof sharedRollback.path !== 'string' || !sharedRollback.path) {
        throwDiamondPrivateNoteIntegrityFailure(
          'The Diamond activation shared-game rollback path is malformed.'
        );
      }
    }
    const [
      barrierSnapshot,
      taskSnapshot,
      taskScanSnapshot,
      currentRootSnapshot,
      gameSnapshot,
      sourceSnapshot,
      cleanupLockSnapshot,
      sharedSnapshot,
      currentProvenanceSnapshot,
      publicStateSnapshot,
      publicReplaySnapshot,
      privateProjectionSnapshot,
      canonicalEventSnapshot
    ] =
      await Promise.all([
        transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
        transaction.get(taskRef),
        transaction.get(taskScanRef),
        transaction.get(rootRef),
        transaction.get(gameRef),
        transaction.get(firestore.doc(candidate.sourcePath)),
        transaction.get(cleanupLockRef),
        sharedRollback
          ? transaction.get(firestore.doc(sharedRollback.path))
          : Promise.resolve(null),
        transaction.get(provenanceRef),
        transaction.get(publicStateRef),
        transaction.get(publicReplayRef),
        transaction.get(privateProjectionRef),
        candidate.kind === 'note'
          ? transaction.get(firestore.doc(candidate.canonicalEventPath))
          : Promise.resolve(null)
      ]);
    requireAccountDiamondDeletionBarrier(
      barrierSnapshot,
      uid,
      ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
    );
    if (taskSnapshot?.exists) {
      stagedExpectedTask = requireReconciliationTask(taskSnapshot.data() || {}, taskIdentity);
      return;
    }
    const taskScan = parseReconciliationScan(taskScanSnapshot, {
      source: 'existing-tasks',
      collectionGroup: ACCOUNT_DIAMOND_RECONCILIATION_COLLECTION,
      field: 'document-id',
      startedAt: barrier.startedAt
    });
    if (taskScan.epoch >= Number.MAX_SAFE_INTEGER) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The durable Diamond Auth-deletion task epoch is exhausted.'
      );
    }
    const currentRoot = currentRootSnapshot?.exists ? currentRootSnapshot.data() || {} : null;
    const game = gameSnapshot?.exists ? gameSnapshot.data() || {} : null;
    if (
      !currentRoot
      || currentRoot.instanceId !== taskIdentity.instanceId
      || currentRoot.checkpoint?.sequence !== taskIdentity.throughSequence
      || currentRoot.checkpoint?.previousHash !== taskIdentity.expectedRootCheckpointHash
      || currentRoot.authDeleteReconciliation
      || currentRoot.activationRollbackHash !== taskIdentity.activationRollbackHash
      || !game
      || game.trackingEngine !== diamondPrivateNoteCore.DIAMOND_ENGINE
      || game.diamondScorebookInstanceId !== taskIdentity.instanceId
      || (cleanupLockSnapshot?.exists && cleanupLockSnapshot.data()?.status === 'deleting')
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The Diamond scorebook changed before its Auth-deletion fence won.'
      );
    }
    if (
      (publicStateSnapshot?.exists
        && !isReconciliationOwnedDocument(publicStateSnapshot.data() || {}, taskIdentity))
      || (publicReplaySnapshot?.exists
        && !isReconciliationOwnedDocument(publicReplaySnapshot.data() || {}, taskIdentity))
      || (privateProjectionSnapshot?.exists
        && !isReconciliationOwnedScorebookChild(
          privateProjectionSnapshot.data() || {},
          taskIdentity
        ))
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'A public Diamond projection belongs to a different generation.'
      );
    }
    const currentProvenance = currentProvenanceSnapshot?.exists
      ? currentProvenanceSnapshot.data() || {}
      : null;
    requireSnapshotCommitMillis(currentProvenanceSnapshot);
    if (
      diamondDomainEngine.hashDiamondValue(currentProvenance)
      !== taskIdentity.activationRollbackHash
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The Diamond activation rollback provenance changed before fencing.'
      );
    }
    const sourceCommitMs = requireSnapshotCommitMillis(sourceSnapshot);
    const source = sourceSnapshot?.exists ? sourceSnapshot.data() || {} : null;
    const canonicalNoteEvent = candidate.kind === 'note'
      ? canonicalEventSnapshot?.data?.() || null
      : null;
    const canonicalNoteEventCommitMs = candidate.kind === 'note'
      ? requireSnapshotCommitMillis(canonicalEventSnapshot)
      : null;
    if (
      sourceCommitMs < authDeleteEventMs
      || sourceCommitMs !== taskIdentity.sourceCommitMs
      || (candidate.kind === 'event' && (
        sourceSnapshot.ref?.path !== candidate.sourcePath
        || source?.actorUid !== uid
        || source?.eventId !== candidate.eventId
        || source?.commandId !== candidate.commandId
        || source?.instanceId !== candidate.instanceId
        || source?.sequence !== candidate.sequence
      ))
      || (candidate.kind === 'handoff' && (
        sourceSnapshot.ref?.path !== candidate.sourcePath
        || source?.type !== 'scorer_handoff'
        || source?.payload?.toUid !== uid
        || source?.eventId !== candidate.eventId
        || source?.commandId !== candidate.commandId
        || source?.instanceId !== candidate.instanceId
        || source?.sequence !== candidate.sequence
      ))
      || (candidate.kind === 'note' && (
        sourceSnapshot.ref?.path !== candidate.sourcePath
        || source?.authorUid !== uid
        || source?.eventId !== candidate.eventId
        || source?.commandId !== candidate.commandId
        || source?.instanceId !== candidate.instanceId
        || canonicalEventSnapshot?.ref?.path !== candidate.canonicalEventPath
        || canonicalNoteEventCommitMs !== candidate.canonicalEventCommitMs
        || !timestampsExactlyEqual(
          sourceSnapshot.createTime,
          canonicalEventSnapshot.createTime
        )
        || canonicalNoteEvent?.eventId !== candidate.eventId
        || canonicalNoteEvent?.commandId !== candidate.commandId
        || canonicalNoteEvent?.instanceId !== candidate.instanceId
        || canonicalNoteEvent?.sequence !== candidate.sequence
        || canonicalNoteEvent?.revision !== candidate.sequence
      ))
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The stale Diamond mutation could not be proven at fence commit.'
      );
    }
    const shared = sharedSnapshot?.exists ? sharedSnapshot.data() || {} : null;
    const sharedOwned = Boolean(
      sharedRollback
      && shared
      && shared.trackingEngine === diamondPrivateNoteCore.DIAMOND_ENGINE
      && shared.diamondSourceTeamId === taskIdentity.teamId
      && shared.diamondSourceGameId === taskIdentity.gameId
      && shared.diamondScorebookInstanceId === taskIdentity.instanceId
    );
    let activationSharedWithdrawal = 'none';
    if (sharedRollback) {
      if (sharedOwned) {
        activationSharedWithdrawal = sharedRollback.existed
          ? 'sentinel-restore'
          : 'sentinel-delete';
      } else if (!shared) {
        if (sharedRollback.existed) {
          throwDiamondPrivateNoteIntegrityFailure(
            'The shared-game projection disappeared before retirement fencing.'
          );
        }
        activationSharedWithdrawal = 'absent';
      } else {
        activationSharedWithdrawal = 'preserved';
      }
    }
    const task = {
      ...taskIdentity,
      activationSharedWithdrawal,
      artifactInventory: buildInitialReconciliationArtifactInventory(taskIdentity)
    };
    stagedExpectedTask = task;
    transaction.create(taskRef, task);
    transaction.set(taskScanRef, {
      schemaVersion: 1,
      type: ACCOUNT_DIAMOND_RECONCILIATION_SCAN_TYPE,
      source: 'existing-tasks',
      collectionGroup: ACCOUNT_DIAMOND_RECONCILIATION_COLLECTION,
      field: 'document-id',
      status: 'scanning',
      cursorPath: null,
      epoch: taskScan.epoch + 1,
      startedAt: barrier.startedAt
    });
    transaction.update(rootRef, {
      authDeleteReconciliation: reconciliationFence(task),
      projectionStatus: 'blocked',
      projectionLease: null,
      projectionFailure: {
        code: 'auth-delete-reconciliation',
        retryable: true,
        sourceRevision: task.throughSequence
      },
      projectionRequest: null,
      diamondProjectionMarker: null,
      scorerLease: null,
      recentPublicEvents: []
    });
    transaction.update(gameRef, {
      ...retirementWithdrawalPatch(
        DIAMOND_ACTIVATION_GAME_ROLLBACK_FIELDS,
        new Set(['trackingEngine', 'diamondScorebookInstanceId']),
        deleteFieldValue
      ),
      diamondScorebookInstanceId: reconciliationRetiringGeneration(task)
    });
    transaction.set(cleanupLockRef, {
      schemaVersion: 1,
      generation: task.instanceId,
      status: 'deleting',
      complete: false,
      reason: 'auth-delete-reconciliation',
      updatedAt: barrier.startedAt
    });
    if (sharedRollback) {
      if (sharedOwned) {
        transaction.update(sharedSnapshot.ref, {
          ...retirementWithdrawalPatch(
            DIAMOND_SHARED_PROJECTION_FIELDS,
            new Set([
              'trackingEngine',
              'diamondSourceTeamId',
              'diamondSourceGameId',
              'diamondScorebookInstanceId'
            ]),
            deleteFieldValue
          ),
          diamondScorebookInstanceId: reconciliationRetiringGeneration(task)
        });
      }
    }
    transaction.delete(publicStateRef);
    transaction.delete(publicReplayRef);
    transaction.delete(privateProjectionRef);
  });
  const staged = await taskRef.get();
  return {
    ref: taskRef,
    task: requireReconciliationTask(staged.data() || {}, stagedExpectedTask || taskIdentity)
  };
}

function isReconciliationOwnedDocument(value, task) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const gameIds = [value.gameId, value.diamondGameId]
    .filter((candidate) => candidate !== null && candidate !== undefined);
  const generations = [
    value.instanceId,
    value.diamondScorebookInstanceId,
    value.projectionGeneration
  ].filter((candidate) => candidate !== null && candidate !== undefined);
  return value.trackingEngine === diamondPrivateNoteCore.DIAMOND_ENGINE
    && value.teamId === task.teamId
    && gameIds.length > 0
    && gameIds.every((candidate) => candidate === task.gameId)
    && value.instanceId === task.instanceId
    && generations.every((candidate) => candidate === task.instanceId);
}

function isReconciliationOwnedScorebookChild(value, task) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.instanceId !== task.instanceId
  ) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'trackingEngine')
    && value.trackingEngine !== diamondPrivateNoteCore.DIAMOND_ENGINE) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'teamId')
    && value.teamId !== task.teamId) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'gameId')
    && value.gameId !== task.gameId) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'diamondGameId')
    && value.diamondGameId !== task.gameId) return false;
  return [value.diamondScorebookInstanceId, value.projectionGeneration]
    .filter((candidate) => candidate !== null && candidate !== undefined)
    .every((candidate) => candidate === task.instanceId);
}

function hasOnlySafeNotificationReceiptFields(value) {
  const allowed = new Set([
    'schemaVersion', 'trackingEngine', 'receiptId', 'teamId', 'gameId',
    'instanceId', 'sourceRevision', 'sourceEventId', 'idempotencyKey',
    'requestHash', 'status', 'attemptCount', 'dispatchLease',
    'providerDispatch', 'providerRequestId', 'updatedAt', 'createdAt',
    'nextAttemptAtMs', 'lastDeliveryError', 'lastMutationId',
    'providerOutcome', 'providerReceiptId', 'completedAt'
  ]);
  if (Object.keys(value).some((field) => !allowed.has(field))) return false;
  const nestedFieldsAreAllowed = (nested, fields) => nested === null
    || nested === undefined
    || (nested && typeof nested === 'object' && !Array.isArray(nested)
      && Object.keys(nested).every((field) => fields.has(field)));
  return nestedFieldsAreAllowed(
    value.dispatchLease,
    new Set(['leaseId', 'requestHash', 'attempt', 'acquiredAtMs', 'expiresAtMs'])
  ) && nestedFieldsAreAllowed(
    value.providerDispatch,
    new Set(['attemptId', 'requestHash', 'attempt', 'startedAtMs'])
  ) && nestedFieldsAreAllowed(
    value.lastDeliveryError,
    new Set(['code', 'failedAt', 'attempt'])
  );
}

function reconciliationCollectionInventory(task) {
  const game = `teams/${task.teamId}/games/${task.gameId}`;
  const scorebook = `${game}/diamondScorebooks/v2`;
  const publicState = `${game}/diamondPublic/state`;
  const publicReplay = `${game}/diamondPublic/replay`;
  const statGeneration = `${game}/diamondStatGenerations/${task.instanceId}`;
  const liveGeneration = `${game}/diamondLiveGenerations/${task.instanceId}`;
  return [
    ...[
      ['events', 'events'],
      ['commands', 'commands'],
      ['notes', 'notes'],
      ['audit', 'audit'],
      ['projections', 'projections'],
      ['projection-runs', 'projectionRuns'],
      ['effects', 'effects'],
      ['ai-publication-receipts', 'aiPublicationReceipts'],
      ['ai-publication-audit', 'aiPublicationAudit']
    ].map(([id, collectionId]) => ({
      id: `scorebook-${id}`,
      path: `${scorebook}/${collectionId}`,
      kind: 'scorebook',
      filterInstance: false,
      retained: false,
      sibling: false
    })),
    {
      id: 'public-events',
      path: `${publicState}/events`,
      kind: 'scorebook',
      filterInstance: false,
      retained: false,
      sibling: false
    },
    {
      id: 'public-replay-pages',
      path: `${publicReplay}/pages`,
      kind: 'document',
      filterInstance: false,
      retained: false,
      sibling: false
    },
    ...[
      ['public-player-stats', 'publicPlayerStats'],
      ['private-player-stats', 'privatePlayerStats'],
      ['team-stats', 'teamStats']
    ].map(([id, collectionId]) => ({
      id: `stat-${id}`,
      path: `${statGeneration}/${collectionId}`,
      kind: 'document',
      filterInstance: false,
      retained: false,
      sibling: false
    })),
    ...['chat', 'reactions'].map((collectionId) => ({
      id: `live-${collectionId}`,
      path: `${liveGeneration}/${collectionId}`,
      kind: 'document',
      filterInstance: false,
      retained: false,
      sibling: false
    })),
    {
      id: 'notification-receipts',
      path: `${scorebook}/notificationReceipts`,
      kind: 'notification',
      filterInstance: true,
      retained: true,
      sibling: false
    },
    ...[
      ['aggregated-stats', 'aggregatedStats'],
      ['private-player-stats', 'privatePlayerStats'],
      ['team-stats', 'teamStats']
    ].map(([id, collectionId]) => ({
      id: `sibling-${id}`,
      path: `${game}/${collectionId}`,
      kind: 'document',
      filterInstance: true,
      retained: false,
      sibling: true
    }))
  ];
}

function reconciliationProtectedDocumentPaths(task) {
  const game = `teams/${task.teamId}/games/${task.gameId}`;
  return [
    `${game}/diamondPublic/state`,
    `${game}/diamondPublic/replay`,
    `${game}/diamondStatGenerations/${task.instanceId}`,
    `${game}/diamondLiveGenerations/${task.instanceId}`
  ];
}

function reconciliationInventoryPlanHash(task) {
  return diamondDomainEngine.hashDiamondValue({
    schemaVersion: 1,
    sources: reconciliationCollectionInventory(task).map((spec) => ({
      id: spec.id,
      path: spec.path,
      kind: spec.kind,
      filterInstance: spec.filterInstance,
      retained: spec.retained,
      sibling: spec.sibling
    })),
    protectedDocuments: reconciliationProtectedDocumentPaths(task)
  });
}

function buildInitialReconciliationArtifactInventory(task) {
  return {
    schemaVersion: 1,
    status: 'scanning',
    planHash: reconciliationInventoryPlanHash(task),
    sources: Object.fromEntries(
      reconciliationCollectionInventory(task).map((spec) => [spec.id, {
        status: 'scanning',
        cursorPath: null,
        documentsValidated: 0
      }])
    )
  };
}

function requireReconciliationArtifactInventory(value, task) {
  const specs = reconciliationCollectionInventory(task);
  const sourceIds = specs.map((spec) => spec.id).sort();
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).sort().join('\0')
      !== ['planHash', 'schemaVersion', 'sources', 'status'].join('\0')
    || value.schemaVersion !== 1
    || !['scanning', 'complete'].includes(value.status)
    || value.planHash !== reconciliationInventoryPlanHash(task)
    || !value.sources
    || typeof value.sources !== 'object'
    || Array.isArray(value.sources)
    || Object.keys(value.sources).sort().join('\0') !== sourceIds.join('\0')
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The durable Diamond retirement inventory plan is malformed.'
    );
  }
  for (const spec of specs) {
    const source = value.sources[spec.id];
    const cursorIsValid = source?.cursorPath === null || (
      typeof source?.cursorPath === 'string'
      && source.cursorPath.startsWith(`${spec.path}/`)
      && !source.cursorPath.slice(spec.path.length + 1).includes('/')
    );
    if (
      !source
      || typeof source !== 'object'
      || Array.isArray(source)
      || Object.keys(source).sort().join('\0')
        !== ['cursorPath', 'documentsValidated', 'status'].join('\0')
      || !['scanning', 'complete'].includes(source.status)
      || !cursorIsValid
      || !Number.isSafeInteger(source.documentsValidated)
      || source.documentsValidated < 0
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'A durable Diamond retirement inventory cursor is malformed.'
      );
    }
  }
  const everySourceComplete = specs.every(
    (spec) => value.sources[spec.id].status === 'complete'
  );
  if ((value.status === 'complete') !== everySourceComplete) {
    throwDiamondPrivateNoteIntegrityFailure(
      'The durable Diamond retirement inventory completion state is inconsistent.'
    );
  }
  return value;
}

function validateReconciliationInventoryDocument(spec, document, task) {
  if (
    !document?.ref?.path
    || !document.ref.path.startsWith(`${spec.path}/`)
    || document.ref.path.slice(spec.path.length + 1).includes('/')
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'A Diamond retirement inventory page crossed a collection boundary.'
    );
  }
  const value = document.data() || {};
  const owned = spec.kind === 'scorebook' || spec.kind === 'notification'
    ? isReconciliationOwnedScorebookChild(value, task)
    : isReconciliationOwnedDocument(value, task);
  if (!owned || (spec.kind === 'notification' && !hasOnlySafeNotificationReceiptFields(value))) {
    throwDiamondPrivateNoteIntegrityFailure(
      spec.kind === 'notification'
        ? 'Retained Diamond notification evidence is unsafe or belongs to another generation.'
        : 'A Diamond retirement collection contains a foreign generation.'
    );
  }
}

function inventoryProgressIncludes(current, expected, sourceId) {
  if (current.planHash !== expected.planHash) return false;
  const actualSource = current.sources[sourceId];
  const expectedSource = expected.sources[sourceId];
  if (expectedSource.status === 'complete') return actualSource.status === 'complete';
  return actualSource.status === 'complete' || (
    actualSource.documentsValidated >= expectedSource.documentsValidated
    && typeof actualSource.cursorPath === 'string'
    && actualSource.cursorPath >= expectedSource.cursorPath
  );
}

async function inventoryDiamondReconciliationArtifacts({
  firestore,
  documentIdField,
  uid,
  taskRef,
  task,
  pageBudget,
  pageSize
}) {
  let currentTask = requireReconciliationTask(task);
  while (currentTask.status !== 'complete') {
    const inventory = requireReconciliationArtifactInventory(
      currentTask.artifactInventory,
      currentTask
    );
    if (inventory.status === 'complete') return currentTask;
    if (!pageBudget || pageBudget.remaining <= 0) {
      throw accountDiamondPrivateNoteError(
        'unavailable',
        'Diamond retirement inventory made bounded durable progress; retry is required.'
      );
    }
    let expectedAfter = null;
    let expectedSourceId = null;
    try {
      const committedTask = await firestore.runTransaction(async (transaction) => {
        const rootRef = firestore.doc(
          `teams/${currentTask.teamId}/games/${currentTask.gameId}/diamondScorebooks/v2`
        );
        const [barrierSnapshot, taskSnapshot, rootSnapshot] = await Promise.all([
          transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
          transaction.get(taskRef),
          transaction.get(rootRef)
        ]);
        requireAccountDiamondDeletionBarrier(
          barrierSnapshot,
          uid,
          ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
        );
        const transactionalTask = requireReconciliationTask(
          taskSnapshot?.data?.() || {},
          currentTask
        );
        if (transactionalTask.status === 'complete') return transactionalTask;
        const root = rootSnapshot?.exists ? rootSnapshot.data() || {} : null;
        if (!root || !sameReconciliationFence(root, transactionalTask)) {
          throwDiamondPrivateNoteIntegrityFailure(
            'The durable Diamond retirement inventory lost its root fence.'
          );
        }
        const transactionalInventory = requireReconciliationArtifactInventory(
          transactionalTask.artifactInventory,
          transactionalTask
        );
        if (transactionalInventory.status === 'complete') return transactionalTask;
        const spec = reconciliationCollectionInventory(transactionalTask).find(
          (candidate) => transactionalInventory.sources[candidate.id].status !== 'complete'
        );
        const source = transactionalInventory.sources[spec.id];
        let query = firestore.collection(spec.path);
        if (spec.filterInstance) {
          query = query.where('instanceId', '==', transactionalTask.instanceId);
        }
        query = query.orderBy(documentIdField).limit(pageSize);
        if (source.cursorPath) {
          query = query.startAfter(firestore.doc(source.cursorPath));
        }
        const pageSnapshot = await transaction.get(query);
        const documents = Array.isArray(pageSnapshot?.docs) ? pageSnapshot.docs : null;
        if (
          !documents
          || pageSnapshot?.empty !== (documents.length === 0)
          || documents.length > pageSize
        ) {
          throwDiamondPrivateNoteIntegrityFailure(
            'A durable Diamond retirement inventory page is incomplete.'
          );
        }
        documents.forEach((document) =>
          validateReconciliationInventoryDocument(spec, document, transactionalTask)
        );
        const nextSource = {
          status: documents.length < pageSize ? 'complete' : 'scanning',
          cursorPath: documents.length
            ? documents.at(-1).ref.path
            : source.cursorPath,
          documentsValidated: source.documentsValidated + documents.length
        };
        const nextSources = {
          ...transactionalInventory.sources,
          [spec.id]: nextSource
        };
        const everySourceComplete = reconciliationCollectionInventory(transactionalTask)
          .every((candidate) => nextSources[candidate.id].status === 'complete');
        if (everySourceComplete) {
          for (const path of reconciliationProtectedDocumentPaths(transactionalTask)) {
            const snapshot = await transaction.get(firestore.doc(path));
            if (
              snapshot?.exists
              && !isReconciliationOwnedDocument(snapshot.data() || {}, transactionalTask)
            ) {
              throwDiamondPrivateNoteIntegrityFailure(
                'A Diamond retirement document belongs to a different generation.'
              );
            }
          }
        }
        expectedSourceId = spec.id;
        expectedAfter = {
          ...transactionalInventory,
          status: everySourceComplete ? 'complete' : 'scanning',
          sources: nextSources
        };
        transaction.update(taskRef, { artifactInventory: expectedAfter });
        return { ...transactionalTask, artifactInventory: expectedAfter };
      });
      currentTask = requireReconciliationTask(committedTask, currentTask);
    } catch (error) {
      if (error?.code === 'diamond-private-note-integrity-failed' || !expectedAfter) throw error;
      try {
        const reconciledSnapshot = await taskRef.get();
        const reconciledTask = requireReconciliationTask(
          reconciledSnapshot?.data?.() || {},
          currentTask
        );
        if (reconciledTask.status === 'complete') return reconciledTask;
        const reconciledInventory = requireReconciliationArtifactInventory(
          reconciledTask.artifactInventory,
          reconciledTask
        );
        if (!inventoryProgressIncludes(
          reconciledInventory,
          expectedAfter,
          expectedSourceId
        )) throw error;
        currentTask = reconciledTask;
      } catch {
        throw error;
      }
    }
    pageBudget.remaining -= 1;
  }
  return currentTask;
}

async function deleteReconciliationCollectionArtifacts({
  firestore,
  documentIdField,
  uid,
  taskRef,
  task,
  pageBudget,
  pageSize,
  spec
}) {
  while (true) {
    const result = await firestore.runTransaction(async (transaction) => {
      const rootRef = firestore.doc(
        `teams/${task.teamId}/games/${task.gameId}/diamondScorebooks/v2`
      );
      let query = firestore.collection(spec.path);
      if (spec.filterInstance) query = query.where('instanceId', '==', task.instanceId);
      query = query.orderBy(documentIdField).limit(pageSize);
      const [barrierSnapshot, taskSnapshot, rootSnapshot, pageSnapshot] =
        await Promise.all([
          transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
          transaction.get(taskRef),
          transaction.get(rootRef),
          transaction.get(query)
        ]);
      requireAccountDiamondDeletionBarrier(
        barrierSnapshot,
        uid,
        ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
      );
      const currentTask = requireReconciliationTask(taskSnapshot?.data?.() || {}, task);
      if (currentTask.status === 'complete') return { terminal: true, deleted: 0 };
      const inventory = requireReconciliationArtifactInventory(
        currentTask.artifactInventory,
        currentTask
      );
      const root = rootSnapshot?.exists ? rootSnapshot.data() || {} : null;
      if (inventory.status !== 'complete' || !root || !sameReconciliationFence(root, currentTask)) {
        throwDiamondPrivateNoteIntegrityFailure(
          'Diamond artifact retirement lost its completed inventory fence.'
        );
      }
      const documents = Array.isArray(pageSnapshot?.docs) ? pageSnapshot.docs : null;
      if (
        !documents
        || pageSnapshot?.empty !== (documents.length === 0)
        || documents.length > pageSize
      ) {
        throwDiamondPrivateNoteIntegrityFailure(
          'Diamond artifact retirement returned an incomplete page.'
        );
      }
      if (documents.length > 0 && (!pageBudget || pageBudget.remaining <= 0)) {
        return { terminal: false, deleted: 0, budgetExhausted: true };
      }
      documents.forEach((document) => {
        validateReconciliationInventoryDocument(spec, document, currentTask);
        transaction.delete(document.ref);
      });
      return { terminal: false, deleted: documents.length, budgetExhausted: false };
    });
    if (result.budgetExhausted) {
      throw accountDiamondPrivateNoteError(
        'unavailable',
        'Diamond artifact retirement made bounded durable progress; retry is required.'
      );
    }
    if (result.deleted > 0) pageBudget.remaining -= 1;
    if (result.terminal || result.deleted < pageSize) return result.terminal;
  }
}

async function clearDiamondReconciliationArtifacts({
  firestore,
  documentIdField,
  uid,
  taskRef,
  task,
  pageBudget,
  pageSize
}) {
  const preflight = await firestore.runTransaction(async (transaction) => {
    const rootRef = firestore.doc(`teams/${task.teamId}/games/${task.gameId}/diamondScorebooks/v2`);
    const [barrierSnapshot, taskSnapshot, rootSnapshot, ...protectedSnapshots] = await Promise.all([
      transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
      transaction.get(taskRef),
      transaction.get(rootRef),
      ...reconciliationProtectedDocumentPaths(task)
        .map((path) => transaction.get(firestore.doc(path)))
    ]);
    requireAccountDiamondDeletionBarrier(
      barrierSnapshot,
      uid,
      ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
    );
    const currentTask = requireReconciliationTask(taskSnapshot?.data?.() || {}, task);
    if (currentTask.status === 'complete') return currentTask;
    const root = rootSnapshot?.exists ? rootSnapshot.data() || {} : null;
    const inventory = requireReconciliationArtifactInventory(
      currentTask.artifactInventory,
      currentTask
    );
    if (
      inventory.status !== 'complete'
      || !root
      || !sameReconciliationFence(root, currentTask)
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The Diamond Auth-deletion artifact inventory lost its root fence.'
      );
    }
    protectedSnapshots.forEach((snapshot) => {
      if (
        snapshot?.exists
        && !isReconciliationOwnedDocument(snapshot.data() || {}, currentTask)
      ) {
        throwDiamondPrivateNoteIntegrityFailure(
          'A Diamond retirement document changed after inventory completion.'
        );
      }
    });
    return currentTask;
  });
  if (preflight.status === 'complete') return preflight;
  for (const spec of reconciliationCollectionInventory(task)) {
    if (spec.retained) continue;
    const terminal = await deleteReconciliationCollectionArtifacts({
      firestore,
      documentIdField,
      uid,
      taskRef,
      task,
      pageBudget,
      pageSize,
      spec
    });
    if (terminal) {
      const terminalSnapshot = await taskRef.get();
      return requireReconciliationTask(terminalSnapshot?.data?.() || {}, task);
    }
  }
  const protectedResult = await firestore.runTransaction(async (transaction) => {
    const rootRef = firestore.doc(`teams/${task.teamId}/games/${task.gameId}/diamondScorebooks/v2`);
    const [barrierSnapshot, taskSnapshot, rootSnapshot, ...protectedSnapshots] = await Promise.all([
      transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
      transaction.get(taskRef),
      transaction.get(rootRef),
      ...reconciliationProtectedDocumentPaths(task)
        .map((path) => transaction.get(firestore.doc(path)))
    ]);
    requireAccountDiamondDeletionBarrier(
      barrierSnapshot,
      uid,
      ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
    );
    const currentTask = requireReconciliationTask(taskSnapshot?.data?.() || {}, task);
    if (currentTask.status === 'complete') return currentTask;
    const root = rootSnapshot?.exists ? rootSnapshot.data() || {} : null;
    if (
      requireReconciliationArtifactInventory(
        currentTask.artifactInventory,
        currentTask
      ).status !== 'complete'
      || !root
      || !sameReconciliationFence(root, currentTask)
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'Diamond parent-artifact retirement lost its completed inventory fence.'
      );
    }
    protectedSnapshots.forEach((snapshot) => {
      if (snapshot?.exists) {
        if (!isReconciliationOwnedDocument(snapshot.data() || {}, currentTask)) {
          throwDiamondPrivateNoteIntegrityFailure(
            'A Diamond retirement parent belongs to another generation.'
          );
        }
        transaction.delete(snapshot.ref);
      }
    });
    return currentTask;
  });
  if (protectedResult.status === 'complete') return protectedResult;
  let result = null;
  await firestore.runTransaction(async (transaction) => {
    const rootRef = firestore.doc(`teams/${task.teamId}/games/${task.gameId}/diamondScorebooks/v2`);
    const [barrierSnapshot, taskSnapshot, rootSnapshot] = await Promise.all([
      transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
      transaction.get(taskRef),
      transaction.get(rootRef)
    ]);
    requireAccountDiamondDeletionBarrier(
      barrierSnapshot,
      uid,
      ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
    );
    const currentTask = requireReconciliationTask(taskSnapshot?.data?.() || {}, task);
    if (currentTask.status === 'complete') {
      result = currentTask;
      return;
    }
    const root = rootSnapshot?.exists ? rootSnapshot.data() || {} : null;
    if (!root || !sameReconciliationFence(root, currentTask)) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The Diamond Auth-deletion artifact cleanup lost its root fence.'
      );
    }
    result = currentTask;
  });
  return result;
}

async function retireStaleDiamondActivation(dependencies, taskRef, initialTask) {
  let task = requireReconciliationTask(initialTask);
  if (task.status === 'complete') return task;
  task = await inventoryDiamondReconciliationArtifacts({
    firestore: dependencies.firestore,
    documentIdField: dependencies.documentIdField,
    uid: dependencies.uid,
    taskRef,
    task,
    pageBudget: dependencies.inventoryPageBudget,
    pageSize: dependencies.inventoryPageSize
  });
  task = await clearDiamondReconciliationArtifacts({
    firestore: dependencies.firestore,
    documentIdField: dependencies.documentIdField,
    uid: dependencies.uid,
    taskRef,
    task,
    pageBudget: dependencies.inventoryPageBudget,
    pageSize: dependencies.inventoryPageSize
  });
  if (task.status === 'complete') return task;
  const { firestore, uid, completedAt, deleteFieldValue } = dependencies;
  const gamePath = `teams/${task.teamId}/games/${task.gameId}`;
  const rootPath = `${gamePath}/diamondScorebooks/v2`;
  const lockPath = `teams/${task.teamId}/diamondCleanupLocks/${task.gameId}`;
  const absenceTargets = [
    ...reconciliationCollectionInventory(task)
      .filter((spec) => !spec.retained)
      .map((spec) => ({
        kind: spec.sibling ? 'owned-sibling' : 'collection',
        path: spec.path
      })),
    ...reconciliationProtectedDocumentPaths(task)
      .map((path) => ({ kind: 'document', path }))
  ];
  let terminal = null;
  await firestore.runTransaction(async (transaction) => {
    const artifactReads = absenceTargets.map((artifact) => (
      artifact.kind === 'document'
        ? transaction.get(firestore.doc(artifact.path))
        : artifact.kind === 'owned-sibling'
          ? transaction.get(
            firestore.collection(artifact.path)
              .where('instanceId', '==', task.instanceId)
              .limit(1)
          )
          : transaction.get(firestore.collection(artifact.path).limit(1))
    ));
    const sharedRollback = task.activationSharedGameRollback;
    const [
      barrierSnapshot,
      taskSnapshot,
      rootSnapshot,
      gameSnapshot,
      lockSnapshot,
      sharedSnapshot,
      ...artifactSnapshots
    ] = await Promise.all([
      transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
      transaction.get(taskRef),
      transaction.get(firestore.doc(rootPath)),
      transaction.get(firestore.doc(gamePath)),
      transaction.get(firestore.doc(lockPath)),
      sharedRollback
        ? transaction.get(firestore.doc(sharedRollback.path))
        : Promise.resolve(null),
      ...artifactReads
    ]);
    requireAccountDiamondDeletionBarrier(
      barrierSnapshot,
      uid,
      ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
    );
    const currentTask = requireReconciliationTask(taskSnapshot?.data?.() || {}, task);
    if (currentTask.status === 'complete') {
      terminal = currentTask;
      return;
    }
    const root = rootSnapshot?.exists ? rootSnapshot.data() || {} : null;
    const game = gameSnapshot?.exists ? gameSnapshot.data() || {} : null;
    const lock = lockSnapshot?.exists ? lockSnapshot.data() || {} : null;
    const gameRollback = requireRollbackBeforeImage(
      currentTask.activationGameRollback,
      'Diamond activation game',
      DIAMOND_ACTIVATION_GAME_ROLLBACK_FIELDS
    );
    if (
      !root
      || root.instanceId !== currentTask.instanceId
      || !sameReconciliationFence(root, currentTask)
      || lock?.generation !== currentTask.instanceId
      || lock?.status !== 'deleting'
      || lock?.complete !== false
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The fenced Diamond generation is not ready for retirement.'
      );
    }
    artifactSnapshots.forEach((snapshot, index) => {
      const artifact = absenceTargets[index];
      const empty = artifact.kind === 'document'
        ? snapshot?.exists !== true
        : Array.isArray(snapshot?.docs) && snapshot.docs.length === 0;
      if (!empty) {
        throwDiamondPrivateNoteIntegrityFailure(
          'The fenced Diamond generation still has authoritative descendants.'
        );
      }
    });
    const gameSentinelStillOwned = retiringGameFieldsMatch(game, currentTask);
    if (!gameSentinelStillOwned && oldGenerationGameFieldsMatch(game, currentTask)) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The fenced source rewrote its old game generation during retirement.'
      );
    }
    const sharedWithdrawal = requireSharedWithdrawalMode(
      currentTask.activationSharedWithdrawal,
      sharedRollback
    );
    const currentShared = sharedSnapshot?.exists ? sharedSnapshot.data() || {} : null;
    const sentinelStillOwned = retiringSharedFieldsMatch(currentShared, currentTask);
    if (!sentinelStillOwned && oldGenerationSharedFieldsMatch(currentShared, currentTask)) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The fenced source rewrote its old shared-game generation during retirement.'
      );
    }
    if (gameSentinelStillOwned) {
      transaction.update(gameSnapshot.ref, rollbackPatch(gameRollback, deleteFieldValue));
    }
    if (sharedWithdrawal === 'sentinel-restore' && sentinelStillOwned) {
      transaction.update(
        sharedSnapshot.ref,
        rollbackPatch(
          requireRollbackBeforeImage(
            sharedRollback,
            'Diamond activation shared-game',
            DIAMOND_SHARED_PROJECTION_FIELDS,
            true
          ),
          deleteFieldValue
        )
      );
    } else if (sharedWithdrawal === 'sentinel-delete' && sentinelStillOwned) {
      transaction.delete(sharedSnapshot.ref);
    }
    transaction.delete(rootSnapshot.ref);
    transaction.set(firestore.doc(lockPath), {
      schemaVersion: 1,
      generation: currentTask.instanceId,
      status: 'complete',
      complete: true,
      reason: 'auth-delete-reconciliation',
      updatedAt: completedAt,
      completedAt
    });
    terminal = {
      schemaVersion: 1,
      type: ACCOUNT_DIAMOND_RECONCILIATION_TYPE,
      status: 'complete',
      taskId: currentTask.taskId,
      outcome: 'generation-retired',
      receiptHash: diamondDomainEngine.hashDiamondValue({
        schemaVersion: 1,
        outcome: 'generation-retired',
        task: currentTask
      }),
      completedAt
    };
    transaction.set(taskRef, terminal);
  });
  return terminal;
}

async function processDiamondReconciliationTask(dependencies, taskRef, initialTask) {
  let task = requireReconciliationTask(initialTask);
  if (task.status === 'complete') return task;
  return retireStaleDiamondActivation(dependencies, taskRef, task);
}

function staleDiamondRegenerationCandidate({
  uid,
  authDeleteEventMs,
  snapshot
}) {
  const identity = scorebookIdentityFromPath(snapshot?.ref?.path, DIAMOND_AUDIT_PATH_PATTERN);
  if (!identity) return null;
  const value = snapshot.data() || {};
  if (![
    'projection-regeneration-reserved',
    'projection-regeneration-requested'
  ].includes(value.type)) return null;
  const commitMs = requireSnapshotCommitMillis(snapshot);
  if (commitMs < authDeleteEventMs) return null;
  const candidate = { snapshot, identity, commitMs, value };
  const controls = projectionRegenerationControlPaths(candidate);
  if (
    value.actorUid !== uid
    || value.teamId !== identity.teamId
    || value.gameId !== identity.gameId
    || !isValidAccountUid(value.instanceId)
    || !isValidAccountUid(value.requestId)
    || !DIAMOND_HASH_PATTERN.test(value.requestHash || '')
    || !isValidAccountUid(value.attemptId)
    || (value.type === 'projection-regeneration-reserved' && (
      !['reserved', 'follow-accepted', 'follow-blocked'].includes(value.branch)
      || !DIAMOND_HASH_PATTERN.test(value.coordinationHash || '')
      || !value.controlPaths
      || typeof value.controlPaths !== 'object'
      || Array.isArray(value.controlPaths)
      || Object.keys(value.controlPaths).sort().join('\0')
        !== ['claim', 'rate', 'receipt'].join('\0')
      || value.controlPaths.receipt !== controls.receipt
      || value.controlPaths.rate !== controls.rate
      || value.controlPaths.claim !== controls.claim
    ))
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'A stale Diamond regeneration audit is malformed.'
    );
  }
  return candidate;
}

function projectionRegenerationControlPaths(audit) {
  const scorebook = audit.identity.scorebookPath;
  const key = (kind, value) =>
    `${scorebook}/audit/projection-regeneration-${kind}-${diamondDomainEngine.hashDiamondValue(value).slice(7)}`;
  return {
    receipt: key('receipt', [audit.value.actorUid, audit.value.requestId]),
    rate: key('rate', audit.value.actorUid),
    claim: `${scorebook}/audit/projection-regeneration-claim`
  };
}

async function reconcileStaleDiamondRegenerationAudit({
  firestore,
  uid,
  barrier,
  authDeleteEventMs,
  candidate
}) {
  const { snapshot, value, identity } = candidate;
  const audit = { value, identity };
  const controls = projectionRegenerationControlPaths(audit);
  const references = {
    audit: firestore.doc(snapshot.ref.path),
    root: firestore.doc(identity.scorebookPath),
    receipt: firestore.doc(controls.receipt),
    rate: firestore.doc(controls.rate),
    claim: firestore.doc(controls.claim)
  };
  await firestore.runTransaction(async (transaction) => {
    const [barrierSnapshot, auditSnapshot, rootSnapshot, receiptSnapshot, rateSnapshot, claimSnapshot] =
      await Promise.all([
        transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
        transaction.get(references.audit),
        transaction.get(references.root),
        transaction.get(references.receipt),
        transaction.get(references.rate),
        transaction.get(references.claim)
      ]);
    requireAccountDiamondDeletionBarrier(
      barrierSnapshot,
      uid,
      ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
    );
    if (!auditSnapshot?.exists) return;
    const current = auditSnapshot.data() || {};
    if (
      requireSnapshotCommitMillis(auditSnapshot) < authDeleteEventMs
      || diamondDomainEngine.hashDiamondValue(current)
        !== diamondDomainEngine.hashDiamondValue(value)
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The stale Diamond regeneration audit changed during cleanup.'
      );
    }
    const root = rootSnapshot?.exists ? rootSnapshot.data() || {} : null;
    if (
      root?.projectionRequest?.requestedBy === uid
      && root.projectionRequest.requestId === value.requestId
      && root.projectionRequest.requestHash === value.requestHash
      && root.projectionRequest.attemptId === value.attemptId
    ) {
      transaction.update(references.root, {
        projectionRequest: null,
        projectionLease: null,
        projectionFailure: null,
        projectionStatus: 'pending',
        diamondProjectionMarker: null,
        updatedAt: barrier.startedAt
      });
    }
    const receipt = receiptSnapshot?.exists ? receiptSnapshot.data() || {} : null;
    if (
      receipt?.request?.actorUid === uid
      && receipt.request.requestId === value.requestId
      && receipt.request.requestHash === value.requestHash
      && receipt.attemptId === value.attemptId
    ) transaction.delete(references.receipt);
    const rate = rateSnapshot?.exists ? rateSnapshot.data() || {} : null;
    if (rate?.actorUid === uid) transaction.delete(references.rate);
    const claim = claimSnapshot?.exists ? claimSnapshot.data() || {} : null;
    if (claim?.ownerUid === uid && claim.attemptId === value.attemptId) {
      transaction.delete(references.claim);
    }
    transaction.delete(references.audit);
  });
}

function staleDiamondConfigurationCandidate({
  uid,
  authDeleteEventMs,
  snapshot
}) {
  const match = DIAMOND_CONFIGURATION_REQUEST_PATH_PATTERN.exec(snapshot?.ref?.path || '');
  if (!match) return null;
  const commitMs = requireSnapshotCommitMillis(snapshot);
  if (commitMs < authDeleteEventMs) return null;
  const value = snapshot.data() || {};
  if (
    value.requestedBy !== uid
    || !DIAMOND_HASH_PATTERN.test(value.requestHash || '')
    || !value.result
    || typeof value.result !== 'object'
    || !value.result.settings
    || typeof value.result.settings !== 'object'
    || value.result.settings.configuredBy !== uid
  ) {
    throwDiamondPrivateNoteIntegrityFailure(
      'A stale Diamond configuration request is malformed.'
    );
  }
  return {
    snapshot,
    teamId: match[1],
    requestId: match[2],
    commitMs,
    value,
    resultSettingsHash: diamondDomainEngine.hashDiamondValue(value.result.settings)
  };
}

async function reconcileStaleDiamondConfiguration({
  firestore,
  uid,
  barrier,
  authDeleteEventMs,
  deleteFieldValue,
  candidate
}) {
  const requestRef = firestore.doc(candidate.snapshot.ref.path);
  const teamRef = firestore.doc(`teams/${candidate.teamId}`);
  return firestore.runTransaction(async (transaction) => {
    const [barrierSnapshot, requestSnapshot, teamSnapshot] = await Promise.all([
      transaction.get(firestore.doc(directAuthDeletionBarrierPath(uid))),
      transaction.get(requestRef),
      transaction.get(teamRef)
    ]);
    requireAccountDiamondDeletionBarrier(
      barrierSnapshot,
      uid,
      ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
    );
    if (!requestSnapshot?.exists) return { reconciled: true, missing: true };
    const currentRequest = requestSnapshot.data() || {};
    if (
      requireSnapshotCommitMillis(requestSnapshot) < authDeleteEventMs
      || diamondDomainEngine.hashDiamondValue(currentRequest)
        !== diamondDomainEngine.hashDiamondValue(candidate.value)
    ) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The stale Diamond configuration request changed during cleanup.'
      );
    }
    const team = teamSnapshot?.exists ? teamSnapshot.data() || {} : null;
    if (
      team?.diamondScorebook?.configuredBy === uid
      && diamondDomainEngine.hashDiamondValue(team.diamondScorebook)
        === candidate.resultSettingsHash
    ) {
      transaction.update(teamRef, {
        diamondScorebook: deleteFieldValue()
      });
    }
    transaction.delete(requestRef);
    return { reconciled: true };
  });
}

function createAccountDiamondPrivateNoteAuthDeleteHandler({
  firestore,
  getDocumentIdField,
  deleteFieldValue,
  reconciliationInventoryPageBudget =
    ACCOUNT_DIAMOND_RECONCILIATION_INVENTORY_PAGE_BUDGET,
  reconciliationInventoryPageSize = ACCOUNT_DIAMOND_RECONCILIATION_PAGE_SIZE
}) {
  if (
    !firestore
    || typeof getDocumentIdField !== 'function'
    || typeof deleteFieldValue !== 'function'
    || !Number.isSafeInteger(reconciliationInventoryPageBudget)
    || reconciliationInventoryPageBudget < 1
    || !Number.isSafeInteger(reconciliationInventoryPageSize)
    || reconciliationInventoryPageSize < 1
    || reconciliationInventoryPageSize > ACCOUNT_DIAMOND_RECONCILIATION_PAGE_SIZE
  ) {
    throw new TypeError('Direct Auth-deletion cleanup dependencies are invalid.');
  }

  return async (user, context = {}) => {
    const documentIdField = getDocumentIdField();
    if (
      typeof firestore.collectionGroup !== 'function'
      || typeof firestore.collection !== 'function'
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
    const requestedAt = context?.timestamp;
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
    const authDeleteEventMs = Date.parse(barrier.startedAt);
    if (!Number.isSafeInteger(authDeleteEventMs)) {
      throwDiamondPrivateNoteIntegrityFailure(
        'The direct Auth-deletion boundary is malformed.'
      );
    }
    const inventoryPageBudget = {
      remaining: reconciliationInventoryPageBudget
    };

    const resumeTaskDocument = async (taskSnapshot) => {
      const task = requireReconciliationTask(taskSnapshot.data() || {});
      if (task.status !== 'complete') {
        await processDiamondReconciliationTask(
          {
            firestore,
            documentIdField,
            uid,
            inventoryPageBudget,
            inventoryPageSize: reconciliationInventoryPageSize,
            deleteFieldValue,
            completedAt: barrier.startedAt
          },
          taskSnapshot.ref,
          task
        );
      }
    };
    const resumeDurableTasks = () => runDurableReconciliationTaskScan({
      firestore,
      uid,
      barrier,
      documentIdField,
      pageBudget: inventoryPageBudget,
      processDocument: resumeTaskDocument
    });
    await resumeDurableTasks();

    // Each source advances a durable path cursor only after every matching
    // document in that page has reached terminal reconciliation. In
    // particular, note-derived tasks are durable before later redaction can
    // remove authorUid from a sidecar.
    const processMutationDocument = (kind) => async (snapshot) => {
      const candidate = await staleDiamondMutationCandidate({
        firestore,
        uid,
        authDeleteEventMs,
        snapshot,
        kind
      });
      if (!candidate) return;
      const staged = await stageDiamondReconciliationTask({
        firestore,
        uid,
        barrier,
        authDeleteEventMs,
        candidate,
        deleteFieldValue
      });
      await processDiamondReconciliationTask(
        {
          firestore,
          documentIdField,
          uid,
          inventoryPageBudget,
          inventoryPageSize: reconciliationInventoryPageSize,
          deleteFieldValue,
          completedAt: barrier.startedAt
        },
        staged.ref,
        staged.task
      );
    };
    for (const source of [
      { source: 'events-actor', collectionGroup: 'events', field: 'actorUid', kind: 'event' },
      { source: 'events-handoff', collectionGroup: 'events', field: 'payload.toUid', kind: 'handoff' },
      { source: 'notes-author', collectionGroup: 'notes', field: 'authorUid', kind: 'note' }
    ]) {
      await runDurableEqualityScan({
        firestore,
        uid,
        barrier,
        documentIdField,
        source: source.source,
        collectionGroup: source.collectionGroup,
        field: source.field,
        pageBudget: inventoryPageBudget,
        processDocument: processMutationDocument(source.kind)
      });
    }

    await runDurableEqualityScan({
      firestore,
      uid,
      documentIdField,
      barrier,
      source: 'regeneration-audit',
      collectionGroup: 'audit',
      field: 'actorUid',
      pageBudget: inventoryPageBudget,
      processDocument: async (snapshot) => {
        const candidate = staleDiamondRegenerationCandidate({
          uid,
          authDeleteEventMs,
          snapshot
        });
        if (!candidate) return;
        await reconcileStaleDiamondRegenerationAudit({
          firestore,
          uid,
          barrier,
          authDeleteEventMs,
          candidate
        });
      }
    });

    await runDurableEqualityScan({
      firestore,
      uid,
      documentIdField,
      barrier,
      source: 'configuration-request',
      collectionGroup: 'diamondConfigurationRequests',
      field: 'requestedBy',
      pageBudget: inventoryPageBudget,
      processDocument: async (snapshot) => {
        const candidate = staleDiamondConfigurationCandidate({
          uid,
          authDeleteEventMs,
          snapshot
        });
        if (!candidate) return;
        await reconcileStaleDiamondConfiguration({
          firestore,
          uid,
          barrier,
          authDeleteEventMs,
          deleteFieldValue,
          candidate
        });
      }
    });
    // A concurrent duplicate can stage a task, reset the task cursor, and
    // remove its source document after this invocation's initial task scan.
    // Re-read the durable task scan after every source has reached its own
    // cursor so no successful invocation can acknowledge an orphaned fence.
    await resumeDurableTasks();
    await cleanupAccountDiamondPrivateNotes({
      firestore,
      uid,
      documentIdField,
      redactedAt: barrier.startedAt,
      barrierKind: ACCOUNT_DIAMOND_DELETION_BARRIER_AUTH_DELETE
    });
    // Keep the hash-addressed barrier permanently. A submit transaction that
    // read its absence before Auth deletion either commits before this barrier
    // (and is found by the cleanup scan) or conflicts and retries against the
    // barrier. Retaining it closes the later gap for requests that authenticated
    // before deletion without preserving the raw UID.
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
