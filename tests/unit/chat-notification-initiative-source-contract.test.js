import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const functionsSource = readSource('functions/index.js');
const messagesSource = [
    readSource('apps/app/src/pages/Messages.tsx'),
    readSource('apps/app/src/pages/messages/components/ChatWindow.tsx')
].join('\n');
const chatServiceSource = readSource('apps/app/src/lib/chatService.ts');
const chatLogicSource = readSource('apps/app/src/lib/chatLogic.ts');

describe('chat notification initiative source contract', () => {
    it('keeps server mention pushes separate from muted generic liveChat delivery', () => {
        expect(functionsSource).toContain("category: 'mentions'");
        expect(functionsSource).toContain("category: 'liveChat'");
        expect(functionsSource).toContain('await snapshot.ref.update({ mentionedUids });');
        expect(functionsSource).toContain('&& !mentionedSet.has(target.uid)');
        expect(functionsSource).toContain('&& !mutedSet.has(target.uid)');
        expect(functionsSource).toContain('mutedConversations[normalizedConversationId]');
    });

    it('persists per-conversation mute state through chat service helpers', () => {
        expect(chatServiceSource).toContain('export async function muteTeamChat(uid: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID): Promise<void>');
        expect(chatServiceSource).toContain('export async function unmuteTeamChat(uid: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID): Promise<void>');
        expect(chatServiceSource).toContain('[conversationId]: mutedAt');
        expect(chatServiceSource).toContain('delete mutedConversations[conversationId];');
    });

    it('keeps the Messages UI wired to mute controls and mention composition/highlighting', () => {
        expect(messagesSource).toContain('muteTeamChat,');
        expect(messagesSource).toContain('unmuteTeamChat,');
        expect(messagesSource).toContain("aria-label={isMuted ? 'Unmute notifications' : 'Mute notifications'}");
        expect(messagesSource).toContain('const mentionSuggestions = useMemo(');
        expect(messagesSource).toContain('setText((current) => insertChatMention(current, mentionLabel));');
        expect(messagesSource).toContain('formatChatMessageHtml(message.text || \'\')');
    });

    it('escapes chat text while allowing only the supported mention span markup', () => {
        expect(chatLogicSource).toContain('export function formatChatMessageHtml(text: string)');
        expect(chatLogicSource).toContain('class="chat-mention"');
        expect(chatLogicSource).toContain('chat-mention\\1/i.test(rawAttributes) ? \'<span class="chat-mention">\' : \'<span>\';');
    });
});
