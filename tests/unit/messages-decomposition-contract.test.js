import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath) {
    return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('Messages decomposition contract', () => {
    it('keeps chat state domains in extracted hooks', () => {
        const messages = readRepoFile('apps/app/src/pages/Messages.tsx');
        const chatWindow = readRepoFile('apps/app/src/pages/messages/components/ChatWindow.tsx');

        expect(messages).toContain("import { ChatWindow, TeamAvatar } from './messages/components/ChatWindow';");
        expect(chatWindow).toContain("import { useChatSheets } from '../hooks/useChatSheets';");
        expect(chatWindow).toContain("import { useChatTeam } from '../hooks/useChatTeam';");
        expect(chatWindow).toContain("import { getChatMessagesErrorMessage, useChatMessages } from '../hooks/useChatMessages';");
        expect(chatWindow).toContain('} = useChatSheets();');
        expect(chatWindow).toContain('} = useChatTeam({');
        expect(chatWindow).toContain('} = useChatMessages({');

        const useStateCount = (messages.match(/\buseState(?:<|\()/g) || []).length;
        expect(useStateCount).toBeLessThan(10);
        expect(messages.split('\n').length).toBeLessThan(1600);
    });

    it('keeps email composer transitions in the reducer instead of separate page state', () => {
        const messages = readRepoFile('apps/app/src/pages/Messages.tsx');
        const chatWindow = readRepoFile('apps/app/src/pages/messages/components/ChatWindow.tsx');
        const teamEmailSheet = readRepoFile('apps/app/src/pages/messages/components/TeamEmailSheet.tsx');
        const reducer = readRepoFile('apps/app/src/pages/messages/state/emailReducer.ts');

        expect(chatWindow).toContain("const LazyTeamEmailSheet = lazy(() => import('./TeamEmailSheet'));");
        expect(chatWindow).not.toContain("from '../state/emailReducer';");
        expect(teamEmailSheet).toContain("from '../state/emailReducer';");
        expect(teamEmailSheet).toContain('emailComposerActions');
        expect(teamEmailSheet).toContain('emailReducer');
        expect(teamEmailSheet).toContain('initialEmailComposerState');
        expect(teamEmailSheet).toMatch(/const\s+\[emailState,\s*emailDispatch\]\s*=\s*useReducer\(emailReducer,\s*initialEmailComposerState\);/);
        expect(messages).not.toMatch(/const\s+\[emailSubject\b/);
        expect(messages).not.toMatch(/const\s+\[emailBody\b/);
        expect(messages).not.toMatch(/const\s+\[emailDrafts\b/);
        expect(messages).not.toMatch(/const\s+\[selectedEmailDraftId\b/);

        [
            "type: 'setDrafts'",
            "type: 'selectDraft'",
            "type: 'saveDraft'",
            "type: 'deleteDraft'",
            "type: 'clearComposer'"
        ].forEach((action) => {
            expect(reducer).toContain(action);
        });
    });
});
