import { describe, expect, it } from 'vitest';
import { emailReducer, initialEmailComposerState } from '../../apps/app/src/pages/messages/state/emailReducer.ts';
import type { TeamEmailDraft } from '../../apps/app/src/lib/chatService.ts';

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

    it('clears the composer only when the selected draft is deleted', () => {
        const state = emailReducer(
            emailReducer(initialEmailComposerState, {
                type: 'setDrafts',
                drafts: [
                    draft(),
                    draft({ id: 'draft-2', subject: 'Snacks', body: 'Please bring fruit.' })
                ]
            }),
            { type: 'selectDraft', draftId: 'draft-1' }
        );

        expect(emailReducer(state, { type: 'deleteDraft', draftId: 'draft-2' })).toMatchObject({
            selectedDraftId: 'draft-1',
            subject: 'Practice reminder',
            body: 'Bring shoes and water.',
            drafts: [draft()]
        });

        expect(emailReducer(state, { type: 'deleteDraft', draftId: 'draft-1' })).toMatchObject({
            selectedDraftId: '',
            subject: '',
            body: '',
            drafts: [draft({ id: 'draft-2', subject: 'Snacks', body: 'Please bring fruit.' })]
        });
    });
});
