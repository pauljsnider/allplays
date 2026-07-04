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

const liveEventsBlock = extractMatchBlock(rulesSource, 'match /liveEvents/{eventId}');
const liveChatBlock = extractMatchBlock(rulesSource, 'match /liveChat/{messageId}');
const liveReactionsBlock = extractMatchBlock(rulesSource, 'match /liveReactions/{reactionId}');
const liveChatValidatorBlock = extractMatchBlock(rulesSource, 'function isValidLiveChatCreate(data)');
const liveReactionValidatorBlock = extractMatchBlock(rulesSource, 'function isValidLiveReactionCreate(data)');

describe('firestore rules — live game read visibility helpers', () => {
    it('keeps live events, chat, and reactions behind the shared game visibility helper', () => {
        expect(liveEventsBlock).toContain('allow read: if canReadGameSubcollectionDocument(teamId, gameId);');
        expect(liveChatBlock).toContain('allow read: if canReadGameSubcollectionDocument(teamId, gameId);');
        expect(liveReactionsBlock).toContain('allow read: if canReadGameSubcollectionDocument(teamId, gameId);');
        expect(liveEventsBlock).not.toContain('allow read: if true;');
        expect(liveChatBlock).not.toContain('allow read: if true;');
        expect(liveReactionsBlock).not.toContain('allow read: if true;');
    });

    it('preserves the shared helper coverage for private and shareable game reads', () => {
        expect(rulesSource).toContain('function canReadGameDocument(teamId, gameId, data)');
        expect(rulesSource).toContain('function canReadGameSubcollectionDocument(teamId, gameId)');
        expect(rulesSource).toContain('isTeamOwnerOrAdmin(teamId) ||');
        expect(rulesSource).toContain('isParentForTeam(teamId) ||');
        expect(rulesSource).toContain('canScorekeepGame(teamId, gameId) ||');
        expect(rulesSource).toContain('canVideographGame(teamId, gameId) ||');
        expect(rulesSource).toContain('isAuthorizedOfficialForGame(data) ||');
        expect(rulesSource).toContain('canReadPublicGameDocument(get(teamPath).data, data)');
        expect(rulesSource).toContain("data.get('shareable', false) == true");
        expect(rulesSource).toContain("data.get('publicCalendar', false) == true");
    });
});

describe('firestore rules — liveChat authentication requirements', () => {
    it('extracts the liveChat match block from firestore.rules', () => {
        expect(liveChatBlock).not.toBeNull();
    });

    it('requires isSignedIn() for liveChat creates (no unauthenticated writes)', () => {
        expect(liveChatBlock).toContain('isSignedIn()');
        expect(liveChatBlock).not.toMatch(/allow\s+create\s*:\s*if\s+true/);
    });

    it('validates that liveChat create requires text and senderId fields', () => {
        expect(liveChatBlock).toContain('isValidLiveChatCreate(request.resource.data)');
        expect(liveChatValidatorBlock).toContain("data.keys().hasAll(['text', 'senderId', 'createdAt'])");
    });

    it('validates that liveChat create checks senderId matches auth uid', () => {
        expect(liveChatValidatorBlock).toContain('data.senderId == request.auth.uid');
    });

    it('validates liveChat text field is a non-empty string capped at 2000 chars', () => {
        expect(liveChatValidatorBlock).toContain('data.text is string');
        expect(liveChatValidatorBlock).toContain('data.text.size() > 0');
        expect(liveChatValidatorBlock).toContain('data.text.size() <= 2000');
    });

    it('limits liveChat creates to the approved client payload shape', () => {
        expect(liveChatValidatorBlock).toContain(
            "data.keys().hasOnly([\n                   'text', 'senderId', 'senderName', 'senderPhotoUrl', 'isAnonymous', 'createdAt'\n                 ])"
        );
        expect(liveChatValidatorBlock).toContain('data.createdAt == request.time');
        expect(liveChatValidatorBlock).toContain('data.senderName == null');
        expect(liveChatValidatorBlock).toContain('data.senderName.size() <= 80');
        expect(liveChatValidatorBlock).toContain('data.senderPhotoUrl.size() <= 2048');
        expect(liveChatValidatorBlock).toContain("!('isAnonymous' in data) || data.isAnonymous is bool");
        expect(liveChatValidatorBlock).not.toContain("'ai'");
        expect(liveChatValidatorBlock).not.toContain("'aiQuestion'");
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
        expect(liveReactionsBlock).toContain('isValidLiveReactionCreate(request.resource.data)');
        expect(liveReactionValidatorBlock).toContain("data.keys().hasAll(['type', 'senderId', 'createdAt'])");
    });

    it('validates that liveReactions create checks senderId matches auth uid', () => {
        expect(liveReactionValidatorBlock).toContain('data.senderId == request.auth.uid');
    });

    it('limits liveReactions creates to request-time supported reaction payloads', () => {
        expect(liveReactionValidatorBlock).toContain("data.keys().hasOnly(['type', 'senderId', 'createdAt'])");
        expect(liveReactionValidatorBlock).toContain('data.createdAt == request.time');
        expect(liveReactionValidatorBlock).toContain("data.type in ['fire', 'clap', 'wow', 'heart', 'hundred']");
        expect(liveReactionValidatorBlock).not.toContain("'metadata'");
    });
});
