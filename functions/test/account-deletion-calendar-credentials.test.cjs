'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  cleanupAccountCalendarCredentials,
  getCanonicalCalendarCredentialPrincipal,
  getAccountDeletionCollectionGroupQueries
} = require('../account-deletion-core.cjs');

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed = {}, options = {}) {
  const state = new Map(Object.entries(seed).map(([documentPath, value]) => [documentPath, clone(value)]));
  const transactions = [];
  const queryPages = [];
  let transactionSequence = 0;
  let transactionQueue = Promise.resolve();
  let failSecretTransactions = options.failSecretTransactions || 0;
  const rereadMutations = new Map(Object.entries(options.rereadMutations || {}));

  function doc(documentPath) {
    return { id: documentPath.split('/').pop(), path: documentPath };
  }

  function snapshot(ref) {
    const value = state.get(ref.path);
    return {
      id: ref.id,
      ref,
      exists: value !== undefined,
      data: () => clone(value)
    };
  }

  class Query {
    constructor(collectionName, field, value, limitValue = Infinity, cursorPath = '') {
      this.collectionName = collectionName;
      this.field = field;
      this.value = value;
      this.limitValue = limitValue;
      this.cursorPath = cursorPath;
    }

    orderBy() {
      return new Query(this.collectionName, this.field, this.value, this.limitValue, this.cursorPath);
    }

    limit(limitValue) {
      return new Query(this.collectionName, this.field, this.value, limitValue, this.cursorPath);
    }

    startAfter(cursor) {
      return new Query(this.collectionName, this.field, this.value, this.limitValue, cursor.ref.path);
    }

    async get() {
      const documents = [...state.entries()]
        .filter(([documentPath]) => {
          const parts = documentPath.split('/');
          return parts[parts.length - 2] === this.collectionName;
        })
        .filter(([, value]) => value?.[this.field] === this.value)
        .filter(([documentPath]) => !this.cursorPath || documentPath > this.cursorPath)
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .slice(0, this.limitValue)
        .map(([documentPath]) => snapshot(doc(documentPath)));
      queryPages.push({
        collectionName: this.collectionName,
        count: documents.length,
        field: this.field
      });
      return { docs: documents, empty: documents.length === 0 };
    }
  }

  function runTransaction(operation) {
    const run = transactionQueue.then(async () => {
      const transactionId = ++transactionSequence;
      const pendingDeletes = [];
      const transaction = {
        async get(ref) {
          if (rereadMutations.has(ref.path)) {
            const nextValue = rereadMutations.get(ref.path);
            rereadMutations.delete(ref.path);
            if (nextValue === undefined) state.delete(ref.path);
            else state.set(ref.path, clone(nextValue));
          }
          return snapshot(ref);
        },
        delete(ref) {
          pendingDeletes.push(ref.path);
        }
      };
      const result = await operation(transaction);
      if (
        failSecretTransactions > 0
        && pendingDeletes.some((documentPath) => documentPath.includes('/privateCalendarSubscriptions/'))
      ) {
        failSecretTransactions -= 1;
        throw new Error('simulated secret transaction failure');
      }
      pendingDeletes.forEach((documentPath) => state.delete(documentPath));
      transactions.push({ id: transactionId, deletedPaths: [...pendingDeletes] });
      return result;
    });
    transactionQueue = run.catch(() => undefined);
    return run;
  }

  return {
    collectionGroup(collectionName) {
      return {
        where(field, operator, value) {
          assert.equal(operator, '==');
          return new Query(collectionName, field, value);
        }
      };
    },
    doc,
    get: (documentPath) => clone(state.get(documentPath)),
    has: (documentPath) => state.has(documentPath),
    paths: () => [...state.keys()],
    queryPages,
    runTransaction,
    transactions
  };
}

const documentIdField = { kind: 'document-id' };

test('calendar credential identity uses uid, then userId, then createdBy, and fails closed on invalid higher authority', () => {
  assert.deepEqual(getCanonicalCalendarCredentialPrincipal({
    uid: 'canonical-user',
    userId: 'legacy-user',
    createdBy: 'creator-user'
  }), { field: 'uid', valid: true, value: 'canonical-user' });
  assert.deepEqual(getCanonicalCalendarCredentialPrincipal({
    userId: 'legacy-user',
    createdBy: 'creator-user'
  }), { field: 'userId', valid: true, value: 'legacy-user' });
  assert.deepEqual(getCanonicalCalendarCredentialPrincipal({ createdBy: 'creator-user' }), {
    field: 'createdBy',
    valid: true,
    value: 'creator-user'
  });
  assert.deepEqual(getCanonicalCalendarCredentialPrincipal({
    uid: 7,
    userId: 'target-user',
    createdBy: 'target-user'
  }), { field: 'uid', valid: false, value: '' });
});

test('deduplicates legacy lookup queries, preserves conflicting canonical principals, and deletes pairs atomically', async () => {
  const targetUid = 'target-user';
  const tokenHash = 'a'.repeat(64);
  const pairLookupPath = `teams/team-1/calendarTokens/${tokenHash}`;
  const pairSecretPath = `teams/team-1/privateCalendarSubscriptions/${targetUid}`;
  const firestore = makeFirestore({
    [pairSecretPath]: {
      schemaVersion: 1,
      teamId: 'team-1',
      uid: targetUid,
      tokenHash,
      rawToken: 'private-token'
    },
    [pairLookupPath]: { teamId: 'team-1', tokenHash, uid: targetUid },
    'teams/team-2/calendarTokens/legacy-all-aliases': {
      uid: targetUid,
      userId: targetUid,
      createdBy: targetUid
    },
    'teams/team-3/calendarTokens/legacy-created-by': { createdBy: targetUid },
    'teams/team-3b/calendarTokens/legacy-user-id': { userId: targetUid },
    'teams/team-4/calendarTokens/protected-canonical-uid': {
      uid: 'other-user',
      createdBy: targetUid
    },
    'teams/team-5/calendarTokens/protected-canonical-user-id': {
      userId: 'other-user',
      createdBy: targetUid
    },
    'teams/team-6/calendarTokens/protected-invalid-uid': {
      uid: 7,
      createdBy: targetUid
    },
    'teams/team-7/privateCalendarSubscriptions/other-user': {
      uid: 'other-user',
      rawToken: 'other-private-token'
    },
    'teams/team-8/privateCalendarSubscriptions/legacy-secret': {
      createdBy: targetUid,
      rawToken: 'legacy-private-token'
    }
  });

  const result = await cleanupAccountCalendarCredentials({
    firestore,
    uid: targetUid,
    documentIdField
  });

  assert.deepEqual(result, {
    lookupCandidates: 7,
    lookupsDeleted: 4,
    pagesRead: 5,
    secretCandidates: 2,
    secretsDeleted: 2
  });
  assert.equal(firestore.has(pairLookupPath), false);
  assert.equal(firestore.has(pairSecretPath), false);
  assert.equal(firestore.has('teams/team-2/calendarTokens/legacy-all-aliases'), false);
  assert.equal(firestore.has('teams/team-3/calendarTokens/legacy-created-by'), false);
  assert.equal(firestore.has('teams/team-3b/calendarTokens/legacy-user-id'), false);
  assert.equal(firestore.has('teams/team-4/calendarTokens/protected-canonical-uid'), true);
  assert.equal(firestore.has('teams/team-5/calendarTokens/protected-canonical-user-id'), true);
  assert.equal(firestore.has('teams/team-6/calendarTokens/protected-invalid-uid'), true);
  assert.equal(firestore.has('teams/team-7/privateCalendarSubscriptions/other-user'), true);
  assert.equal(firestore.has('teams/team-8/privateCalendarSubscriptions/legacy-secret'), false);

  const pairTransaction = firestore.transactions.find(({ deletedPaths }) => (
    deletedPaths.includes(pairLookupPath) || deletedPaths.includes(pairSecretPath)
  ));
  assert.ok(pairTransaction.deletedPaths.includes(pairLookupPath));
  assert.ok(pairTransaction.deletedPaths.includes(pairSecretPath));
  assert.ok(
    pairTransaction.deletedPaths.indexOf(pairLookupPath)
      < pairTransaction.deletedPaths.indexOf(pairSecretPath)
  );
});

test('paginates beyond 250 candidates and deletes documents returned by duplicate alias queries only once', async () => {
  const targetUid = 'target-user';
  const seed = {};
  for (let index = 0; index < 520; index += 1) {
    const suffix = String(index).padStart(4, '0');
    seed[`teams/team-${suffix}/calendarTokens/token-${suffix}`] = {
      uid: targetUid,
      userId: targetUid
    };
  }
  const firestore = makeFirestore(seed);

  const result = await cleanupAccountCalendarCredentials({
    firestore,
    uid: targetUid,
    documentIdField,
    pageSize: 250,
    transactionSize: 100
  });

  assert.equal(result.lookupCandidates, 520);
  assert.equal(result.lookupsDeleted, 520);
  assert.equal(result.pagesRead, 6);
  assert.equal(firestore.paths().length, 0);
  const deletedPaths = firestore.transactions.flatMap((transaction) => transaction.deletedPaths);
  assert.equal(deletedPaths.length, 520);
  assert.equal(new Set(deletedPaths).size, 520);
  assert.deepEqual(
    firestore.queryPages.filter(({ collectionName, count }) => (
      collectionName === 'calendarTokens' && count > 0
    )).map(({ count }) => count),
    [250, 250, 20, 250, 250, 20]
  );
});

test('re-reads query candidates and never deletes a createdBy match rebound to another canonical uid', async () => {
  const lookupPath = 'teams/team-1/calendarTokens/legacy-token';
  const firestore = makeFirestore({
    [lookupPath]: { createdBy: 'target-user' }
  }, {
    rereadMutations: {
      [lookupPath]: { uid: 'other-user', createdBy: 'target-user' }
    }
  });

  const result = await cleanupAccountCalendarCredentials({
    firestore,
    uid: 'target-user',
    documentIdField
  });

  assert.equal(result.lookupCandidates, 1);
  assert.equal(result.lookupsDeleted, 0);
  assert.deepEqual(firestore.get(lookupPath), {
    uid: 'other-user',
    createdBy: 'target-user'
  });
});

test('is idempotent after partial failure and retires legacy lookups before deleting raw secrets', async () => {
  const lookupPath = 'teams/team-1/calendarTokens/legacy-token';
  const secretPath = 'teams/team-1/privateCalendarSubscriptions/target-user';
  const firestore = makeFirestore({
    [lookupPath]: { uid: 'target-user' },
    [secretPath]: {
      schemaVersion: 0,
      uid: 'target-user',
      rawToken: 'legacy-private-token'
    }
  }, { failSecretTransactions: 1 });

  await assert.rejects(
    cleanupAccountCalendarCredentials({
      firestore,
      uid: 'target-user',
      documentIdField
    }),
    /simulated secret transaction failure/
  );
  assert.equal(firestore.has(lookupPath), false);
  assert.equal(firestore.has(secretPath), true);

  const retry = await cleanupAccountCalendarCredentials({
    firestore,
    uid: 'target-user',
    documentIdField
  });
  assert.equal(retry.lookupsDeleted, 0);
  assert.equal(retry.secretsDeleted, 1);
  assert.equal(firestore.has(secretPath), false);

  const repeated = await cleanupAccountCalendarCredentials({
    firestore,
    uid: 'target-user',
    documentIdField
  });
  assert.equal(repeated.lookupsDeleted, 0);
  assert.equal(repeated.secretsDeleted, 0);
});

test('fails closed without deleting either side of a new pair bound to conflicting principals', async () => {
  const tokenHash = 'b'.repeat(64);
  const lookupPath = `teams/team-1/calendarTokens/${tokenHash}`;
  const secretPath = 'teams/team-1/privateCalendarSubscriptions/target-user';
  const firestore = makeFirestore({
    [secretPath]: {
      schemaVersion: 1,
      teamId: 'team-1',
      uid: 'target-user',
      tokenHash,
      rawToken: 'private-token'
    },
    [lookupPath]: {
      teamId: 'team-1',
      tokenHash,
      uid: 'other-user',
      createdBy: 'target-user'
    }
  });

  await assert.rejects(
    cleanupAccountCalendarCredentials({
      firestore,
      uid: 'target-user',
      documentIdField
    }),
    (error) => error?.code === 'calendar-credential-binding-conflict'
  );
  assert.equal(firestore.has(lookupPath), true);
  assert.equal(firestore.has(secretPath), true);
});

test('wires dedicated cleanup before account and audit completion', () => {
  const source = readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const cleanupIndex = source.indexOf('await cleanupAccountCalendarCredentials({');
  const authDeleteIndex = source.indexOf('await admin.auth().deleteUser(uid)', cleanupIndex);
  const auditIndex = source.indexOf('accountDeletionAudit/', cleanupIndex);
  assert.ok(cleanupIndex > 0);
  assert.ok(authDeleteIndex > cleanupIndex);
  assert.ok(auditIndex > authDeleteIndex);

  const genericQueries = getAccountDeletionCollectionGroupQueries();
  assert.equal(genericQueries.some(([collection]) => (
    collection === 'calendarTokens' || collection === 'privateCalendarSubscriptions'
  )), false);

  const indexConfig = JSON.parse(readFileSync(
    path.join(__dirname, '..', '..', 'firestore.indexes.json'),
    'utf8'
  ));
  for (const collectionGroup of ['privateCalendarSubscriptions', 'calendarTokens']) {
    for (const fieldPath of ['uid', 'userId', 'createdBy']) {
      assert.ok(indexConfig.fieldOverrides.some((override) => (
        override.collectionGroup === collectionGroup
        && override.fieldPath === fieldPath
        && override.indexes?.some((index) => index.queryScope === 'COLLECTION_GROUP')
      )), `${collectionGroup}.${fieldPath} needs a collection-group index`);
    }
  }
});
