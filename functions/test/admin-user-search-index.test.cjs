const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAdminUserSearchHashes,
  hashAdminUserSearchIndexValue,
  haveAdminUserSearchFieldsChanged
} = require('../admin-user-search-index-core.cjs');

test('admin user search index covers surname, email-domain, phone, and case-insensitive substrings', () => {
  const hashes = new Set(buildAdminUserSearchHashes({
    fullName: 'Jane McSMITH',
    email: 'jane@Example-Domain.com',
    phone: '+1 (555) 123-4567'
  }));

  ['smith', 'exampledomain', '1234567', 'JANEMC'].forEach((term) => {
    assert.equal(hashes.has(hashAdminUserSearchIndexValue(term)), true, term);
  });
});

test('admin user search index only rewrites when searchable fields change', () => {
  const before = { email: 'jane@example.com', fullName: 'Jane Smith', phone: '5551234567' };

  assert.equal(haveAdminUserSearchFieldsChanged(before, { ...before, parentTeamIds: ['team-1'] }), false);
  assert.equal(haveAdminUserSearchFieldsChanged(before, { ...before, fullName: 'Jane Jones' }), true);
  assert.equal(haveAdminUserSearchFieldsChanged(before, null), true);
});
