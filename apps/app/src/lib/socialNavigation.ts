const socialPostRoutePattern = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/;
const socialPostRouteBase = 'https://allplays.local';
const maxSocialPostRouteLength = 500;

export function getSafeSocialPostRoute(route: unknown, href: unknown): string | null {
  if (href !== null && href !== undefined) return null;
  if (typeof route !== 'string' || !route || route.length > maxSocialPostRouteLength) return null;
  if (!socialPostRoutePattern.test(route) || route.startsWith('//')) return null;

  try {
    const parsed = new URL(route, socialPostRouteBase);
    const canonicalRoute = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (parsed.origin !== socialPostRouteBase || canonicalRoute !== route) return null;
    return route;
  } catch {
    return null;
  }
}

export function getStoredSocialPostNavigation(
  data: Record<string, unknown>,
  snapshot: Record<string, unknown>
) {
  const route = data.route ?? null;
  const href = data.href ?? null;
  const snapshotRoute = snapshot.route ?? null;
  const snapshotHref = snapshot.href ?? null;
  if (route !== snapshotRoute || href !== snapshotHref) {
    return { route: null, href: null };
  }
  return { route: getSafeSocialPostRoute(route, href), href: null };
}

export function normalizeSocialPostNavigationForCreate(route: unknown, href: unknown) {
  if (href !== null && href !== undefined) {
    throw new Error('Social post navigation does not support href destinations.');
  }
  if (route === null || route === undefined || route === '') {
    return { route: null, href: null };
  }
  if (typeof route !== 'string') {
    throw new Error('Social post navigation must use an app route.');
  }

  const normalizedRoute = route.trim();
  const safeRoute = getSafeSocialPostRoute(normalizedRoute, null);
  if (!safeRoute) {
    throw new Error('Social post navigation must use a canonical app route.');
  }
  return { route: safeRoute, href: null };
}
