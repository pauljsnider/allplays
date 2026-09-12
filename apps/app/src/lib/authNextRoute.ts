import { buildAppUrl, getCanonicalPublicOrigin } from './appLinks';

type AuthNavigate = (route: string, options: { replace: boolean }) => void;

type AuthNavigationLocation = {
  hash: string;
  reload: () => void;
  replace: (route: string) => void;
};

type CompleteAuthNavigationOptions = {
  accountSwitchRequested?: boolean;
  locationObject?: AuthNavigationLocation;
  nativeRuntime?: boolean;
  openHostedAuth?: (url: string) => Promise<void>;
  reloadApp?: boolean;
};

const authRouteOrigin = 'https://allplays.local';
const documentAuthNextPathnames = new Set(['/live-game-diamond-v2.html']);

export function getSafeAuthNextRoute(value: string | null | undefined) {
  const route = String(value || '').trim();
  if (!route || route.length > 500 || !route.startsWith('/') || route.startsWith('//') || route.includes('\\')) return '';
  try {
    const url = new URL(route, authRouteOrigin);
    if (url.origin !== authRouteOrigin) return '';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}

export function getDocumentAuthNextRoute(value: string | null | undefined) {
  const route = getSafeAuthNextRoute(value);
  if (!route) return '';
  const url = new URL(route, authRouteOrigin);
  return documentAuthNextPathnames.has(url.pathname) ? route : '';
}

export function getHostedDocumentAuthNextUrl(
  value: string | null | undefined,
  accountSwitchRequested = false
) {
  const documentRoute = getDocumentAuthNextRoute(value);
  if (!documentRoute) return '';
  return buildAppUrl('/auth', {
    next: documentRoute,
    ...(accountSwitchRequested === true ? { switch: '1' } : {})
  }, getCanonicalPublicOrigin());
}

export async function completeAuthNavigation(
  value: string,
  navigate: AuthNavigate,
  {
    accountSwitchRequested = false,
    locationObject = window.location,
    nativeRuntime = false,
    openHostedAuth,
    reloadApp = false
  }: CompleteAuthNavigationOptions = {}
) {
  const route = getSafeAuthNextRoute(value);
  if (!route) {
    throw new Error('A valid origin-relative authentication destination is required.');
  }

  const documentRoute = getDocumentAuthNextRoute(route);
  if (documentRoute) {
    if (nativeRuntime || reloadApp) {
      const hostedAuthUrl = getHostedDocumentAuthNextUrl(documentRoute, accountSwitchRequested);
      if (!hostedAuthUrl || !openHostedAuth) {
        throw new Error('The hosted authentication handoff is unavailable.');
      }
      await openHostedAuth(hostedAuthUrl);
      return 'hosted-auth' as const;
    }
    locationObject.replace(documentRoute);
    return 'document' as const;
  }

  if (reloadApp) {
    locationObject.hash = `#${route}`;
    locationObject.reload();
    return 'app-reload' as const;
  }

  navigate(route, { replace: true });
  return 'app' as const;
}
