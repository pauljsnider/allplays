import { describe, expect, it } from 'vitest';
import { emailReducer, initialEmailComposerState } from '../emailReducer';
import type { TeamEmailDraft, TeamEmailTemplate } from '../../../../lib/chatService';

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
    name: 'Weekly update',
    subject: 'Week ahead',
    body: 'Here is the plan.',
    ...overrides
  };
}

describe('emailReducer', () => {
  it('starts with empty composer fields and applies direct subject and body edits', () => {
    expect(initialEmailComposerState).toMatchObject({
      drafts: [],
      templates: [],
      selectedDraftId: '',
      subject: '',
      body: '',
      templateName: ''
    });

    const editedSubject = emailReducer(initialEmailComposerState, {
      type: 'updateSubject',
      subject: 'Saturday schedule'
    });
    const editedBody = emailReducer(editedSubject, {
      type: 'updateBody',
      body: 'Arrive 30 minutes early.'
    });

    expect(editedBody).toMatchObject({
      drafts: [],
      templates: [],
      selectedDraftId: '',
      subject: 'Saturday schedule',
      body: 'Arrive 30 minutes early.'
    });
  });

  it('selects a draft and updates selection, subject, and body together', () => {
    const state = emailReducer(initialEmailComposerState, {
      type: 'setDrafts',
      drafts: [draft({ id: 'draft-1', subject: 'Old', body: 'Old body' }), draft({ id: 'draft-2', subject: 'New', body: 'New body' })]
    });

    expect(emailReducer(state, { type: 'selectDraft', draftId: 'draft-2' })).toMatchObject({
      selectedDraftId: 'draft-2',
      subject: 'New',
      body: 'New body'
    });
  });

  it('preserves edited subject and body while switching between drafts', () => {
    const withDrafts = emailReducer(initialEmailComposerState, {
      type: 'setDrafts',
      drafts: [draft({ id: 'draft-1', subject: 'Alpha', body: 'Alpha body' }), draft({ id: 'draft-2', subject: 'Beta', body: 'Beta body' })]
    });
    const edited = emailReducer(
      emailReducer(
        emailReducer(withDrafts, { type: 'selectDraft', draftId: 'draft-1' }),
        { type: 'updateSubject', subject: 'Alpha edited' }
      ),
      { type: 'updateBody', body: 'Alpha edited body' }
    );
    const saved = emailReducer(edited, {
      type: 'saveDraft',
      draft: draft({ id: 'draft-1', subject: 'Alpha edited', body: 'Alpha edited body' })
    });
    const switched = emailReducer(saved, { type: 'selectDraft', draftId: 'draft-2' });

    expect(switched).toMatchObject({ selectedDraftId: 'draft-2', subject: 'Beta', body: 'Beta body' });
    expect(emailReducer(switched, { type: 'selectDraft', draftId: 'draft-1' })).toMatchObject({
      selectedDraftId: 'draft-1',
      subject: 'Alpha edited',
      body: 'Alpha edited body'
    });
  });

  it('clears the selected draft and composer fields when the selected draft is deleted', () => {
    const selected = emailReducer(
      emailReducer(initialEmailComposerState, { type: 'setDrafts', drafts: [draft()] }),
      { type: 'selectDraft', draftId: 'draft-1' }
    );

    expect(emailReducer(selected, { type: 'deleteDraft', draftId: 'draft-1' })).toMatchObject({
      drafts: [],
      selectedDraftId: '',
      subject: '',
      body: ''
    });
  });

  it('removes an unselected draft without disturbing the selected draft composer', () => {
    const selected = emailReducer(
      emailReducer(initialEmailComposerState, {
        type: 'setDrafts',
        drafts: [
          draft({ id: 'draft-1', subject: 'Selected subject', body: 'Selected body' }),
          draft({ id: 'draft-2', subject: 'Other subject', body: 'Other body' })
        ]
      }),
      { type: 'selectDraft', draftId: 'draft-1' }
    );

    expect(emailReducer(selected, { type: 'deleteDraft', draftId: 'draft-2' })).toMatchObject({
      drafts: [draft({ id: 'draft-1', subject: 'Selected subject', body: 'Selected body' })],
      selectedDraftId: 'draft-1',
      subject: 'Selected subject',
      body: 'Selected body'
    });
  });

  it('preserves unsaved draft edits when refreshed drafts still include the selected draft', () => {
    const selected = emailReducer(
      emailReducer(initialEmailComposerState, { type: 'setDrafts', drafts: [draft()] }),
      { type: 'selectDraft', draftId: 'draft-1' }
    );
    const edited = emailReducer(
      emailReducer(selected, { type: 'updateSubject', subject: 'Edited subject' }),
      { type: 'updateBody', body: 'Edited body' }
    );

    expect(emailReducer(edited, {
      type: 'setDrafts',
      drafts: [draft({ subject: 'Server subject', body: 'Server body' })]
    })).toMatchObject({
      drafts: [draft({ subject: 'Server subject', body: 'Server body' })],
      selectedDraftId: 'draft-1',
      subject: 'Edited subject',
      body: 'Edited body'
    });
  });

  it('refreshes selected draft content when there are no unsaved edits', () => {
    const selected = emailReducer(
      emailReducer(initialEmailComposerState, { type: 'setDrafts', drafts: [draft()] }),
      { type: 'selectDraft', draftId: 'draft-1' }
    );

    expect(emailReducer(selected, {
      type: 'setDrafts',
      drafts: [draft({ subject: 'Server subject', body: 'Server body' })]
    })).toMatchObject({
      selectedDraftId: 'draft-1',
      subject: 'Server subject',
      body: 'Server body'
    });
  });

  it('applies templates and clears the composer through reducer actions', () => {
    const withTemplate = emailReducer(initialEmailComposerState, { type: 'setTemplates', templates: [template()] });
    const applied = emailReducer(withTemplate, { type: 'applyTemplate', templateId: 'template-1' });

    expect(applied).toMatchObject({ subject: 'Week ahead', body: 'Here is the plan.' });
    expect(emailReducer(applied, { type: 'clearComposer' })).toMatchObject({
      selectedDraftId: '',
      subject: '',
      body: ''
    });
  });

  it('keeps composer state unchanged when applying an unknown template id', () => {
    const withTemplate = emailReducer(initialEmailComposerState, {
      type: 'setTemplates',
      templates: [template()]
    });
    const edited = emailReducer(
      emailReducer(withTemplate, { type: 'updateSubject', subject: 'Manual subject' }),
      { type: 'updateBody', body: 'Manual body' }
    );

    expect(emailReducer(edited, { type: 'applyTemplate', templateId: 'missing-template' })).toEqual(edited);
  });
});
