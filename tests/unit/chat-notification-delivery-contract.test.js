import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const chatServiceSource = readFileSync(new URL('../../apps/app/src/lib/chatService.ts', import.meta.url), 'utf8');
const messagesSource = [
    readFileSync(new URL('../../apps/app/src/pages/Messages.tsx', import.meta.url), 'utf8'),
    readFileSync(new URL('../../apps/app/src/pages/messages/components/ChatWindow.tsx', import.meta.url), 'utf8')
].join('\n');

describe('team chat notification delivery contract', () => {
    it('retries transient Auth resolution and makes notification event triggers durable', () => {
        expect(functionsSource).toContain('const retryableNotificationFunctions = functions.runWith({ failurePolicy: true });');
        expect(functionsSource).toContain('for (let attempt = 0; attempt < 3; attempt += 1)');
        expect(functionsSource).toContain('taggedError.notificationAuthResolutionFailed = true;');
        expect((functionsSource.match(/if \(isNotificationAuthResolutionFailure\([^)]*\)\) throw/g) || []).length).toBeGreaterThanOrEqual(4);
        expect(functionsSource).toContain('reminderDeliveryClaimId: claimId');
        const feeResolverStart = functionsSource.indexOf('async function resolveEligibleFeeReminderRecipient({');
        const feeReminderStart = functionsSource.indexOf('async function sendFeeUnpaidDueReminders()');
        const feeReminderEnd = functionsSource.indexOf('exports.sendFeeUnpaidDueReminders =', feeReminderStart);
        const feeResolverSource = functionsSource.slice(feeResolverStart, feeReminderStart);
        const feeReminderSource = functionsSource.slice(feeReminderStart, feeReminderEnd);
        expect(functionsSource).toContain('const FEE_REMINDER_CLAIM_LEASE_MS = 10 * 60 * 1000;');
        expect(feeReminderSource.indexOf('await claimFeeDueReminder(doc.ref, {'))
            .toBeLessThan(feeReminderSource.indexOf('requireCanonicalTeamAccess: true'));
        expect(feeReminderSource.indexOf('requireCanonicalTeamAccess: true'))
            .toBeLessThan(feeReminderSource.indexOf('beforeEffects: async ({ authorizedTargets }) => {'));
        expect(feeReminderSource).toContain('await markFeeDueReminderClaimSent(');
        expect(feeReminderSource).toContain('await releaseFeeDueReminderClaim(doc.ref, claimId, err)');
        expect(feeReminderSource).not.toContain('releaseReminder: true');
        expect(functionsSource).toContain('exports.notifyTeamChatMessageCreated = retryableNotificationFunctions.firestore');
        expect(functionsSource).toContain('exports.notifyConversationChatMessageCreated = retryableNotificationFunctions.firestore');
        expect(functionsSource).toContain('exports.notifyGameUpdated = retryableNotificationFunctions.firestore');
        expect(functionsSource).toContain('exports.notifyFeeAssigned = retryableNotificationFunctions.firestore');
        expect(functionsSource).toContain('exports.dispatchDueTeamMediaNotificationBatches = retryableTeamMediaNotificationFunctions.pubsub');
        expect(functionsSource).toContain('exports.sendFeeUnpaidDueReminders = retryableNotificationFunctions.pubsub');
    });

    it('builds one recipient context for mentions and live chat with per-conversation mute state', () => {
        expect(functionsSource).toContain('async function buildTeamChatNotificationContext(teamId, options = {})');
        expect(functionsSource).toContain('const enabledMemberUserIds = await getEnabledNotificationAuthUserIds(');
        expect(functionsSource).toContain('const { includeMentions = true, conversationId = null } = options || {};');
        expect(functionsSource).toContain("const { targetType = 'full_team', recipientIds = [] } = options || {};");
        expect(functionsSource).toContain('const normalizedConversationId = normalizeTeamChatConversationId(conversationId);');
        expect(functionsSource).toContain('const normalizedRecipientIds = Array.from(new Set(');
        expect(functionsSource).toContain("const categories = includeMentions ? ['mentions', 'liveChat'] : ['liveChat'];");
        expect(functionsSource).toContain('const mutedConversations = userRecord.teamChatState?.[teamId]?.mutedConversations;');
        expect(functionsSource).toContain('mutedConversations[normalizedConversationId]');
        expect(functionsSource).toContain("Boolean(normalizedConversationId === 'team' && chatMuted && chatMuted[teamId])");
        expect(functionsSource).toContain('mutedUids: hydratedMembers.filter((member) => member.muted).map((member) => member.uid)');
    });

    it('sends mention pushes only to mention-enabled users and falls other mentions back to live chat', () => {
        expect(functionsSource).toContain('const enabledDeliveryUids = await getEnabledNotificationAuthUserIds([');
        expect(functionsSource).toContain('notificationPlan.liveChatInboxUids = notificationPlan.liveChatInboxUids');
        expect(functionsSource).toContain('notificationPlan.liveChatTargets = notificationPlan.liveChatTargets');
        expect(functionsSource).toContain('function buildTeamChatNotificationPlan({ text, actorUid = null, recipientContext })');
        expect(functionsSource).toContain('const members = Array.isArray(context.members) ? context.members : [];');
        expect(functionsSource).toContain('const mentionedUids = text');
        expect(functionsSource).toContain('detectMentionedUids(text, members, { allowReservedMentions: actorIsStaff }).filter((uid) => uid !== actorUid)');
        expect(functionsSource).toContain("category: 'mentions'");
        expect(functionsSource).toContain('targets: notificationPlan.mentionTargets');
        expect(functionsSource).toContain('inboxUids: notificationPlan.mentionInboxUids');
        expect(functionsSource).toContain("category: 'liveChat'");
        expect(functionsSource).toContain('targets: notificationPlan.liveChatTargets');
        expect(functionsSource).toContain('inboxUids: notificationPlan.liveChatInboxUids');
        expect(functionsSource).toContain('!mentionDeliverySet.has(uid) && !mutedSet.has(uid)');
        expect(functionsSource).toContain('!mentionDeliverySet.has(target.uid)');
        expect(functionsSource).toContain('!mutedSet.has(target.uid)');
    });

    it('routes chat notification links to the matching app conversation', () => {
        expect(functionsSource).toContain("if (category === 'liveChat' || category === 'mentions') {");
        expect(functionsSource).toContain('return buildAppUrl(route, conversationId ? { conversationId } : {});');
        expect(functionsSource).toContain("if (category === 'mentions' && teamId) {");
        expect(functionsSource).toContain('return `${route}?conversation=${encodeURIComponent(conversationId)}`;');
        expect(functionsSource).toContain("if (category === 'liveChat' && teamId) {");
        expect(functionsSource).toContain('return `${route}?conversationId=${encodeURIComponent(conversationId)}`;');
        expect(functionsSource).toContain('conversationId: String(conversationId || \'\')');
    });

    it('lets the app toggle the same conversation mute keys the function reads', () => {
        expect(chatServiceSource).toContain('export async function muteTeamChat(uid: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID)');
        expect(chatServiceSource).toContain('export async function unmuteTeamChat(uid: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID)');
        expect(chatServiceSource).toContain('updateChatMuted(uid, teamId, conversationId)');
        expect(chatServiceSource).toContain('clearChatMuted(uid, teamId, conversationId)');
        expect(chatServiceSource).toContain('mutedConversations = {');
        expect(chatServiceSource).toContain('[conversationId]: mutedAt');
        expect(chatServiceSource).toContain('delete mutedConversations[conversationId]');
        expect(messagesSource).toContain('await muteTeamChat(auth.user.uid, teamId, conversationId);');
        expect(messagesSource).toContain('await unmuteTeamChat(auth.user.uid, teamId, conversationId);');
        expect(messagesSource).toContain('resolveMutedState(teamId, effectiveConversationId, inboxTeam, profile)');
    });
});
