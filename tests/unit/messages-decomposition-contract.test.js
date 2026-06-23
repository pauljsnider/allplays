import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath) {
    return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('Messages decomposition contract', () => {
    it('keeps chat state domains in extracted hooks', () => {
        const messages = readRepoFile('apps/app/src/pages/Messages.tsx');

        expect(messages).toContain("import { useChatSheets } from './messages/hooks/useChatSheets';");
        expect(messages).toContain("import { useChatTeam } from './messages/hooks/useChatTeam';");
        expect(messages).toContain("import { useChatMessages } from './messages/hooks/useChatMessages';");
        expect(messages).toContain('} = useChatSheets();');
        expect(messages).toContain('} = useChatTeam({');
        expect(messages).toContain('} = useChatMessages({');

        const useStateCount = (messages.match(/\buseState(?:<|\()/g) || []).length;
        expect(useStateCount).toBeLessThan(40);
    });

    it('keeps email composer transitions in the reducer instead of separate page state', () => {
        const messages = readRepoFile('apps/app/src/pages/Messages.tsx');
        const reducer = readRepoFile('apps/app/src/pages/messages/state/emailReducer.ts');

        expect(messages).toContain("from './messages/state/emailReducer';");
        expect(messages).toContain('emailComposerActions');
        expect(messages).toContain('emailReducer');
        expect(messages).toContain('initialEmailComposerState');
        expect(messages).toMatch(/const\s+\[emailState,\s*emailDispatch\]\s*=\s*useReducer\(emailReducer,\s*initialEmailComposerState\);/);
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
