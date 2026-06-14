import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const rulesSource = fs.readFileSync(path.join(repoRoot, 'firestore.rules'), 'utf8');

/**
 * Extract the content of a match block by its collection name.
 * Finds the opening `{` that follows the closing `}` of the match path pattern,
 * then returns the text up to the matching closing `}`.
 */
function extractMatchBlock(source, collectionPattern) {
    const markerIndex = source.indexOf(collectionPattern);
    if (markerIndex === -1) return null;

    // The match pattern ends with `}` (e.g. `{messageId}`), find the `{`
    // that opens the block *after* the pattern's closing `}`.
    const patternEnd = markerIndex + collectionPattern.length;
    // Skip the closing '}' of the match path variable, then find the block '{'
    const blockStart = source.indexOf('{', patternEnd);
    if (blockStart === -1) return null;

    let depth = 1;
    for (let i = blockStart + 1; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(blockStart + 1, i);
    }
    return null;
}

const liveChatBlock = extractMatchBlock(rulesSource, 'match /liveChat/{messageId}');
const liveReactionsBlock = extractMatchBlock(rulesSource, 'match /liveReactions/{reactionId}');

describe('firestore rules — liveChat authentication requirements', () => {
    it('extracts the liveChat match block from firestore.rules', () => {
        expect(liveChatBlock).not.toBeNull();
    });

    it('requires isSignedIn() for liveChat creates (no unauthenticated writes)', () => {
        expect(liveChatBlock).toContain('isSignedIn()');
        expect(liveChatBlock).not.toMatch(/allow\s+create\s*:\s*if\s+true/);
    });

    it('validates that liveChat create requires text and senderId fields', () => {
        expect(liveChatBlock).toContain("hasAll(['text', 'senderId'])");
    });

    it('validates that liveChat create checks senderId matches auth uid', () => {
        expect(liveChatBlock).toContain('request.resource.data.senderId == request.auth.uid');
    });

    it('validates liveChat text field is a non-empty string capped at 2000 chars', () => {
        expect(liveChatBlock).toContain('request.resource.data.text is string');
        expect(liveChatBlock).toContain('request.resource.data.text.size() > 0');
        expect(liveChatBlock).toContain('request.resource.data.text.size() <= 2000');
    });
});

describe('firestore rules — liveReactions authentication requirements', () => {
    it('extracts the liveReactions match block from firestore.rules', () => {
        expect(liveReactionsBlock).not.toBeNull();
    });

    it('requires isSignedIn() for liveReactions creates (no unauthenticated writes)', () => {
        expect(liveReactionsBlock).toContain('isSignedIn()');
        expect(liveReactionsBlock).not.toMatch(/allow\s+create\s*:\s*if\s+true/);
    });

    it('validates that liveReactions create requires type and senderId fields', () => {
        expect(liveReactionsBlock).toContain("hasAll(['type', 'senderId'])");
    });

    it('validates that liveReactions create checks senderId matches auth uid', () => {
        expect(liveReactionsBlock).toContain('request.resource.data.senderId == request.auth.uid');
    });
});
