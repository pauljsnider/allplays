import { describe, expect, it } from 'vitest';
import {
    DEFAULT_TEAM_CONVERSATION_ID,
    buildChatAudienceMetadata,
    extractAllPlaysQuestion,
    formatChatMessageHtml,
    getChatMemberDisplayName,
    getAudienceSummaryText,
    getMessagePreviewText,
    isChatComposerLinkSafe,
    normalizeChatReactions
} from '../../apps/app/src/lib/chatLogic.ts';

describe('React app chat logic', () => {
    it('formats chat text with safe links, markdown, and ALL PLAYS mentions', () => {
        const html = formatChatMessageHtml('**Update** @ALL PLAYS see https://allplays.ai/game.html <script>alert(1)</script>');

        expect(html).toContain('<strong>Update</strong>');
        expect(html).toContain('<span class="chat-mention">@ALL PLAYS</span>');
        expect(html).toContain('href="https://allplays.ai/game.html"');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('<script>');
    });

    it('accepts only explicit http links from the composer link action', () => {
        expect(isChatComposerLinkSafe('https://allplays.ai/game.html')).toBe(true);
        expect(isChatComposerLinkSafe('http://localhost:5174/#/messages')).toBe(true);
        expect(isChatComposerLinkSafe('www.allplays.ai')).toBe(false);
        expect(isChatComposerLinkSafe('javascript:alert(1)')).toBe(false);
        expect(isChatComposerLinkSafe('allplays.ai/game.html')).toBe(false);
    });

    it('builds audience metadata for team, staff, and selected recipients', () => {
        expect(buildChatAudienceMetadata({
            selectedConversation: null,
            selectedConversationId: DEFAULT_TEAM_CONVERSATION_ID,
            selectedRecipientTarget: 'full_team',
            selectedRecipientIds: []
        })).toEqual({
            targetType: 'full_team',
            recipientIds: [],
            targetRole: null
        });

        expect(buildChatAudienceMetadata({
            selectedConversation: null,
            selectedConversationId: DEFAULT_TEAM_CONVERSATION_ID,
            selectedRecipientTarget: 'staff',
            selectedRecipientIds: []
        })).toEqual({
            targetType: 'staff',
            recipientIds: [],
            targetRole: 'staff'
        });

        expect(buildChatAudienceMetadata({
            selectedConversation: null,
            selectedConversationId: DEFAULT_TEAM_CONVERSATION_ID,
            selectedRecipientTarget: 'individuals',
            selectedRecipientIds: ['user:two', 'player:one', 'player:one']
        })).toEqual({
            targetType: 'individuals',
            recipientIds: ['player:one', 'user:two'],
            targetRole: null
        });
    });

    it('summarizes selected audience recipients without making the composer noisy', () => {
        const summary = getAudienceSummaryText({
            targetType: 'individuals',
            recipientIds: ['user:1', 'user:2', 'user:3', 'user:4'],
            targetRole: null
        }, [
            { id: 'user:1', name: 'Dana', detail: 'Guardian for Pat' },
            { id: 'user:2', name: 'Morgan' },
            { id: 'user:3', name: 'Sam' },
            { id: 'user:4', name: 'Taylor' }
        ]);

        expect(summary).toBe('Dana (Guardian for Pat), Morgan, Sam +1 more');
    });

    it('prefers member names over email addresses and falls back to email when no name exists', () => {
        expect(getChatMemberDisplayName({
            name: 'parent@example.com',
            fullName: 'parent@example.com',
            profileFullName: 'Pat Parent',
            email: 'parent@example.com'
        })).toBe('Pat Parent');
        expect(getChatMemberDisplayName({
            email: 'parent@example.com'
        })).toBe('parent@example.com');
    });

    it('normalizes current and legacy reaction storage', () => {
        expect(normalizeChatReactions({
            reactions: {
                thumbs_up: ['user-1'],
                '👍': ['user-2', 'user-1'],
                heart: ['user-3']
            }
        })).toEqual({
            thumbs_up: ['user-1', 'user-2'],
            heart: ['user-3']
        });
    });

    it('extracts AI questions and previews deleted or media-only messages', () => {
        expect(extractAllPlaysQuestion('@ALL PLAYS who needs RSVP help?')).toBe('who needs RSVP help?');
        expect(getMessagePreviewText({ deleted: true })).toBe('Message removed');
        expect(getMessagePreviewText({ attachments: [{ type: 'video', url: 'https://example.test/video.mp4' }] })).toBe('Video');
    });
});
