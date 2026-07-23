'use strict';

const ADMIN_USER_SEARCH_INDEX_MIN_LENGTH = 2;
const ADMIN_USER_SEARCH_INDEX_MAX_SOURCE_LENGTH = 100;

function normalizeAdminUserSearchIndexValue(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, ADMIN_USER_SEARCH_INDEX_MAX_SOURCE_LENGTH)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function hashAdminUserSearchIndexValue(value = '') {
  const normalized = normalizeAdminUserSearchIndexValue(value);
  if (normalized.length < ADMIN_USER_SEARCH_INDEX_MIN_LENGTH) return '';

  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildAdminUserSearchHashes(user = {}) {
  const hashes = new Set();
  [user.email, user.fullName, user.phone].forEach((value) => {
    const normalized = normalizeAdminUserSearchIndexValue(value);
    for (let start = 0; start < normalized.length - 1; start += 1) {
      for (let end = start + ADMIN_USER_SEARCH_INDEX_MIN_LENGTH; end <= normalized.length; end += 1) {
        hashes.add(hashAdminUserSearchIndexValue(normalized.slice(start, end)));
      }
    }
  });
  return Array.from(hashes).sort();
}

function haveAdminUserSearchFieldsChanged(beforeUser, afterUser) {
  if (!beforeUser || !afterUser) return true;
  return ['email', 'fullName', 'phone'].some(
    (field) => String(beforeUser[field] || '') !== String(afterUser[field] || '')
  );
}

module.exports = {
  ADMIN_USER_SEARCH_INDEX_MAX_SOURCE_LENGTH,
  ADMIN_USER_SEARCH_INDEX_MIN_LENGTH,
  buildAdminUserSearchHashes,
  hashAdminUserSearchIndexValue,
  haveAdminUserSearchFieldsChanged,
  normalizeAdminUserSearchIndexValue
};
