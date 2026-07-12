export function getSafeAuthNextRoute(value: string | null | undefined) {
  const route = String(value || '').trim();
  if (!route || route.length > 500 || !route.startsWith('/') || route.startsWith('//') || route.includes('\\')) return '';
  try {
    const url = new URL(route, 'https://allplays.local');
    if (url.origin !== 'https://allplays.local') return '';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}
