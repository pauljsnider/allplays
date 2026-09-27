'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const {
  ACCOUNT_REPLAY_ARCHIVE_ATTRIBUTION_FIELDS,
  ACCOUNT_REPLAY_ARCHIVE_PAGE_SIZE,
  ACCOUNT_REPLAY_ARCHIVE_TRANSACTION_SIZE,
  anonymizeAccountReplayArchiveAttribution,
  buildReplayArchiveAttributionScrubPlan
} = require('../account-deletion-core.cjs');

const DELETE_FIELD = Symbol('delete-field');

function createReplayArchiveFirestore(initialState, { failTransactionCalls = [] } = {}) {
  const state = new Map(Object.entries(initialState).map(([path, value]) => [path, { ...value }]));
  const failedCalls = new Set(failTransactionCalls);
  const queryLog = [];
  let transactionCalls = 0;

  const makeSnapshot = (path) => {
    const ref = { path, id: path.split('/').at(-1) };
    return {
      id: ref.id,
      ref,
      exists: state.has(path),
      data: () => ({ ...(state.get(path) || {}) })
    };
  };

  const makeQuery = ({ field = '', uid = '', cursorPath = '', pageSize = null } = {}) => ({
    where(nextField, operator, nextUid) {
      assert.equal(operator, '==');
      return makeQuery({ field: nextField, uid: nextUid, cursorPath, pageSize });
    },
    orderBy(documentIdField) {
      assert.equal(documentIdField, 'document-id');
      return makeQuery({ field, uid, cursorPath, pageSize });
    },
    limit(nextPageSize) {
      return makeQuery({ field, uid, cursorPath, pageSize: nextPageSize });
    },
    startAfter(document) {
      return makeQuery({ field, uid, cursorPath: document.ref.path, pageSize });
    },
    async get() {
      const paths = [...state.entries()]
        .filter(([path, value]) => path.split('/').at(-2) === 'privateReplay' && value[field] === uid)
        .map(([path]) => path)
        .filter((path) => !cursorPath || path.localeCompare(cursorPath) > 0)
        .sort((left, right) => left.localeCompare(right))
        .slice(0, pageSize);
      queryLog.push({ field, uid, cursorPath, pageSize, paths });
      return { docs: paths.map(makeSnapshot), empty: paths.length === 0 };
    }
  });

  const firestore = {
    collectionGroup(collectionId) {
      assert.equal(collectionId, 'privateReplay');
      return makeQuery();
    },
    async runTransaction(callback) {
      transactionCalls += 1;
      const updates = [];
      const transaction = {
        get: async (ref) => makeSnapshot(ref.path),
        update: (ref, update) => updates.push({ ref, update })
      };
      const result = await callback(transaction);
      if (failedCalls.delete(transactionCalls)) {
        const error = new Error('transient transaction failure');
        error.code = 'unavailable';
        throw error;
      }
      updates.forEach(({ ref, update }) => {
        const current = { ...(state.get(ref.path) || {}) };
        Object.entries(update).forEach(([field, value]) => {
          if (value === DELETE_FIELD) delete current[field];
          else current[field] = value;
        });
        state.set(ref.path, current);
      });
      return result;
    }
  };

  return {
    firestore,
    queryLog,
    read: (path) => state.get(path),
    get transactionCalls() {
      return transactionCalls;
    }
  };
}

function runAnonymization(fake, options = {}) {
  return anonymizeAccountReplayArchiveAttribution({
    firestore: fake.firestore,
    uid: 'deleted.user:1',
    documentIdField: 'document-id',
    deleteFieldValue: () => DELETE_FIELD,
    pageSize: 2,
    transactionSize: 1,
    ...options
  });
}

test('exposes a finite bounded replay attribution scrub contract', () => {
  assert.deepEqual(ACCOUNT_REPLAY_ARCHIVE_ATTRIBUTION_FIELDS, ['linkedBy', 'updatedBy']);
  assert.equal(Object.isFrozen(ACCOUNT_REPLAY_ARCHIVE_ATTRIBUTION_FIELDS), true);
  assert.equal(ACCOUNT_REPLAY_ARCHIVE_PAGE_SIZE, 250);
  assert.equal(ACCOUNT_REPLAY_ARCHIVE_TRANSACTION_SIZE, 100);

  assert.deepEqual(buildReplayArchiveAttributionScrubPlan({
    linkedBy: 'deleted.user:1',
    updatedBy: 'deleted.user:1'
  }, 'deleted.user:1'), {
    changed: true,
    fieldsToDelete: ['linkedBy', 'updatedBy']
  });
  assert.deepEqual(buildReplayArchiveAttributionScrubPlan({
    linkedBy: 'remaining-user',
    updatedBy: 'deleted.user:1'
  }, 'deleted.user:1'), {
    changed: true,
    fieldsToDelete: ['updatedBy']
  });
  assert.deepEqual(buildReplayArchiveAttributionScrubPlan({
    linkedBy: 123,
    updatedBy: 'remaining-user'
  }, '123'), {
    changed: false,
    fieldsToDelete: []
  });
  assert.deepEqual(buildReplayArchiveAttributionScrubPlan({ linkedBy: '' }, ''), {
    changed: false,
    fieldsToDelete: []
  });
});

test('anonymizes only matching replay attribution while preserving archives and unrelated UIDs', async () => {
  const paths = {
    both: 'teams/team-1/games/game-1/privateReplay/archive',
    linked: 'teams/team-1/games/game-2/privateReplay/archive',
    updated: 'teams/team-1/games/game-3/privateReplay/archive',
    unrelated: 'teams/team-1/games/game-4/privateReplay/archive',
    shared: 'organizations/org-1/sharedGames/game-5/privateReplay/archive',
    otherPrivateReplayDocument: 'teams/team-1/games/game-6/privateReplay/metadata',
    nonGameArchive: 'teams/team-1/practices/practice-1/privateReplay/archive'
  };
  const fake = createReplayArchiveFirestore({
    [paths.both]: {
      schemaVersion: 1,
      state: 'ready',
      videoId: 'abcdefghijk',
      linkedBy: 'deleted.user:1',
      updatedBy: 'deleted.user:1'
    },
    [paths.linked]: {
      schemaVersion: 1,
      state: 'removed',
      linkedBy: 'deleted.user:1',
      updatedBy: 'remaining-user'
    },
    [paths.updated]: {
      schemaVersion: 1,
      state: 'ready',
      linkedBy: 'remaining-user',
      updatedBy: 'deleted.user:1'
    },
    [paths.unrelated]: {
      schemaVersion: 1,
      state: 'ready',
      linkedBy: 'remaining-user',
      updatedBy: 'remaining-user'
    },
    [paths.shared]: {
      schemaVersion: 1,
      state: 'ready',
      linkedBy: 'remaining-user',
      updatedBy: 'deleted.user:1'
    },
    [paths.otherPrivateReplayDocument]: {
      linkedBy: 'deleted.user:1',
      updatedBy: 'deleted.user:1'
    },
    [paths.nonGameArchive]: {
      linkedBy: 'deleted.user:1',
      updatedBy: 'deleted.user:1'
    }
  });

  const result = await runAnonymization(fake);

  assert.equal(result.archivesUpdated, 4);
  assert.equal(result.attributionFieldsDeleted, 5);
  assert.ok(result.pagesRead >= 2);
  assert.ok(result.candidatesRead >= 4);
  assert.deepEqual(fake.read(paths.both), {
    schemaVersion: 1,
    state: 'ready',
    videoId: 'abcdefghijk'
  });
  assert.deepEqual(fake.read(paths.linked), {
    schemaVersion: 1,
    state: 'removed',
    updatedBy: 'remaining-user'
  });
  assert.deepEqual(fake.read(paths.updated), {
    schemaVersion: 1,
    state: 'ready',
    linkedBy: 'remaining-user'
  });
  assert.deepEqual(fake.read(paths.shared), {
    schemaVersion: 1,
    state: 'ready',
    linkedBy: 'remaining-user'
  });
  assert.deepEqual(fake.read(paths.unrelated), {
    schemaVersion: 1,
    state: 'ready',
    linkedBy: 'remaining-user',
    updatedBy: 'remaining-user'
  });
  assert.deepEqual(fake.read(paths.otherPrivateReplayDocument), {
    linkedBy: 'deleted.user:1',
    updatedBy: 'deleted.user:1'
  });
  assert.deepEqual(fake.read(paths.nonGameArchive), {
    linkedBy: 'deleted.user:1',
    updatedBy: 'deleted.user:1'
  });

  const retry = await runAnonymization(fake);
  assert.equal(retry.archivesUpdated, 0);
  assert.equal(retry.attributionFieldsDeleted, 0);
  assert.ok(fake.read(paths.both));
});

test('propagates partial failure and safely resumes without reprocessing committed attribution', async () => {
  const firstPath = 'teams/team-1/games/game-a/privateReplay/archive';
  const secondPath = 'teams/team-1/games/game-b/privateReplay/archive';
  const fake = createReplayArchiveFirestore({
    [firstPath]: { state: 'ready', linkedBy: 'deleted.user:1', videoId: 'abcdefghijk' },
    [secondPath]: { state: 'ready', linkedBy: 'deleted.user:1', videoId: 'lmnopqrstuv' }
  }, { failTransactionCalls: [2] });

  await assert.rejects(
    runAnonymization(fake, { pageSize: 1, transactionSize: 1 }),
    (error) => error?.code === 'unavailable'
  );
  assert.deepEqual(fake.read(firstPath), { state: 'ready', videoId: 'abcdefghijk' });
  assert.deepEqual(fake.read(secondPath), {
    state: 'ready',
    linkedBy: 'deleted.user:1',
    videoId: 'lmnopqrstuv'
  });

  const retry = await runAnonymization(fake, { pageSize: 1, transactionSize: 1 });
  assert.equal(retry.archivesUpdated, 1);
  assert.equal(retry.attributionFieldsDeleted, 1);
  assert.deepEqual(fake.read(firstPath), { state: 'ready', videoId: 'abcdefghijk' });
  assert.deepEqual(fake.read(secondPath), { state: 'ready', videoId: 'lmnopqrstuv' });
});

test('fails closed for invalid replay anonymization budgets and account identifiers', async () => {
  const fake = createReplayArchiveFirestore({});
  await assert.rejects(
    runAnonymization(fake, { uid: 'bad/uid' }),
    /dependencies are invalid/
  );
  await assert.rejects(
    runAnonymization(fake, { pageSize: 251 }),
    /dependencies are invalid/
  );
  await assert.rejects(
    runAnonymization(fake, { transactionSize: 201 }),
    /dependencies are invalid/
  );
});

test('runs replay attribution anonymization before deleting the user or Auth account', () => {
  const functionsSource = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
  const workerSource = functionsSource.slice(functionsSource.indexOf('exports.processAccountDeletionRequest'));
  const calendarCleanup = workerSource.indexOf('await cleanupAccountCalendarCredentials({');
  const replayAnonymization = workerSource.indexOf('await anonymizeAccountReplayArchiveAttribution({');
  const directDeletion = workerSource.indexOf('const directDocuments = [');
  const authDeletion = workerSource.indexOf('await admin.auth().deleteUser(uid)');

  assert.ok(calendarCleanup >= 0);
  assert.ok(calendarCleanup < replayAnonymization);
  assert.ok(replayAnonymization < directDeletion);
  assert.ok(replayAnonymization < authDeletion);
  assert.match(workerSource, /documentIdField: admin\.firestore\.FieldPath\.documentId\(\)/);
  assert.match(workerSource, /deleteFieldValue: \(\) => admin\.firestore\.FieldValue\.delete\(\)/);
});

test('provisions every replay attribution collection-group query used by account deletion', () => {
  const indexConfig = JSON.parse(readFileSync(
    join(__dirname, '..', '..', 'firestore.indexes.json'),
    'utf8'
  ));

  for (const fieldPath of ACCOUNT_REPLAY_ARCHIVE_ATTRIBUTION_FIELDS) {
    assert.ok(indexConfig.fieldOverrides.some((override) => (
      override.collectionGroup === 'privateReplay'
      && override.fieldPath === fieldPath
      && override.indexes?.some((index) => (
        index.order === 'ASCENDING'
        && index.queryScope === 'COLLECTION_GROUP'
      ))
    )), `missing privateReplay collection-group index for ${fieldPath}`);
  }
});
