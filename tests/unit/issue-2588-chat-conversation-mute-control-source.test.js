import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const messagesSource = [
    readFileSync(new URL('../../apps/app/src/pages/Messages.tsx', import.meta.url), 'utf8'),
    readFileSync(new URL('../../apps/app/src/pages/messages/components/ChatWindow.tsx', import.meta.url), 'utf8')
].join('\n');
const chatServiceSource = readFileSync(new URL('../../apps/app/src/lib/chatService.ts', import.meta.url), 'utf8');
const chatNotificationContractSource = readFileSync(new URL('./chat-notification-delivery-contract.test.js', import.meta.url), 'utf8');
const messagesIntegrationSource = readFileSync(new URL('./app-chat-messages-integration.test.jsx', import.meta.url), 'utf8');

describe('issue 2588 chat conversation mute control source contract', () => {
    it('keeps the app toggle writing per-conversation mute state', () => {
        expect(chatServiceSource).toContain('export async function muteTeamChat(uid: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID)');
        expect(chatServiceSource).toContain('export async function unmuteTeamChat(uid: string, teamId: string, conversationId = DEFAULT_TEAM_CONVERSATION_ID)');
        expect(chatServiceSource).toContain('const mutedConversations = {');
        expect(chatServiceSource).toContain('[conversationId]: mutedAt');
        expect(chatServiceSource).toContain('delete mutedConversations[conversationId]');
        expect(chatServiceSource).toContain('updates.chatMuted = {');
        expect(chatServiceSource).toContain('delete chatMuted[teamId]');
    });

    it('keeps Messages resolving mute state from inbox and persisted profile data', () => {
        expect(messagesSource).toContain('function updateInboxTeamMuteState(');
        expect(messagesSource).toContain('function resolveMutedState(');
        expect(messagesSource).toContain('resolveMutedState(teamId, effectiveConversationId, inboxTeam, profile)');
        expect(messagesSource).toContain('await muteTeamChat(auth.user.uid, teamId, conversationId);');
        expect(messagesSource).toContain('await unmuteTeamChat(auth.user.uid, teamId, conversationId);');
        expect(messagesSource).toContain("aria-label={isMuted ? 'Unmute notifications' : 'Mute notifications'}");
    });

    it('keeps regression coverage for selected-conversation mute behavior', () => {
        expect(chatNotificationContractSource).toContain('lets the app toggle the same conversation mute keys the function reads');
        expect(messagesIntegrationSource).toContain('loads deep-linked mute state from the conversation-keyed team chat profile when inbox data is unavailable');
        expect(messagesIntegrationSource).toContain('mute toggle button calls muteTeamChat then unmuteTeamChat for the active conversation');
        expect(messagesIntegrationSource).toContain('keeps the updated mute state after switching away and back to a muted staff conversation');
        expect(messagesIntegrationSource).toContain('rolls back the mute toggle when the server write fails');
    });
});
