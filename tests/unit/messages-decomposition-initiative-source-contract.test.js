import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const messagesSource = readSource('apps/app/src/pages/Messages.tsx');
const chatMessagesHookSource = readSource('apps/app/src/pages/messages/hooks/useChatMessages.ts');
const chatTeamHookSource = readSource('apps/app/src/pages/messages/hooks/useChatTeam.ts');
const chatSheetsHookSource = readSource('apps/app/src/pages/messages/hooks/useChatSheets.ts');
const emailReducerSource = readSource('apps/app/src/pages/messages/state/emailReducer.ts');
const chatMessagesHookTestSource = readSource('apps/app/src/pages/messages/hooks/__tests__/useChatMessages.test.tsx');
const chatTeamHookTestSource = readSource('apps/app/src/pages/messages/hooks/__tests__/useChatTeam.test.tsx');
const chatSheetsHookTestSource = readSource('apps/app/src/pages/messages/hooks/useChatSheets.test.tsx');
const emailReducerTestSource = readSource('apps/app/src/pages/messages/state/__tests__/emailReducer.test.ts');

describe('Messages decomposition initiative source contract', () => {
    it('keeps live message subscription and pagination state in useChatMessages', () => {
        expect(messagesSource).toContain("import { useChatMessages } from './messages/hooks/useChatMessages';");
        expect(messagesSource).toContain('} = useChatMessages({');
        expect(messagesSource).not.toMatch(/const\s+\[liveMessages\b/);
        expect(messagesSource).not.toMatch(/const\s+\[olderMessages\b/);
        expect(messagesSource).not.toMatch(/subscribeToTeamChatMessages\(/);

        expect(chatMessagesHookSource).toContain('subscribeToTeamChatMessages(');
        expect(chatMessagesHookSource).toContain('loadOlderTeamChatMessages(teamId, conversationId, cursor)');
        expect(chatMessagesHookSource).toContain('initialSnapshotLoadedRef.current = false;');
        expect(chatMessagesHookSource).toContain('onLiveUpdateState?.({ isInitialSnapshot, wasNearBottom });');
        expect(chatMessagesHookSource).toContain('subscription.unsubscribe();');
        expect(chatMessagesHookTestSource).toContain("describe('useChatMessages'");
    });

    it('keeps team context, conversation switching, and preferred conversation selection in useChatTeam', () => {
        expect(messagesSource).toContain("import { useChatTeam } from './messages/hooks/useChatTeam';");
        expect(messagesSource).toContain('} = useChatTeam({');
        expect(messagesSource).not.toMatch(/const\s+\[conversations\b/);
        expect(messagesSource).not.toMatch(/const\s+\[selectedConversationId\b/);

        expect(chatTeamHookSource).toContain('loadChatTeamContext(teamId, user)');
        expect(chatTeamHookSource).toContain('loadChatConversations(teamId, user, context.team, context.canModerate)');
        expect(chatTeamHookSource).toContain('let cancelled = false;');
        expect(chatTeamHookSource).toContain('return DEFAULT_TEAM_CONVERSATION_ID;');
        expect(chatTeamHookSource).toContain('const switchConversation = useCallback((conversationId: string) => {');
        expect(chatTeamHookTestSource).toContain("describe('useChatTeam'");
    });

    it('keeps transient mobile sheet state in useChatSheets', () => {
        expect(messagesSource).toContain("import { useChatSheets } from './messages/hooks/useChatSheets';");
        expect(messagesSource).toContain('} = useChatSheets();');
        expect(messagesSource).not.toMatch(/const\s+\[showConversationSheet\b/);
        expect(messagesSource).not.toMatch(/const\s+\[showEmailSheet\b/);

        [
            'showConversationSheet',
            'showAudienceSheet',
            'showMediaGallery',
            'showAttachSheet',
            'showLinkSheet',
            'showEmailSheet'
        ].forEach((flag) => {
            expect(chatSheetsHookSource).toContain(flag);
        });
        expect(chatSheetsHookSource).toContain('showAttachSheet: false,');
        expect(chatSheetsHookSource).toContain('showLinkSheet: true');
        expect(chatSheetsHookTestSource).toContain("describe('useChatSheets'");
    });

    it('keeps team email composer transitions in the reducer with dedicated reducer tests', () => {
        expect(messagesSource).toContain("from './messages/state/emailReducer';");
        expect(messagesSource).toContain('emailComposerActions');
        expect(messagesSource).toContain('emailReducer');
        expect(messagesSource).toContain('initialEmailComposerState');
        expect(messagesSource).toMatch(/useReducer\(emailReducer,\s*initialEmailComposerState\)/);
        expect(messagesSource).not.toMatch(/const\s+\[emailSubject\b/);
        expect(messagesSource).not.toMatch(/const\s+\[emailBody\b/);
        expect(messagesSource).not.toMatch(/const\s+\[selectedEmailDraftId\b/);

        [
            "{ type: 'setDrafts'; drafts: TeamEmailDraft[] }",
            "{ type: 'selectDraft'; draftId: string }",
            "{ type: 'applyTemplate'; templateId: string }",
            "{ type: 'saveDraft'; draft: TeamEmailDraft }",
            "{ type: 'clearComposer' }"
        ].forEach((action) => {
            expect(emailReducerSource).toContain(action);
        });
        expect(emailReducerSource).toContain('function clearDraftComposer(state: EmailComposerState, drafts = state.drafts): EmailComposerState');
        expect(emailReducerSource).toContain('export const emailComposerActions = {');
        expect(emailReducerTestSource).toContain("describe('emailReducer'");
    });

    it('keeps the Messages page state budget below the decomposition ceiling', () => {
        const useStateCount = (messagesSource.match(/\buseState(?:<|\()/g) || []).length;

        expect(useStateCount).toBeLessThan(39);
        expect(messagesSource).toContain('const visibleMessages = useMemo(');
        expect(messagesSource).toContain('const emailAudienceMetadata = useMemo(() => buildEmailAudienceMetadata({');
        expect(messagesSource).toContain('const mediaEntries = useMemo(() => collectThreadMedia(visibleMessages), [visibleMessages]);');
    });
});
