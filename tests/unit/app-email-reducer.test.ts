import { describe, expect, it } from 'vitest';
import { emailReducer, initialEmailComposerState } from '../../apps/app/src/pages/messages/state/emailReducer.ts';
import type { TeamEmailDraft, TeamEmailTemplate } from '../../apps/app/src/lib/chatService.ts';

function draft(overrides: Partial<TeamEmailDraft> = {}): TeamEmailDraft {
    return {
        id: 'draft-1',
        subject: 'Practice reminder',
        body: 'Bring shoes and water.',
        recipientIds: ['player-1'],
        recipients: [],
        ...overrides
    };
}

function template(overrides: Partial<TeamEmailTemplate> = {}): TeamEmailTemplate {
    return {
        id: 'template-1',
        name: 'Game day',
        subject: 'Game tomorrow',
        body: 'Bring both uniforms.',
        ...overrides
    };
}

describe('emailReducer', () => {
    it('clears stale composer content when refreshed drafts no longer include the selected draft', () => {
        const selected = emailReducer(
            emailReducer(initialEmailComposerState, { type: 'setDrafts', drafts: [draft()] }),
            { type: 'selectDraft', draftId: 'draft-1' }
        );

        expect(emailReducer(selected, { type: 'setDrafts', drafts: [] })).toMatchObject({
            drafts: [],
            selectedDraftId: '',
            subject: '',
            body: ''
        });
    });

    it('applies email templates through the reducer without clearing the selected draft', () => {
        const selected = emailReducer(
            emailReducer(
                emailReducer(initialEmailComposerState, { type: 'setDrafts', drafts: [draft()] }),
                { type: 'setTemplates', templates: [template()] }
            ),
            { type: 'selectDraft', draftId: 'draft-1' }
        );

        expect(emailReducer(selected, { type: 'applyTemplate', templateId: 'template-1' })).toMatchObject({
            selectedDraftId: 'draft-1',
            subject: 'Game tomorrow',
            body: 'Bring both uniforms.',
            templates: [template()]
        });
    });
});
