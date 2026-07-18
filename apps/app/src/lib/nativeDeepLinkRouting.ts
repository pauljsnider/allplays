import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

type NativeDeepLinkEvent = {
  url?: string | null;
};

type NativeDeepLinkPlugin = {
  addListener: (eventName: 'appUrlOpen', listener: (event: NativeDeepLinkEvent) => void) => Promise<{ remove: () => Promise<void> | void }>;
  getLaunchUrl?: () => Promise<NativeDeepLinkEvent>;
};

type NativeDeepLinkDeps = {
  appPlugin?: NativeDeepLinkPlugin;
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (pluginName: string) => boolean;
};

const appHosts = new Set(['allplays.ai', 'www.allplays.ai']);
const appPathPrefix = '/app';
const customSchemes = new Set(['allplays', 'ai.allplays.lite']);
const maximumDeepLinkLength = 2048;
const duplicateWindowMs = 1000;

export async function addNativeDeepLinkListener(onRoute: (route: string) => void, deps: NativeDeepLinkDeps = {}) {
  const isNativePlatform = deps.isNativePlatform || (() => Capacitor.isNativePlatform());
  const isPluginAvailable = deps.isPluginAvailable || ((pluginName: string) => (Capacitor as any).isPluginAvailable?.(pluginName) !== false);
  if (!isNativePlatform() || !isPluginAvailable('App')) return () => {};

  const plugin = deps.appPlugin || (CapacitorApp as NativeDeepLinkPlugin);
  let lastHandledUrl = '';
  let lastHandledAt = 0;
  const routeUrl = (url: unknown) => {
    const rawUrl = String(url || '').trim();
    const now = Date.now();
    if (rawUrl && rawUrl === lastHandledUrl && now - lastHandledAt <= duplicateWindowMs) return;
    const route = resolveNativeDeepLinkRoute(rawUrl);
    if (!route) return;
    lastHandledUrl = rawUrl;
    lastHandledAt = now;
    onRoute(route);
  };
  const handle = await plugin.addListener('appUrlOpen', (event) => {
    routeUrl(event.url);
  });
  if (typeof plugin.getLaunchUrl === 'function') {
    const launchEvent = await plugin.getLaunchUrl().catch(() => null);
    routeUrl(launchEvent?.url);
  }

  return () => {
    void handle.remove();
  };
}

export function resolveNativeDeepLinkRoute(url: unknown) {
  const rawUrl = String(url || '').trim();
  if (
    !rawUrl
    || rawUrl.length > maximumDeepLinkLength
    || /[\u0000-\u001f\u007f\\]/.test(rawUrl)
  ) return null;

  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.username || parsedUrl.password || parsedUrl.port) return null;
    if (parsedUrl.protocol === 'https:' && appHosts.has(parsedUrl.hostname)) {
      return getRouteFromWebAppUrl(parsedUrl);
    }

    const scheme = parsedUrl.protocol.replace(/:$/, '');
    if (customSchemes.has(scheme)) {
      const route = getRouteFromCustomSchemeUrl(parsedUrl);
      return route && !isSensitiveActionRoute(route) ? route : null;
    }
  } catch {
    return null;
  }

  return null;
}

function getRouteFromWebAppUrl(url: URL) {
  if (url.pathname !== appPathPrefix && !url.pathname.startsWith(`${appPathPrefix}/`)) {
    return null;
  }

  const hashRoute = getRouteFromHash(url.hash);
  if (hashRoute) return hashRoute;

  const pathWithoutAppPrefix = url.pathname === appPathPrefix ? '/' : `/${url.pathname.slice(appPathPrefix.length + 1)}`;
  return normalizeRoute(`${pathWithoutAppPrefix}${url.search}`);
}

function getRouteFromCustomSchemeUrl(url: URL) {
  const hashRoute = getRouteFromHash(url.hash);
  if (hashRoute) return hashRoute;

  const hostPath = url.hostname && url.hostname !== 'app' ? `/${url.hostname}` : '';
  return normalizeRoute(`${hostPath}${url.pathname || ''}${url.search}`);
}

function getRouteFromHash(hash: string) {
  if (!hash.startsWith('#/')) return null;
  return normalizeRoute(hash.slice(1));
}

function normalizeRoute(route: string) {
  const trimmed = String(route || '').trim();
  if (!trimmed) return '/';
  const routeWithSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (
    routeWithSlash.length > maximumDeepLinkLength
    || routeWithSlash.startsWith('//')
    || /[\u0000-\u001f\u007f\\]/.test(routeWithSlash)
  ) return null;
  return routeWithSlash;
}

function isSensitiveActionRoute(route: string) {
  const [pathname, query = ''] = route.split('?', 2);
  if (pathname.toLowerCase() === '/reset-password') return true;
  const params = new URLSearchParams(query);
  if (params.has('oobCode')) return true;
  const mode = String(params.get('mode') || '').toLowerCase();
  return ['resetpassword', 'verifyemail', 'recoveremail', 'signin'].includes(mode);
}
