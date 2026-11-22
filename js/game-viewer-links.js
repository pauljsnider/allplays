// Upgrade links when rendering new navigation; never rewrite persisted or previously sent URLs.
export function upgradeGameViewerUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return value;
    try {
        const input = value.trim();
        const url = new URL(input, 'https://allplays.ai/');
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return value;
        if (!['allplays.ai', 'www.allplays.ai', 'share.allplays.ai'].includes(url.hostname)) return value;
        const params = new URLSearchParams(url.hash.replace(/^#\??/, ''));
        for (const [key, item] of url.searchParams) params.set(key, item);
        if (params.get('broadcast') === 'setup') return value;
        if (url.pathname === '/live-game.html') {
            url.pathname = '/live-game-overlay.html';
            params.delete('classic');
        } else if (url.pathname === '/watch') {
            params.set('overlay', 'true');
        } else {
            return value;
        }
        url.search = params.toString();
        url.hash = '';
        if (/^(?:https?:)?\/\//i.test(input)) return url.toString();
        return `${input.startsWith('/') ? '/' : ''}${url.pathname.slice(1)}${url.search}`;
    } catch {
        return value;
    }
}
