import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const dbSource = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');
const firestoreIndexes = JSON.parse(readFileSync(resolve(process.cwd(), 'firestore.indexes.json'), 'utf8'));
const legacyChatBackfillSource = readFileSync(
    resolve(process.cwd(), '_migration/backfill-legacy-team-chat-target-fields.js'),
    'utf8'
);

function currentUserReactionTokens(auth) {
    const tokens = [auth.uid, `user:${auth.uid}`];
    if (auth.email) {
        tokens.push(auth.email.toLowerCase(), `email:${auth.email.toLowerCase()}`);
    }
    return tokens;
}

function hasAny(values, candidates) {
    return candidates.some((candidate) => values.includes(candidate));
}

function hasAll(values, candidates) {
    return candidates.every((candidate) => values.includes(candidate));
}

function isSingleReactionTokenAddRemove(before, after, auth) {
    const actorTokens = currentUserReactionTokens(auth);
    return (
        hasAll(after, before) &&
        after.length === before.length + 1 &&
        hasAny(after, actorTokens) &&
        !hasAny(before, actorTokens)
    ) || (
        hasAll(before, after) &&
        before.length === after.length + 1 &&
        hasAny(before, actorTokens) &&
        !hasAny(after, actorTokens)
    );
}

function changedTopLevelKeys(before, after) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function changedReactionKeys(before, after) {
    const beforeReactions = before.reactions ?? {};
    const afterReactions = after.reactions ?? {};
    return [...new Set([...Object.keys(beforeReactions), ...Object.keys(afterReactions)])]
        .filter((key) => JSON.stringify(beforeReactions[key]) !== JSON.stringify(afterReactions[key]));
}

function allowsReactionUpdate(beforeDoc, afterDoc, reactionKey, auth) {
    const topLevelKeys = changedTopLevelKeys(beforeDoc, afterDoc);
    const isNestedReactionUpdate = topLevelKeys.length === 1 && topLevelKeys[0] === `reactions.${reactionKey}`;
    const isFullReactionMapUpdate = topLevelKeys.length === 1 &&
        topLevelKeys[0] === 'reactions' &&
        changedReactionKeys(beforeDoc, afterDoc).length === 1 &&
        changedReactionKeys(beforeDoc, afterDoc)[0] === reactionKey;

    return (isNestedReactionUpdate || isFullReactionMapUpdate) &&
        isSingleReactionTokenAddRemove(
            beforeDoc.reactions?.[reactionKey] ?? [],
            afterDoc.reactions?.[reactionKey] ?? [],
            auth
        );
}

describe('targeted team chat Firestore rules', () => {
    it('keeps full-team messages readable by existing team chat members', () => {
        expect(rules).toContain('function isFullTeamChatMessage(data)');
        expect(rules).toContain("data.get('targetType', 'full_team') == 'full_team'");
        expect(rules).toContain('hasEmptyChatRecipients(data)');
        expect(rules).toContain('isFullTeamChatMessage(data) ||');
    });

    it('keeps legacy team chat list queries constrained to full-team messages', () => {
        const legacyChatStart = rules.indexOf('match /chatMessages/{messageId} {');
        const conversationsStart = rules.indexOf('match /chatConversations/{conversationId} {');
        const legacyChatBlock = rules.slice(legacyChatStart, conversationsStart);

        expect(legacyChatBlock).toContain('allow list: if isFullTeamChatMessage(resource.data) &&');
        expect(legacyChatBlock).toContain('canReadChatMessage(teamId, resource.data);');
        expect(legacyChatBlock).toContain('allow get: if isFullTeamChatMessage(resource.data) &&');
        expect(legacyChatBlock).toContain('canReadChatMessage(teamId, resource.data);');
        expect(legacyChatBlock).not.toContain('allow read: if isFullTeamChatMessage(resource.data) &&');
        expect(legacyChatBlock).not.toContain('allow list: if canAccessTeamChat(teamId);');
        expect(rules).toContain('allow create: if canAccessTeamChat(teamId) &&');
        expect(rules).toContain('isFullTeamChatMessage(request.resource.data);');
        expect(rules).not.toContain('allow read: if canReadChatMessage(teamId, resource.data);');
    });

    it('requires target fields when listing or counting default legacy team chat messages', () => {
        expect(dbSource).toContain('function getDefaultTeamChatMessageConstraints(conversationId = DEFAULT_TEAM_CONVERSATION_ID)');
        expect(dbSource).toContain("where('targetType', '==', 'full_team')");
        expect(dbSource).toContain("where('recipientIds', '==', [])");
        expect(dbSource).toContain("query(messagesRef, ...defaultMessageConstraints, orderBy('createdAt', 'desc'), limitQuery(limit))");
        expect(dbSource).toContain("query(messagesRef, ...getDefaultTeamChatMessageConstraints(conversationId), orderBy('createdAt', 'desc'), limit(1))");
        expect(dbSource).toContain('const unreadConstraints = getDefaultTeamChatMessageConstraints(conversationId);');
    });

    it('bounds chat conversation discovery while preserving default and requested conversations', () => {
        expect(dbSource).toContain('export const DEFAULT_CHAT_CONVERSATION_PAGE_SIZE = 25;');
        expect(dbSource).toContain("query(conversationsRef, orderBy('updatedAt', 'desc'), limitQuery(conversationPageSize))");
        expect(dbSource).toContain("query(conversationsRef, where('participantIds', 'array-contains', user.uid), orderBy('updatedAt', 'desc'), limitQuery(conversationPageSize))");
        expect(dbSource).toContain("query(conversationsRef, where('participantIds', 'array-contains', `user:${user.uid}`), orderBy('updatedAt', 'desc'), limitQuery(conversationPageSize))");
        expect(dbSource).toContain("query(conversationsRef, where('participantIds', 'array-contains', `email:${normalizedEmail}`), orderBy('updatedAt', 'desc'), limitQuery(conversationPageSize))");
        expect(dbSource).toContain('const boundedStored = stored.slice(0, conversationPageSize);');
        expect(dbSource).toContain("const requestedConversationSnap = await getDoc(doc(db, 'teams', teamId, 'chatConversations', requestedConversationId));");
        expect(dbSource).toContain('} catch (error) {');
        expect(dbSource).toContain("console.warn('Ignoring unavailable requested chat conversation.', { teamId, requestedConversationId, error });");
        expect(dbSource).toContain('return [buildDefaultTeamConversation(team), ...boundedStored];');
    });

    it('includes a backfill for fieldless legacy full-team messages before constrained reads ship', () => {
        expect(legacyChatBackfillSource).toContain('function getLegacyFullTeamBackfill(data = {})');
        expect(legacyChatBackfillSource).toContain("String(data.targetType || 'full_team').trim() || 'full_team'");
        expect(legacyChatBackfillSource).toContain("updates.targetType = 'full_team';");
        expect(legacyChatBackfillSource).toContain('updates.recipientIds = [];');
        expect(legacyChatBackfillSource).toContain("targetType !== 'full_team' || !hasEmptyRecipients");
        expect(legacyChatBackfillSource).toContain('legacyTargetFieldsBackfilledAt');
    });

    it('declares target-field indexes for legacy team chat queries', () => {
        const chatMessageIndexes = firestoreIndexes.indexes.filter((index) => index.collectionGroup === 'chatMessages');
        expect(chatMessageIndexes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'targetType', order: 'ASCENDING' },
                    { fieldPath: 'recipientIds', order: 'ASCENDING' },
                    { fieldPath: 'createdAt', order: 'DESCENDING' }
                ]
            }),
            expect.objectContaining({
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'targetType', order: 'ASCENDING' },
                    { fieldPath: 'recipientIds', order: 'ASCENDING' },
                    { fieldPath: 'createdAt', order: 'ASCENDING' }
                ]
            }),
            expect.objectContaining({
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'targetType', order: 'ASCENDING' },
                    { fieldPath: 'recipientIds', order: 'ASCENDING' },
                    { fieldPath: 'senderId', order: 'ASCENDING' },
                    { fieldPath: 'createdAt', order: 'ASCENDING' }
                ]
            })
        ]));
    });

    it('keeps targeted conversation traffic under conversation-scoped rules', () => {
        expect(rules).toContain('match /chatConversations/{conversationId} {');
        expect(rules).toContain('match /chatMessages/{messageId} {');
        expect(rules).toContain('allow create: if canAccessChatConversation(teamId, conversationId, get(/databases/$(database)/documents/teams/$(teamId)/chatConversations/$(conversationId)).data) &&');
        expect(rules).toContain('isNestedChatMessageCreateValid(');
    });

    it('restricts staff/group messages to sender and team staff/admin roles', () => {
        expect(rules).toContain('function isStaffChatMessage(data)');
        expect(rules).toContain("data.get('targetRole', 'staff') == 'staff'");
        expect(rules).toContain('isTeamOwnerOrAdmin(teamId) ||');
        expect(rules).toContain('data.senderId == request.auth.uid');
    });

    it('restricts individual messages to sender, listed recipients, and staff/admins', () => {
        expect(rules).toContain('function isIndividualChatMessage(teamId, data)');
        expect(rules).toContain('function isCurrentChatRecipient(data)');
        expect(rules).toContain('request.auth.uid in data.recipientIds');
        expect(rules).toContain("('user:' + request.auth.uid) in data.recipientIds");
        expect(rules).toContain("('email:' + request.auth.token.email.lower()) in data.recipientIds");
        expect(rules).toContain('hasValidChatRecipientIds(teamId, data)');
    });

    it('rejects malformed or non-member recipient lists on targeted writes', () => {
        expect(rules).toContain('function teamChatRecipientIds(teamId)');
        expect(rules).toContain("data.get('chatMemberIds', [])");
        expect(rules).toContain('data.recipientIds is list');
        expect(rules).toContain('data.recipientIds.size() > 0');
        expect(rules).toContain('data.recipientIds.size() <= 50');
        expect(rules).toContain('data.recipientIds.hasOnly(teamChatRecipientIds(teamId))');
        expect(rules).toContain('isValidChatMessageTarget(teamId, data)');
    });

    it('rejects unauthorized senders by requiring senderId to match auth uid', () => {
        expect(rules).toContain('data.senderId == request.auth.uid &&');
    });

    it('locks membership and naming changes to team staff while letting participants update benign metadata', () => {
        expect(rules).toContain('function isChatConversationParticipantMetadataUpdate()');
        expect(rules).toContain("request.resource.data.get('name', null) == resource.data.get('name', null)");
        expect(rules).toContain("request.resource.data.get('participantIds', []) == resource.data.get('participantIds', [])");
        expect(rules).toContain("request.resource.data.get('participantRoles', []) == resource.data.get('participantRoles', [])");
        expect(rules).toContain(".hasOnly(['lastMessageAt', 'mutedBy', 'updatedAt']);");
        expect(rules).toContain('function isTeamStaffChatConversationUpdate(teamId)');
        expect(rules).toContain('return isTeamOwnerOrAdmin(teamId) &&');
        expect(rules).toContain('(isTeamStaffChatConversationUpdate(teamId) ||');
        expect(rules).toContain('isChatConversationParticipantMetadataUpdate());');
    });

    it('requires team staff/admin access and server-derived members for the canonical staff conversation', () => {
        expect(rules).toContain("function isCanonicalStaffChatConversation(conversationId)");
        expect(rules).toContain("return conversationId == 'group_role%3Astaff';");
        expect(rules).toContain("function isCanonicalStaffChatConversationPayload(conversationId, data)");
        expect(rules).toContain("data.get('type', '') == 'group'");
        expect(rules).toContain("'staff' in data.get('participantRoles', [])");
        expect(rules).toContain("data.get('participantIds', []) == []");
        expect(rules).toContain('isCanonicalStaffChatConversation(conversationId) &&');
        expect(rules).toContain('isTeamOwnerOrAdmin(teamId) &&');
        expect(rules).toContain('isCanonicalStaffChatConversationPayload(conversationId, conversationData)');
    });

    it('does not authorize staff-role conversations through caller-controlled participantIds', () => {
        expect(rules).toContain('function isStaffRoleChatConversation(data)');
        expect(rules).toContain("data.get('participantRoles', []) is list &&");
        expect(rules).toContain("'staff' in data.get('participantRoles', [])");
        expect(rules).toContain('!isCanonicalStaffChatConversation(conversationId) &&');
        expect(rules).toContain('!isStaffRoleChatConversation(conversationData) &&');
        const accessHelperStart = rules.indexOf('function canAccessChatConversation(teamId, conversationId, conversationData)');
        const accessHelperEnd = rules.indexOf('function isChatConversationPayloadValid(data)');
        const accessHelper = rules.slice(accessHelperStart, accessHelperEnd);

        expect(accessHelper).toContain('request.auth.uid in participantIds');
        expect(accessHelper.indexOf('!isStaffRoleChatConversation(conversationData) &&'))
            .toBeLessThan(accessHelper.indexOf('request.auth.uid in participantIds'));
    });

    it('keeps conversation list authorization compatible with existing participant and moderator queries', () => {
        expect(rules).toContain('allow get: if canAccessChatConversation(teamId, conversationId, resource.data);');
        expect(rules).toContain('allow list: if canListChatConversation(teamId, conversationId, resource.data);');
        expect(rules).toContain('function canListChatConversation(teamId, conversationId, conversationData)');

        const listHelperStart = rules.indexOf('function canListChatConversation(teamId, conversationId, conversationData)');
        const listHelperEnd = rules.indexOf('function isCanonicalStaffChatConversationPayload(conversationId, data)');
        const listHelper = rules.slice(listHelperStart, listHelperEnd);

        expect(listHelper).toContain('isTeamOwnerOrAdmin(teamId) ||');
        expect(listHelper).toContain('request.auth.uid in participantIds');
        expect(listHelper).not.toContain('!isStaffRoleChatConversation(conversationData)');
    });

    it('locks both legacy and targeted chat reactions to a single self-token toggle', () => {
        expect(rules).toContain('function isSelfChatReactionUpdate()');
        expect(rules).toContain('function currentUserReactionTokens()');
        expect(rules).toContain('function isCurrentUserReactionToggle(before, after)');
        expect(rules).toContain('isSingleReactionTokenAddRemove(before, after);');
        expect(rules).toContain("[request.auth.uid, 'user:' + request.auth.uid, request.auth.token.email.lower(), 'email:' + request.auth.token.email.lower()]");
        expect(rules).toContain("[request.auth.uid, 'user:' + request.auth.uid]");
        expect(rules).toContain('isSelfChatReactionUpdateForKey(\'thumbs_up\') ||');

        const legacyChatStart = rules.indexOf('match /chatMessages/{messageId} {');
        const conversationsStart = rules.indexOf('match /chatConversations/{conversationId} {');
        const legacyChatBlock = rules.slice(legacyChatStart, conversationsStart);
        expect(legacyChatBlock).toContain('isSelfChatReactionUpdate();');

        const targetedChatStart = rules.indexOf('match /chatMessages/{messageId} {', conversationsStart);
        const targetedChatEnd = rules.indexOf('// Server-only dedup log', targetedChatStart);
        const targetedChatBlock = rules.slice(targetedChatStart, targetedChatEnd);
        expect(targetedChatBlock).toContain('isSelfChatReactionUpdate();');
    });

    it('rejects cross-user reaction tampering and multi-reaction rewrites by construction', () => {
        expect(rules).toContain('request.resource.data.diff(resource.data).affectedKeys().size() == 1');
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactions.' + reactionKey])");
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactions'])");
        expect(rules).toContain("request.resource.data.get('reactions', {}).diff(resource.data.get('reactions', {})).affectedKeys().size() == 1");
        expect(rules).toContain("request.resource.data.get('reactions', {}).diff(resource.data.get('reactions', {})).affectedKeys().hasOnly([reactionKey])");
        expect(rules).toContain('after.hasAll(before) &&');
        expect(rules).toContain('before.hasAll(after) &&');
        expect(rules).toContain('after.hasAny(currentUserReactionTokens()) &&');
        expect(rules).toContain('!before.hasAny(currentUserReactionTokens())');
        expect(rules).toContain('before.hasAny(currentUserReactionTokens()) &&');
        expect(rules).toContain('!after.hasAny(currentUserReactionTokens())');
    });

    it('allows only one owned reaction token change for a message reaction key', () => {
        const auth = { uid: 'u1', email: 'player@example.com' };
        const before = { text: 'Go team', reactions: { thumbs_up: ['u2'] } };

        expect(allowsReactionUpdate(
            before,
            { ...before, reactions: { thumbs_up: ['u2', 'u1'] } },
            'thumbs_up',
            auth
        )).toBe(true);
        expect(allowsReactionUpdate(
            { ...before, reactions: { thumbs_up: ['u2', 'u1'] } },
            before,
            'thumbs_up',
            auth
        )).toBe(true);
        expect(allowsReactionUpdate(
            before,
            { ...before, reactions: { thumbs_up: ['u2', 'u3'] } },
            'thumbs_up',
            auth
        )).toBe(false);
        expect(allowsReactionUpdate(
            before,
            { ...before, text: 'Edited', reactions: { thumbs_up: ['u2', 'u1'] } },
            'thumbs_up',
            auth
        )).toBe(false);
        expect(allowsReactionUpdate(
            before,
            { ...before, reactions: { thumbs_up: ['u2', 'u1'], heart: ['u1'] } },
            'thumbs_up',
            auth
        )).toBe(false);
    });

    it('rejects alias-token reaction inflation by the same actor', () => {
        const auth = { uid: 'u1', email: 'player@example.com' };
        const beforeWithUid = { reactions: { thumbs_up: ['u1'] } };
        const beforeWithUserAlias = { reactions: { thumbs_up: ['user:u1'] } };
        const beforeWithEmail = { reactions: { thumbs_up: ['player@example.com'] } };

        expect(allowsReactionUpdate(
            beforeWithUid,
            { reactions: { thumbs_up: ['u1', 'user:u1'] } },
            'thumbs_up',
            auth
        )).toBe(false);
        expect(allowsReactionUpdate(
            beforeWithUserAlias,
            { reactions: { thumbs_up: ['user:u1', 'email:player@example.com'] } },
            'thumbs_up',
            auth
        )).toBe(false);
        expect(allowsReactionUpdate(
            beforeWithEmail,
            { reactions: { thumbs_up: ['player@example.com', 'email:player@example.com'] } },
            'thumbs_up',
            auth
        )).toBe(false);
    });
});
