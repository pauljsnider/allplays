import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const chatLogicSource = readFileSync(new URL('../../apps/app/src/lib/chatLogic.ts', import.meta.url), 'utf8');
const messagesSource = [
    readFileSync(new URL('../../apps/app/src/pages/Messages.tsx', import.meta.url), 'utf8'),
    readFileSync(new URL('../../apps/app/src/pages/messages/components/ChatWindow.tsx', import.meta.url), 'utf8'),
    readFileSync(new URL('../../apps/app/src/pages/messages/components/ChatComposer.tsx', import.meta.url), 'utf8')
].join('\n');
const chatLogicTestSource = readFileSync(new URL('./app-chat-logic.test.js', import.meta.url), 'utf8');
const messagesIntegrationTestSource = readFileSync(new URL('./app-chat-messages-integration.test.jsx', import.meta.url), 'utf8');

describe('issue 2592 chat mention autocomplete and highlight source contract', () => {
    it('keeps mention parsing, suggestions, insertion, and highlight formatting in chatLogic', () => {
        expect(chatLogicSource).toContain('const chatMentionQueryRegex =');
        expect(chatLogicSource).toContain('const chatMentionReplaceRegex =');
        expect(chatLogicSource).toContain('const chatMentionHighlightRegex =');
        expect(chatLogicSource).toContain('export function getChatMentionQuery(text: string, cursorPosition?: number)');
        expect(chatLogicSource).toContain('export function buildChatMentionSuggestions(');
        expect(chatLogicSource).toContain('export function insertChatMention(text: string, mentionLabel: string, cursorPosition?: number)');
        expect(chatLogicSource).toContain('export function formatChatMessageHtml(text: string)');
        expect(chatLogicSource).toContain('<span class="chat-mention">@${mentionLabel}</span>');
    });

    it('keeps Messages wired to mention suggestions and mention rendering', () => {
        expect(messagesSource).toContain('buildChatMentionSuggestions,');
        expect(messagesSource).toContain('formatChatMessageHtml,');
        expect(messagesSource).toContain('hasChatMentionTrigger,');
        expect(messagesSource).toContain('insertChatMention,');
        expect(messagesSource).toContain('const mentionSuggestions = useMemo(');
        expect(messagesSource).toContain('mentionSuggestions={mentionSuggestions}');
        expect(messagesSource).toContain('onRecipientMention={insertRecipientMention}');
        expect(messagesSource).toContain('const messageHtml = useMemo(() => formatChatMessageHtml(message.text || \'\'), [message.text]);');
        expect(messagesSource).toContain('showMentionSuggestions = mentionTriggerActive');
        expect(messagesSource).toContain('aria-label="Mention suggestions"');
    });

    it('keeps regression tests for teammate mentions and hostile input escaping', () => {
        expect(chatLogicTestSource).toContain('highlights teammate mentions while keeping hostile mention-like input escaped');
        expect(chatLogicTestSource).toContain('filters mention suggestions from recipient options and inserts the selected mention');
        expect(messagesIntegrationTestSource).toContain('suggests teammate mentions from recipient options and inserts the selected mention');
        expect(messagesIntegrationTestSource).toContain('keeps mention suggestions visible for multi-word full-name queries');
        expect(messagesIntegrationTestSource).toContain('does not keep teammate suggestions open after a completed mention or a bare at-sign');
        expect(messagesIntegrationTestSource).toContain('replaces the rest of an active mention token during keyboard selection');
    });
});
