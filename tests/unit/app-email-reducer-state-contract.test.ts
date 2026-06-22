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

describe('email reducer state synchronization', () => {
    it('preserves unsaved composer edits when refreshed drafts update the selected draft', () => {
        const selected = emailReducer(
            emailReducer(initialEmailComposerState, { type: 'setDrafts', drafts: [draft()] }),
            { type: 'selectDraft', draftId: 'draft-1' }
        );
        const edited = emailReducer(selected, { type: 'updateBody', body: 'Bring shoes, water, and a ball.' });

        const refreshed = emailReducer(edited, {
            type: 'setDrafts',
            drafts: [draft({ subject: 'Server subject', body: 'Server body' })]
        });

        expect(refreshed).toMatchObject({
            selectedDraftId: 'draft-1',
            subject: 'Practice reminder',
            body: 'Bring shoes, water, and a ball.'
        });
    });

    it('syncs untouched selected draft content when refreshed draft data changes', () => {
        const selected = emailReducer(
            emailReducer(initialEmailComposerState, { type: 'setDrafts', drafts: [draft()] }),
            { type: 'selectDraft', draftId: 'draft-1' }
        );

        const refreshed = emailReducer(selected, {
            type: 'setDrafts',
            drafts: [draft({ subject: 'Updated subject', body: 'Updated body' })]
        });

        expect(refreshed).toMatchObject({
            selectedDraftId: 'draft-1',
            subject: 'Updated subject',
            body: 'Updated body'
        });
    });

    it('clears only the selected draft marker when composing from an existing draft', () => {
        const selected = emailReducer(
            emailReducer(initialEmailComposerState, { type: 'setDrafts', drafts: [draft()] }),
            { type: 'selectDraft', draftId: 'draft-1' }
        );

        expect(emailReducer(selected, { type: 'clearSelectedDraft' })).toMatchObject({
            selectedDraftId: '',
            subject: 'Practice reminder',
            body: 'Bring shoes and water.',
            drafts: [draft()]
        });
    });
});
