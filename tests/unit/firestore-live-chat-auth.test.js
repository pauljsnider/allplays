import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

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
const liveInteractionLifecycleBlock = extractMatchBlock(rulesSource, 'function canCreateLiveGameInteraction(teamId, gameId)');

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
        expect(rulesSource).toContain('canReadScopedGameHelper(teamId, gameId)');
        expect(rulesSource).toContain("scorekeeping.get('mode', '') == 'selected'");
        expect(rulesSource).toContain("videography.get('mode', '') == 'selected'");
        expect(rulesSource).toContain("streaming.get('mode', '') == 'selected'");
        expect(rulesSource).toContain('isAuthorizedOfficialForGame(data) ||');
        expect(rulesSource).toContain('canReadPublicGameDocument(get(teamPath).data, get(gamePath).data)');
        expect(rulesSource).toContain("data.get('shareable', false) == true");
        expect(rulesSource).toContain("data.get('publicCalendar', false) == true");
    });
});

describe('firestore rules — liveChat authentication requirements', () => {
    it('extracts the liveChat match block from firestore.rules', () => {
        expect(liveChatBlock).not.toBeNull();
    });

    it('requires the verified-email authentication gate for liveChat creates', () => {
        expect(liveChatBlock).toContain('isVerifiedForSensitiveWrite()');
        expect(rulesSource).toContain('function isVerifiedForSensitiveWrite()');
        expect(rulesSource).toContain('return isSignedIn() &&');
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
        expect(liveChatValidatorBlock).toContain('hasCanonicalLiveChatSenderPhoto(data)');
        expect(liveChatValidatorBlock).toContain("!('isAnonymous' in data) || data.isAnonymous is bool");
        expect(liveChatValidatorBlock).not.toContain("'ai'");
        expect(liveChatValidatorBlock).not.toContain("'aiQuestion'");
    });
});

describe('firestore rules — liveReactions authentication requirements', () => {
    it('extracts the liveReactions match block from firestore.rules', () => {
        expect(liveReactionsBlock).not.toBeNull();
    });

    it('requires the verified-email authentication gate for liveReactions creates', () => {
        expect(liveReactionsBlock).toContain('isVerifiedForSensitiveWrite()');
        expect(rulesSource).toContain('function isVerifiedForSensitiveWrite()');
        expect(rulesSource).toContain('return isSignedIn() &&');
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

describe('firestore rules — live interaction lifecycle requirements', () => {
    it('uses one shared parent-game lifecycle helper for chat and reaction creates', () => {
        expect(liveInteractionLifecycleBlock).not.toBeNull();
        expect(liveChatBlock).toContain('canCreateLiveGameInteraction(teamId, gameId)');
        expect(liveReactionsBlock).toContain('canCreateLiveGameInteraction(teamId, gameId)');
    });

    it('fails closed for every terminal status and liveStatus value', () => {
        expect(liveInteractionLifecycleBlock).toContain(
            "gameData.get('status', '') in ['completed', 'final', 'cancelled', 'canceled', 'deleted']"
        );
        expect(liveInteractionLifecycleBlock).toContain(
            "gameData.get('liveStatus', '') in ['completed', 'final', 'cancelled', 'canceled', 'deleted']"
        );
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('live interaction lifecycle rules-engine coverage', () => {
    const terminalStates = ['completed', 'final', 'cancelled', 'canceled', 'deleted'];
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: 'demo-allplays',
            firestore: { rules: rulesSource }
        });
    }, 30_000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await setDoc(doc(firestore, 'teams/shareable-team'), {
                ownerId: 'shareable-owner',
                adminEmails: [],
                active: true
            });
            await setDoc(doc(firestore, 'teams/private-team'), {
                ownerId: 'private-owner',
                adminEmails: [],
                active: true
            });
            await setDoc(doc(firestore, 'teams/cross-tenant-team'), {
                ownerId: 'cross-tenant-owner',
                adminEmails: [],
                active: true
            });
            await setDoc(doc(firestore, 'users/fan-1'), {
                isAdmin: false,
                parentTeamIds: ['private-team'],
                parentPlayerKeys: []
            });
            await setDoc(doc(firestore, 'teams/shareable-team/games/active-game'), {
                type: 'game',
                visibility: 'public',
                shareable: true,
                status: 'scheduled',
                liveStatus: 'live'
            });
            await setDoc(doc(firestore, 'teams/private-team/games/active-game'), {
                type: 'game',
                visibility: 'private',
                status: 'scheduled',
                liveStatus: 'live'
            });
            await setDoc(doc(firestore, 'teams/cross-tenant-team/games/active-game'), {
                type: 'game',
                visibility: 'private',
                status: 'scheduled',
                liveStatus: 'live'
            });

            for (const state of terminalStates) {
                await setDoc(doc(firestore, `teams/shareable-team/games/status-${state}`), {
                    type: 'game',
                    visibility: 'public',
                    shareable: true,
                    status: state,
                    liveStatus: 'live'
                });
                await setDoc(doc(firestore, `teams/shareable-team/games/live-status-${state}`), {
                    type: 'game',
                    visibility: 'public',
                    shareable: true,
                    status: 'scheduled',
                    liveStatus: state
                });
            }

            await setDoc(doc(firestore, 'teams/shareable-team/games/status-completed/liveChat/historical-chat'), {
                text: 'Historical message',
                senderId: 'fan-1',
                createdAt: new Date(0)
            });
            await setDoc(doc(firestore, 'teams/shareable-team/games/status-completed/liveReactions/historical-reaction'), {
                type: 'clap',
                senderId: 'fan-1',
                createdAt: new Date(0)
            });
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    function fanDb() {
        return testEnv.authenticatedContext('fan-1', {
            email: 'fan@example.com',
            email_verified: true
        }).firestore();
    }

    function chatWrite(firestore, teamId, gameId, messageId) {
        return setDoc(doc(firestore, `teams/${teamId}/games/${gameId}/liveChat/${messageId}`), {
            text: 'Go team',
            senderId: 'fan-1',
            createdAt: serverTimestamp()
        });
    }

    function reactionWrite(firestore, teamId, gameId, reactionId) {
        return setDoc(doc(firestore, `teams/${teamId}/games/${gameId}/liveReactions/${reactionId}`), {
            type: 'clap',
            senderId: 'fan-1',
            createdAt: serverTimestamp()
        });
    }

    it('allows a verified fan to create chat and reactions for active authorized games', async () => {
        const firestore = fanDb();
        await assertSucceeds(chatWrite(firestore, 'shareable-team', 'active-game', 'shareable-chat'));
        await assertSucceeds(reactionWrite(firestore, 'shareable-team', 'active-game', 'shareable-reaction'));
        await assertSucceeds(chatWrite(firestore, 'private-team', 'active-game', 'private-chat'));
        await assertSucceeds(reactionWrite(firestore, 'private-team', 'active-game', 'private-reaction'));
    });

    it('denies cross-tenant chat and reaction creates for an unauthorized private game', async () => {
        const firestore = fanDb();
        await assertFails(chatWrite(firestore, 'cross-tenant-team', 'active-game', 'cross-tenant-chat'));
        await assertFails(reactionWrite(firestore, 'cross-tenant-team', 'active-game', 'cross-tenant-reaction'));
    });

    it('denies chat and reaction creates for every terminal status and liveStatus', async () => {
        const firestore = fanDb();
        for (const state of terminalStates) {
            for (const gameId of [`status-${state}`, `live-status-${state}`]) {
                await assertFails(chatWrite(firestore, 'shareable-team', gameId, `chat-${state}`));
                await assertFails(reactionWrite(firestore, 'shareable-team', gameId, `reaction-${state}`));
            }
        }
    });

    it('keeps completed-game historical chat and reactions readable', async () => {
        const firestore = fanDb();
        await assertSucceeds(getDoc(doc(
            firestore,
            'teams/shareable-team/games/status-completed/liveChat/historical-chat'
        )));
        await assertSucceeds(getDoc(doc(
            firestore,
            'teams/shareable-team/games/status-completed/liveReactions/historical-reaction'
        )));
    });
});
