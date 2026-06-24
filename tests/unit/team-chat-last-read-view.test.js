import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('team chat last-read view integration', () => {
    it('marks the active conversation as read when messages load', () => {
        const html = readFileSync(new URL('../../team-chat.html', import.meta.url), 'utf8');

        expect(html).toContain('updateChatLastRead(currentUser.uid, teamId, selectedConversationId)');
    });
});
