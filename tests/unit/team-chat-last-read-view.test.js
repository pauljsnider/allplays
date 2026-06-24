import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('team chat last-read view integration', () => {
    it('captures the subscribed conversation before marking messages as read', () => {
        const html = readFileSync(new URL('../../team-chat.html', import.meta.url), 'utf8');

        expect(html).toContain('const subscriptionConversationId = selectedConversationId;');
        expect(html).toContain("(newMessages, oldestDoc) => handleRealtimeMessages(newMessages, oldestDoc, subscriptionConversationId)");
        expect(html).toContain('updateChatLastRead(currentUser.uid, teamId, conversationId)');
    });
});
