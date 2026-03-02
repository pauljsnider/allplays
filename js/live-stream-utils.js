export function normalizeYouTubeEmbedUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const raw = url.trim();
    if (!raw) return null;

    try {
        const parsed = new URL(raw);
        parsed.searchParams.set('autoplay', '1');
        parsed.searchParams.set('mute', '1');
        return parsed.toString();
    } catch {
        const [beforeHash, hash = ''] = raw.split('#');
        const queryIndex = beforeHash.indexOf('?');
        const base = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
        const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';
        const params = new URLSearchParams(query);
        params.set('autoplay', '1');
        params.set('mute', '1');
        const normalized = `${base}?${params.toString()}`;
        return hash ? `${normalized}#${hash}` : normalized;
    }
}

export function computePanelVisibility({ isMobile, activeTab, hasVideoStream }) {
    if (!isMobile) {
        return {
            activeTab,
            videoHidden: !hasVideoStream,
            playsHidden: false,
            statsHidden: false,
            chatHidden: false
        };
    }

    const safeActiveTab = activeTab === 'video' && !hasVideoStream ? 'plays' : activeTab;
    return {
        activeTab: safeActiveTab,
        videoHidden: safeActiveTab !== 'video' || !hasVideoStream,
        playsHidden: safeActiveTab !== 'plays',
        statsHidden: safeActiveTab !== 'stats',
        chatHidden: safeActiveTab !== 'chat'
    };
}
