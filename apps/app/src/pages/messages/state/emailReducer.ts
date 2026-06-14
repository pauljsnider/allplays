import type { TeamEmailDraft, TeamEmailTemplate } from '../../../lib/chatService';

export type EmailComposerState = {
  subject: string;
  body: string;
  templateName: string;
  drafts: TeamEmailDraft[];
  selectedDraftId: string;
  templates: TeamEmailTemplate[];
};

export type EmailComposerAction =
  | { type: 'setDrafts'; drafts: TeamEmailDraft[] }
  | { type: 'selectDraft'; draftId: string }
  | { type: 'updateSubject'; subject: string }
  | { type: 'updateBody'; body: string }
  | { type: 'updateTemplateName'; templateName: string }
  | { type: 'setTemplates'; templates: TeamEmailTemplate[] }
  | { type: 'applyTemplate'; templateId: string }
  | { type: 'saveDraft'; draft: TeamEmailDraft }
  | { type: 'deleteDraft'; draftId: string }
  | { type: 'clearSelectedDraft' }
  | { type: 'clearComposer' };

export const initialEmailComposerState: EmailComposerState = {
  subject: '',
  body: '',
  templateName: '',
  drafts: [],
  selectedDraftId: '',
  templates: []
};

function applyDraftSelection(state: EmailComposerState, draft: TeamEmailDraft): EmailComposerState {
  return {
    ...state,
    selectedDraftId: draft.id,
    subject: draft.subject || '',
    body: draft.body || ''
  };
}

function clearDraftComposer(state: EmailComposerState, drafts = state.drafts): EmailComposerState {
  return {
    ...state,
    drafts,
    selectedDraftId: '',
    subject: '',
    body: ''
  };
}

export function emailReducer(state: EmailComposerState, action: EmailComposerAction): EmailComposerState {
  switch (action.type) {
    case 'setDrafts': {
      const drafts = Array.isArray(action.drafts) ? action.drafts : [];
      if (!state.selectedDraftId) {
        return { ...state, drafts };
      }
      const selectedDraft = drafts.find((draft) => draft.id === state.selectedDraftId);
      if (!selectedDraft) {
        return clearDraftComposer(state, drafts);
      }
      return applyDraftSelection({ ...state, drafts }, selectedDraft);
    }
    case 'selectDraft': {
      const draft = state.drafts.find((item) => item.id === action.draftId);
      return draft ? applyDraftSelection(state, draft) : state;
    }
    case 'updateSubject':
      return { ...state, subject: action.subject };
    case 'updateBody':
      return { ...state, body: action.body };
    case 'updateTemplateName':
      return { ...state, templateName: action.templateName };
    case 'setTemplates':
      return { ...state, templates: Array.isArray(action.templates) ? action.templates : [] };
    case 'applyTemplate': {
      const template = state.templates.find((item) => item.id === action.templateId);
      if (!template) return state;
      return {
        ...state,
        subject: template.subject || '',
        body: template.body || ''
      };
    }
    case 'saveDraft':
      return {
        ...state,
        selectedDraftId: action.draft.id,
        subject: action.draft.subject || '',
        body: action.draft.body || '',
        drafts: [action.draft, ...state.drafts.filter((item) => item.id !== action.draft.id)]
      };
    case 'deleteDraft': {
      const drafts = state.drafts.filter((draft) => draft.id !== action.draftId);
      if (state.selectedDraftId === action.draftId) {
        return clearDraftComposer(state, drafts);
      }
      return { ...state, drafts };
    }
    case 'clearSelectedDraft':
      return { ...state, selectedDraftId: '' };
    case 'clearComposer':
      return clearDraftComposer(state);
    default:
      return state;
  }
}
