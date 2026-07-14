import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTeamChat() {
    return readFileSync(new URL('../../team-chat.html', import.meta.url), 'utf8');
}

function buildUrlHelper(functionName, { hash = '', search = '' } = {}) {
    const source = readTeamChat();
    const match = source.match(new RegExp(`function ${functionName}\\(\\) \\{([\\s\\S]*?)\\n        \\}`));
    expect(match, `${functionName} should exist`).toBeTruthy();

    const createHelper = new Function('deps', `
        const { window, URLSearchParams } = deps;
        return function() {
${match[1]}
        };
    `);

    return createHelper({
        window: { location: { hash, search } },
        URLSearchParams
    });
}

describe('team chat URL routing', () => {
    it('reads teamId from the existing hash route format', () => {
        const getTeamIdFromUrl = buildUrlHelper('getTeamIdFromUrl', { hash: '#teamId=team-123' });

        expect(getTeamIdFromUrl()).toBe('team-123');
    });

    it('reads teamId from notification query-string links', () => {
        const getTeamIdFromUrl = buildUrlHelper('getTeamIdFromUrl', { search: '?teamId=team-456' });

        expect(getTeamIdFromUrl()).toBe('team-456');
    });

    it('reads and decodes conversationId from notification query-string links', () => {
        const getConversationIdFromUrl = buildUrlHelper('getConversationIdFromUrl', {
            search: '?teamId=team-456&conversationId=direct_user%3Acoach-1__user%3Aparent-1'
        });

        expect(getConversationIdFromUrl()).toBe('direct_user:coach-1__user:parent-1');
    });

    it('supports the conversation alias in hash routes', () => {
        const getConversationIdFromUrl = buildUrlHelper('getConversationIdFromUrl', {
            hash: '#teamId=team-123&conversation=staff-conversation'
        });

        expect(getConversationIdFromUrl()).toBe('staff-conversation');
    });

    it('selects and includes the deep-linked conversation before realtime starts', () => {
        const source = readTeamChat();
        const initialization = source.slice(source.indexOf('// Initialize'), source.indexOf('async function loadMessages'));
        const loadConversations = source.slice(source.indexOf('async function loadConversations()'), source.indexOf('function getSelectedConversation()'));

        expect(initialization).toContain('selectedConversationId = getConversationIdFromUrl() || DEFAULT_TEAM_CONVERSATION_ID;');
        expect(initialization.indexOf('selectedConversationId = getConversationIdFromUrl()'))
            .toBeLessThan(initialization.indexOf('await loadConversations();'));
        expect(initialization.indexOf('await loadConversations();'))
            .toBeLessThan(initialization.indexOf('startRealtimeUpdates();'));
        expect(loadConversations).toContain('activeConversationId: selectedConversationId');
    });
});
