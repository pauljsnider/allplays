const defaultPublicOrigin = 'https://allplays.ai';

export const firebaseActionParameterNames = [
  'mode',
  'oobCode',
  'apiKey',
  'continueUrl',
  'lang',
  'tenantId'
] as const;

type AppLinkParams = Record<string, string | number | boolean | null | undefined> | URLSearchParams;

function normalizeOrigin(origin = defaultPublicOrigin) {
  const url = new URL(String(origin || defaultPublicOrigin));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('ALL PLAYS links require an HTTP(S) origin.');
  }
  return url.origin;
}

export function normalizeAppRoute(route = '/') {
  const value = String(route || '/').trim().replace(/^#/, '');
  const normalized = value.startsWith('/') ? value : `/${value}`;
  if (normalized.startsWith('//') || normalized.includes('\\')) {
    throw new Error('App routes must be origin-relative.');
  }
  return normalized;
}

export function appendAppRouteParams(route: string, params: AppLinkParams = {}) {
  const [pathname, existingQuery = ''] = normalizeAppRoute(route).split('?', 2);
  const query = new URLSearchParams(existingQuery);
  const entries = params instanceof URLSearchParams ? params.entries() : Object.entries(params);
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const queryString = query.toString();
  return `${pathname}${queryString ? `?${queryString}` : ''}`;
}

export function buildAppUrl(route = '/', params: AppLinkParams = {}, origin = getPublicAppOrigin()) {
  const url = new URL('/app/', normalizeOrigin(origin));
  url.hash = appendAppRouteParams(route, params);
  return url.toString();
}

export function getPublicAppOrigin() {
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) {
    return window.location.origin;
  }
  return defaultPublicOrigin;
}

function getHashRoute(url: URL) {
  const value = url.hash.replace(/^#/, '');
  return value ? normalizeAppRoute(value) : '';
}

function getContinueAppRoute(value: string, expectedOrigin: string) {
  if (!value) return '';
  try {
    const continueUrl = new URL(value);
    if (continueUrl.origin !== expectedOrigin || !/^\/app\/?$/.test(continueUrl.pathname)) return '';
    return getHashRoute(continueUrl);
  } catch {
    return '';
  }
}

function isFirebaseActionMode(mode: string) {
  return ['resetPassword', 'recoverEmail', 'verifyEmail', 'signIn'].includes(mode);
}

export function normalizeFirebaseActionHref(href: string) {
  const url = new URL(href);
  const outerParams = new URLSearchParams(url.search);
  const currentHashRoute = getHashRoute(url);
  const [currentHashPathname = '', currentHashQuery = ''] = currentHashRoute.split('?', 2);
  const currentHashParams = new URLSearchParams(currentHashQuery);
  const mode = outerParams.get('mode') || currentHashParams.get('mode') || '';
  const oobCode = outerParams.get('oobCode') || currentHashParams.get('oobCode') || '';
  if (!isFirebaseActionMode(mode) || !oobCode) {
    return url.toString();
  }

  const continueRoute = getContinueAppRoute(
    outerParams.get('continueUrl') || currentHashParams.get('continueUrl') || '',
    url.origin
  );
  let targetRoute = currentHashPathname && currentHashPathname !== '/auth'
    ? currentHashRoute
    : continueRoute;
  if (mode === 'signIn') {
    targetRoute = targetRoute || '/accept-invite';
  } else {
    targetRoute = '/reset-password';
  }

  const [targetPathname, targetQuery = ''] = targetRoute.split('?', 2);
  const hashParams = new URLSearchParams(targetQuery);
  if (mode === 'signIn' && currentHashPathname === '/auth') {
    for (const [name, value] of currentHashParams) {
      if (value && !hashParams.has(name)) hashParams.set(name, value);
    }
  }
  for (const name of firebaseActionParameterNames) {
    const value = outerParams.get(name) || currentHashParams.get(name);
    if (value && !hashParams.has(name)) {
      hashParams.set(name, value);
    }
    outerParams.delete(name);
  }

  if (mode === 'verifyEmail' && !hashParams.has('next')) {
    hashParams.set('next', '/verify-pending');
  }

  const queryString = hashParams.toString();
  url.search = outerParams.toString();
  url.hash = `${targetPathname}${queryString ? `?${queryString}` : ''}`;
  return url.toString();
}

export function buildFirebaseSdkActionHref(href: string) {
  const url = new URL(href);
  const hashRoute = getHashRoute(url);
  const [, hashQuery = ''] = hashRoute.split('?', 2);
  const hashParams = new URLSearchParams(hashQuery);
  for (const name of firebaseActionParameterNames) {
    const value = hashParams.get(name);
    if (value && !url.searchParams.has(name)) {
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
}

export function normalizeInitialFirebaseActionLocation() {
  if (typeof window === 'undefined') return false;
  const normalizedHref = normalizeFirebaseActionHref(window.location.href);
  if (normalizedHref === window.location.href) return false;
  window.history.replaceState(window.history.state, '', normalizedHref);
  return true;
}
