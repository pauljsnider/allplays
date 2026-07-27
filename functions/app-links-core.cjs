'use strict';

const ALLPLAYS_ORIGIN = 'https://allplays.ai';

function normalizeOrigin(origin = ALLPLAYS_ORIGIN) {
  const parsed = new URL(String(origin || ALLPLAYS_ORIGIN));
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('ALL PLAYS links require an HTTP(S) origin.');
  }
  return parsed.origin;
}

function normalizeAppRoute(route = '/') {
  const value = String(route || '/').trim().replace(/^#/, '');
  const normalized = value.startsWith('/') ? value : `/${value}`;
  if (normalized.startsWith('//') || normalized.includes('\\')) {
    throw new Error('App routes must be origin-relative.');
  }
  return normalized;
}

function appendParams(route, params = {}) {
  const [pathname, existingQuery = ''] = normalizeAppRoute(route).split('?', 2);
  const query = new URLSearchParams(existingQuery);
  const entries = params instanceof URLSearchParams ? params.entries() : Object.entries(params || {});
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') continue;
    query.set(String(key), String(value));
  }
  const queryString = query.toString();
  return `${pathname}${queryString ? `?${queryString}` : ''}`;
}

function buildAppUrl(route = '/', params = {}, origin = ALLPLAYS_ORIGIN) {
  const url = new URL('/app/', normalizeOrigin(origin));
  url.hash = appendParams(route, params);
  return url.toString();
}

function buildAuthAppUrl({ mode = '', code = '', type = '', next = '' } = {}, origin = ALLPLAYS_ORIGIN) {
  return buildAppUrl('/auth', { mode, code, type, next }, origin);
}

function buildAcceptInviteAppUrl(code, type = '', origin = ALLPLAYS_ORIGIN) {
  return buildAppUrl('/accept-invite', {
    code: String(code || '').trim().toUpperCase(),
    type: String(type || '').trim().toLowerCase()
  }, origin);
}

function buildRegistrationAppUrl(params = {}, origin = ALLPLAYS_ORIGIN) {
  return buildAppUrl('/registration', params, origin);
}

function buildParentFeesAppUrl(params = {}, origin = ALLPLAYS_ORIGIN) {
  return buildAppUrl('/parent-tools/fees', params, origin);
}

module.exports = {
  ALLPLAYS_ORIGIN,
  appendParams,
  buildAcceptInviteAppUrl,
  buildAppUrl,
  buildAuthAppUrl,
  buildParentFeesAppUrl,
  buildRegistrationAppUrl,
  normalizeAppRoute,
  normalizeOrigin
};
