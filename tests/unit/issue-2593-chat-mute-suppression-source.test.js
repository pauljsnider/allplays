import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const messagesSource = readFileSync(new URL('../../apps/app/src/pages/Messages.tsx', import.meta.url), 'utf8');
const chatServiceSource = readFileSync(new URL('../../apps/app/src/lib/chatService.ts', import.meta.url), 'utf8');
const chatServiceTestSource = readFileSync(new URL('./app-chat-service-recipients.test.js', import.meta.url), 'utf8');

describe('issue 2593 chat mute and live suppression source contract', () => {
    it('keeps the Messages mute button wired to the selected conversation', () => {
        expect(messagesSource).toContain("import {");
        expect(messagesSource).toContain('muteTeamChat,');
        expect(messagesSource).toContain('unmuteTeamChat,');
        expect(messagesSource).toContain('const [isMuted, setIsMuted] = useState(() => resolveMutedState(teamId, DEFAULT_TEAM_CONVERSATION_ID, inboxTeam, {}));');
        expect(messagesSource).toContain('const conversationId = effectiveConversationId;');
        expect(messagesSource).toContain('await muteTeamChat(auth.user.uid, teamId, conversationId);');
        expect(messagesSource).toContain('await unmuteTeamChat(auth.user.uid, teamId, conversationId);');
        expect(messagesSource).toContain("aria-label={isMuted ? 'Unmute notifications' : 'Mute notifications'}");
        expect(messagesSource).toContain('aria-pressed={isMuted}');
    });

    it('keeps conversation-keyed mute persistence in the chat service', () => {
        expect(chatServiceSource).toContain('function isConversationMuted(profile: Record<string, any>, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID)');
        expect(chatServiceSource).toContain('const mutedConversations = getTeamChatStateEntry(profile, teamId).mutedConversations;');
        expect(chatServiceSource).toContain('export async function muteTeamChat(uid: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID): Promise<void>');
        expect(chatServiceSource).toContain('await withTimeout(Promise.resolve(updateChatMuted(uid, teamId, conversationId)), \'Chat mute update\', 2500);');
        expect(chatServiceSource).toContain('[conversationId]: mutedAt');
        expect(chatServiceSource).toContain('export async function unmuteTeamChat(uid: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID): Promise<void>');
        expect(chatServiceSource).toContain('delete mutedConversations[conversationId];');
    });

    it('keeps regression coverage for muted inbox previews and selected conversation writes', () => {
        expect(chatServiceTestSource).toContain('muteTeamChat sets mutedAt via updateChatMuted for the selected conversation');
        expect(chatServiceTestSource).toContain('unmuteTeamChat deletes mutedAt via clearChatMuted for the selected conversation');
        expect(chatServiceTestSource).toContain('loadChatInbox sets isMuted from the conversation-keyed team chat state');
        expect(chatServiceTestSource).toContain('loadChatInbox includes deferred preview mute state for non-default conversations');
    });
});
