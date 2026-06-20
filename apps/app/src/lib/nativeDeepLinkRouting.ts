import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

type NativeDeepLinkEvent = {
  url?: string | null;
};

type NativeDeepLinkPlugin = {
  addListener: (eventName: 'appUrlOpen', listener: (event: NativeDeepLinkEvent) => void) => Promise<{ remove: () => Promise<void> | void }>;
};

type NativeDeepLinkDeps = {
  appPlugin?: NativeDeepLinkPlugin;
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (pluginName: string) => boolean;
};

const appHosts = new Set(['allplays.ai', 'www.allplays.ai']);
const appPathPrefix = '/app';
const customSchemes = new Set(['allplays', 'ai.allplays.lite']);

export async function addNativeDeepLinkListener(onRoute: (route: string) => void, deps: NativeDeepLinkDeps = {}) {
  const isNativePlatform = deps.isNativePlatform || (() => Capacitor.isNativePlatform());
  const isPluginAvailable = deps.isPluginAvailable || ((pluginName: string) => (Capacitor as any).isPluginAvailable?.(pluginName) !== false);
  if (!isNativePlatform() || !isPluginAvailable('App')) return () => {};

  const plugin = deps.appPlugin || (CapacitorApp as NativeDeepLinkPlugin);
  const handle = await plugin.addListener('appUrlOpen', (event) => {
    const route = resolveNativeDeepLinkRoute(event.url);
    if (route) onRoute(route);
  });

  return () => {
    void handle.remove();
  };
}

export function resolveNativeDeepLinkRoute(url: unknown) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) return null;

  try {
    const parsedUrl = new URL(rawUrl);
    if ((parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') && appHosts.has(parsedUrl.hostname)) {
      return getRouteFromWebAppUrl(parsedUrl);
    }

    const scheme = parsedUrl.protocol.replace(/:$/, '');
    if (customSchemes.has(scheme)) {
      return getRouteFromCustomSchemeUrl(parsedUrl);
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
  if (routeWithSlash.startsWith('//')) return null;
  return routeWithSlash;
}
