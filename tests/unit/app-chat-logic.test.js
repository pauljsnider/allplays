import { describe, expect, it } from 'vitest';
import {
    __chatHtmlTestUtils,
    DEFAULT_TEAM_CONVERSATION_ID,
    buildChatAudienceMetadata,
    buildEmailAudienceMetadata,
    extractAllPlaysQuestion,
    formatChatMessageHtml,
    getChatMemberDisplayName,
    getAudienceSummaryText,
    getMessageSenderLabel,
    getReactionNames,
    getMessagePreviewText,
    getSortedChatMessages,
    isChatComposerLinkSafe,
    mergeChatMessageLists,
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

    it('sanitizes formatted chat html as a backstop against hostile input', () => {
        const html = formatChatMessageHtml([
            '<img src=x onerror=alert(1)>',
            '<a href="javascript:alert(1)">bad</a>',
            'https://safe.example.test/path?x=&quot; onclick=&quot;alert(1)',
            '`<svg onload=alert(1)>`',
            '@ALL PLAYS'
        ].join(' '));

        expect(html).not.toContain('<img');
        expect(html).not.toContain('<svg');
        expect(html).not.toMatch(/<[^>]+\sonerror=/i);
        expect(html).not.toMatch(/<[^>]+\sonclick=/i);
        expect(html).not.toContain('href="javascript:');
        expect(html).toContain('<code>&lt;svg onload=alert(1)&gt;</code>');
        expect(html).toContain('<span class="chat-mention">@ALL PLAYS</span>');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it('strips malformed or unsafe anchors in the fallback chat sanitizer', () => {
        expect(__chatHtmlTestUtils.sanitizeFormattedChatHtmlFallback('<a href="javascript:alert(1)">bad</a>')).toBe('bad');
        expect(__chatHtmlTestUtils.sanitizeFormattedChatHtmlFallback('<a href="https://safe.example.test" onload="alert(1)">safe</a>')).toBe('safe');
        expect(__chatHtmlTestUtils.sanitizeFormattedChatHtmlFallback('<a href="https://safe.example.test">safe</a>')).toBe('<a href="https://safe.example.test" target="_blank" rel="noopener noreferrer">safe</a>');
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

    it('maps email audience metadata from conversations and selected members', () => {
        const recipientOptions = [
            { id: 'user:coach-1', name: 'Coach Jamie' },
            { id: 'email:parent@example.com', name: 'Pat Parent' }
        ];

        expect(buildEmailAudienceMetadata({
            selectedConversation: { id: 'staff', participantRoles: ['staff'], participantIds: ['coach-1'] },
            selectedConversationId: 'staff',
            selectedRecipientTarget: 'full_team',
            selectedRecipientIds: [],
            recipientOptions
        })).toEqual({
            targetType: 'staff',
            recipientIds: [],
            targetRole: 'staff'
        });

        expect(buildEmailAudienceMetadata({
            selectedConversation: { id: 'direct', participantIds: ['coach-1', 'email:parent@example.com', 'missing-user'] },
            selectedConversationId: 'direct',
            selectedRecipientTarget: 'full_team',
            selectedRecipientIds: [],
            recipientOptions
        })).toEqual({
            targetType: 'individuals',
            recipientIds: ['user:coach-1', 'email:parent@example.com'],
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

    it('sorts and merges live and older message windows without duplicates', () => {
        const old = { id: 'old', text: 'Earlier', createdAt: new Date('2026-05-20T12:00:00Z') };
        const duplicateLive = { id: 'same', text: 'Live wins', createdAt: new Date('2026-05-21T12:02:00Z') };
        const duplicateOld = { id: 'same', text: 'Older copy', createdAt: new Date('2026-05-21T12:01:00Z') };
        const newest = { id: 'new', text: 'Latest', createdAt: { seconds: 1779365100 } };

        expect(getSortedChatMessages([newest, old, duplicateLive]).map((message) => message.id)).toEqual(['old', 'same', 'new']);
        expect(mergeChatMessageLists([old, duplicateOld], [duplicateLive, newest, { text: 'missing id' }])).toEqual([
            old,
            duplicateLive,
            newest
        ]);
    });

    it('summarizes reaction names and sender labels for parent-readable chat bubbles', () => {
        expect(getReactionNames(['user-1', 'coach-1', 'parent-2', 'admin-3', 'helper-4'], 'user-1', {
            'coach-1': 'Coach Jamie'
        })).toBe('You, Coach Jamie, User parent, User admin- +1 more');

        expect(getMessageSenderLabel({ senderId: 'user-1', senderName: 'Pat Parent' }, 'user-1')).toBe('You');
        expect(getMessageSenderLabel({ ai: true, aiName: 'ALL PLAYS Assistant' }, 'user-1')).toBe('ALL PLAYS Assistant');
        expect(getMessageSenderLabel({ senderEmail: 'coach@example.com' }, 'user-1')).toBe('coach@example.com');
    });

    it('extracts AI questions and previews deleted or media-only messages', () => {
        expect(extractAllPlaysQuestion('@ALL PLAYS who needs RSVP help?')).toBe('who needs RSVP help?');
        expect(getMessagePreviewText({ deleted: true })).toBe('Message removed');
        expect(getMessagePreviewText({ attachments: [{ type: 'video', url: 'https://example.test/video.mp4' }] })).toBe('Video');
    });
});
