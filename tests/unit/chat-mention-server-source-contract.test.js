import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('server-side chat mention notification contract', () => {
    it('detects mentions on the server and records mentionedUids on the message document', () => {
        expect(functionsSource).toContain('function buildTeamChatNotificationPlan({ text, actorUid = null, recipientContext })');
        expect(functionsSource).toContain('detectMentionedUids(text, mentionMembers, { allowReservedMentions: actorIsStaff })');
        expect(functionsSource).toContain('const mentionedUids = notificationPlan.mentionedUids;');
        expect(functionsSource).toContain('await snapshot.ref.update({ mentionedUids });');
    });

    it('sends mention-category pushes separately from generic liveChat pushes', () => {
        expect(functionsSource).toContain("category: 'mentions'");
        expect(functionsSource).toContain('title: `${senderName} mentioned you`');
        expect(functionsSource).toContain("category: 'liveChat'");
        expect(functionsSource).toContain('title: `${senderName}: Team Chat`');
        expect(functionsSource).toContain('conversationId');
    });

    it('deduplicates mentioned and muted users out of generic liveChat targets', () => {
        expect(functionsSource).toContain('const mentionedSet = new Set(mentionedUids);');
        expect(functionsSource).toContain('const mutedSet = new Set(Array.isArray(context.mutedUids) ? context.mutedUids : []);');
        expect(functionsSource).toContain('&& !mentionedSet.has(target.uid)');
        expect(functionsSource).toContain('&& !mutedSet.has(target.uid)');
    });

    it('wires the same handler for default and per-conversation chat messages', () => {
        expect(functionsSource).toContain("exports.notifyTeamChatMessageCreated = functions.firestore\n  .document('teams/{teamId}/chatMessages/{messageId}')\n  .onCreate(handleTeamChatMessageCreated);");
        expect(functionsSource).toContain("exports.notifyConversationChatMessageCreated = functions.firestore\n  .document('teams/{teamId}/chatConversations/{conversationId}/chatMessages/{messageId}')\n  .onCreate(handleTeamChatMessageCreated);");
    });
});
