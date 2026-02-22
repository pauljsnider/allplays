export function mergeUniqueDrills(communityDrills = [], publishedDrills = []) {
    const byId = new Map();
    [...communityDrills, ...publishedDrills].forEach((drill) => {
        if (!drill?.id) return;
        byId.set(drill.id, drill);
    });
    return [...byId.values()].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

export function linkifySafeText(text, escapeFn) {
    const escaped = escapeFn ? escapeFn(text || '') : String(text || '');
    return escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary-600 underline break-all">$1</a>'
    );
}

