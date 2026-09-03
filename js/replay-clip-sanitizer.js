export const REPLAY_CLIP_TRAVERSAL_LIMITS = Object.freeze({
    maxDepth: 20,
    maxNodes: 100_000,
    maxStringLength: 2_048
});

function traversalError(message) {
    const error = new Error(message);
    error.code = 'replay-clip-traversal-limit';
    return error;
}

/**
 * Walk and optionally remove strings from a Firestore-compatible clip value.
 * The same bounded traversal is shared by migration discovery, migration
 * scrubbing/verification, and client-side pre-migration sanitization.
 */
export function transformReplayClipValue(value, {
    onString = () => false,
    onProperty = () => false,
    maxDepth = REPLAY_CLIP_TRAVERSAL_LIMITS.maxDepth,
    maxNodes = REPLAY_CLIP_TRAVERSAL_LIMITS.maxNodes,
    maxStringLength = REPLAY_CLIP_TRAVERSAL_LIMITS.maxStringLength
} = {}) {
    const state = { nodes: 0 };
    const ancestors = new Set();

    function visit(current, key, depth) {
        state.nodes += 1;
        if (state.nodes > maxNodes) {
            throw traversalError('Replay clip traversal exceeded its bounded node count.');
        }
        if (depth > maxDepth) {
            throw traversalError('Replay clip traversal exceeded Firestore nesting depth.');
        }
        if (typeof current === 'string') {
            if (current.length > maxStringLength) {
                throw traversalError('Replay clip traversal encountered an oversized string.');
            }
            const removed = onString(current, { key, depth }) === true;
            return { changed: removed, removed, value: removed ? null : current };
        }
        if (!current || typeof current !== 'object') {
            return { changed: false, removed: false, value: current };
        }
        if (ancestors.has(current)) {
            throw traversalError('Replay clip traversal encountered a cyclic value.');
        }
        ancestors.add(current);
        try {
            if (Array.isArray(current)) {
                let changed = false;
                const next = [];
                current.forEach((entry) => {
                    const child = visit(entry, '', depth + 1);
                    changed ||= child.changed;
                    if (!child.removed) next.push(child.value);
                });
                return { changed, removed: false, value: changed ? next : current };
            }

            let changed = false;
            let next = current;
            Object.entries(current).forEach(([childKey, entry]) => {
                if (onProperty(entry, { key: childKey, depth: depth + 1 }) === true) {
                    if (!changed) next = { ...current };
                    changed = true;
                    delete next[childKey];
                    return;
                }
                const child = visit(entry, childKey, depth + 1);
                if (!child.changed) return;
                if (!changed) next = { ...current };
                changed = true;
                if (child.removed) delete next[childKey];
                else next[childKey] = child.value;
            });
            return { changed, removed: false, value: next };
        } finally {
            ancestors.delete(current);
        }
    }

    const result = visit(value, '', 0);
    return { ...result, nodes: state.nodes };
}
