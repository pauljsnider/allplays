import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const mentionDetectionTestSource = readFileSync(new URL('./functions-chat-mention-detection.test.js', import.meta.url), 'utf8');
const deliveryContractSource = readFileSync(new URL('./chat-notification-delivery-contract.test.js', import.meta.url), 'utf8');

describe('issue 2589 chat mention notification source contract', () => {
    it('keeps server mention detection scoped to eligible conversation members', () => {
        expect(functionsSource).toContain('const teamChatMentionStartRegex =');
        expect(functionsSource).toContain('function detectMentionedUids(text, members, options = {})');
        expect(functionsSource).toContain('const { allowReservedMentions = false } = options || {};');
        expect(functionsSource).toContain('const members = Array.isArray(context.members) ? context.members : [];');
        expect(functionsSource).toContain('detectMentionedUids(text, members, { allowReservedMentions: actorIsStaff }).filter((uid) => uid !== actorUid)');
        expect(functionsSource).toContain('mentionInboxUids: mentionedUids');
    });

    it('keeps mention pushes separate from regular live-chat pushes', () => {
        expect(functionsSource).toContain('await snapshot.ref.update({ mentionedUids });');
        expect(functionsSource).toContain("category: 'mentions'");
        expect(functionsSource).toContain('targets: notificationPlan.mentionTargets');
        expect(functionsSource).toContain("category: 'liveChat'");
        expect(functionsSource).toContain('targets: notificationPlan.liveChatTargets');
        expect(functionsSource).toContain('&& !mentionDeliverySet.has(target.uid)');
        expect(functionsSource).toContain('&& !mutedSet.has(target.uid)');
    });

    it('keeps tests for mention matching and notification delivery split', () => {
        expect(mentionDetectionTestSource).toContain('matches a rostered multi-word display name exactly');
        expect(mentionDetectionTestSource).toContain('ignores reserved tokens unless the caller explicitly allows them');
        expect(mentionDetectionTestSource).toContain('uses per-conversation mute state before falling back to team-wide chatMuted');
        expect(deliveryContractSource).toContain('sends mention pushes only to mention-enabled users and falls other mentions back to live chat');
    });
});
