'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { findOwnedInviteCode } = require('../auth-email-invite-store.cjs');

function snapshot(id, data, exists = true) {
  return { id, exists, data: () => data };
}

function createFirestore({ direct, queried = [] }) {
  return {
    doc() {
      return { get: async () => direct };
    },
    collection() {
      return {
        where(field, op, value) {
          assert.deepEqual([field, op, value], ['code', '==', 'ABCD1234']);
          return {
            limit(count) {
              assert.equal(count, 10);
              return { get: async () => ({ docs: queried }) };
            }
          };
        }
      };
    }
  };
}

const allowedTypes = new Set(['parent_invite', 'admin_invite']);

test('returns a direct invite only when its type and generatedBy owner match', async () => {
  const owned = snapshot('ABCD1234', {
    type: 'admin_invite',
    generatedBy: 'owner-1',
    email: 'coach@example.com'
  });
  assert.deepEqual(await findOwnedInviteCode({
    firestore: createFirestore({ direct: owned }),
    code: 'ABCD1234',
    uid: 'owner-1',
    allowedTypes
  }), { id: 'ABCD1234', data: owned.data() });

  assert.equal(await findOwnedInviteCode({
    firestore: createFirestore({ direct: owned, queried: [] }),
    code: 'ABCD1234',
    uid: 'different-owner',
    allowedTypes
  }), null);
});

test('filters query fallback candidates by allowed type and exact owner', async () => {
  const wrongType = snapshot('wrong-type', { type: 'standard', generatedBy: 'owner-1' });
  const wrongOwner = snapshot('wrong-owner', { type: 'admin_invite', generatedBy: 'owner-2' });
  const owned = snapshot('owned', { type: 'parent_invite', generatedBy: 'owner-1', email: 'parent@example.com' });
  const result = await findOwnedInviteCode({
    firestore: createFirestore({ direct: snapshot('none', {}, false), queried: [wrongType, wrongOwner, owned] }),
    code: 'ABCD1234',
    uid: ' owner-1 ',
    allowedTypes
  });
  assert.deepEqual(result, { id: 'owned', data: owned.data() });
});
