// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../../../lib/types';
import TeamEmailSheet from './TeamEmailSheet';

const chatServiceMocks = vi.hoisted(() => ({
  loadSentTeamEmails: vi.fn(),
  loadTeamEmailDrafts: vi.fn(),
  loadTeamEmailTemplates: vi.fn(),
  saveTeamEmailDraft: vi.fn(),
  saveTeamEmailTemplate: vi.fn(),
  sendTeamEmailMessage: vi.fn()
}));

vi.mock('../../../lib/chatService', () => chatServiceMocks);

vi.mock('./ChatWindow', () => ({
  Sheet: ({ title, children }: { title: string; children: ReactNode }) => <div role="dialog" aria-label={title}>{children}</div>,
  StatusBanner: ({ status }: { status: { message: string } }) => <div role="status">{status.message}</div>
}));

vi.mock('lucide-react', () => {
  const Icon = () => null;
  return { Loader2: Icon, Mail: Icon, RefreshCw: Icon };
});

const auth: AuthState = {
  user: {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach One',
    roles: ['coach']
  },
  profile: null,
  loading: false,
  error: null,
  roles: ['coach'],
  isParent: false,
  isCoach: true,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

function renderTeamEmailSheet(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    auth,
    teamId: 'team-1',
    profile: {},
    selectedConversation: null,
    selectedConversationId: 'team',
    selectedRecipientTarget: 'full_team' as const,
    selectedRecipientIds: [] as string[],
    recipientOptions: [{ id: 'user:parent-1', name: 'Parent One', email: 'parent@example.com' }],
    recipientOptionsLoading: false,
    recipientOptionsError: null,
    ensureRecipientOptionsLoaded: vi.fn().mockResolvedValue([]),
    setSelectedRecipientTarget: vi.fn(),
    setSelectedRecipientIds: vi.fn(),
    switchConversation: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };

  return { ...render(<TeamEmailSheet {...props} />), props };
}

function expectBefore(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
}

describe('TeamEmailSheet compose-first workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatServiceMocks.loadTeamEmailDrafts.mockResolvedValue([{
      id: 'draft-1',
      subject: 'Practice reminder',
      body: 'Bring shoes and water.',
      recipientIds: ['user:parent-1'],
      recipients: []
    }]);
    chatServiceMocks.loadTeamEmailTemplates.mockResolvedValue([{
      id: 'template-1',
      name: 'Weekly update',
      subject: 'Week ahead',
      body: 'Here is the plan.'
    }]);
    chatServiceMocks.loadSentTeamEmails.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('renders compose and send before drafts/templates while preserving content restore actions', async () => {
    const { props } = renderTeamEmailSheet();

    const draftButton = await screen.findByRole('button', { name: /Practice reminder/ });
    const subject = screen.getByLabelText('Subject');
    const message = screen.getByLabelText('Message');
    const send = screen.getByRole('button', { name: 'Send email' });
    const savedDrafts = screen.getByText('Saved drafts');
    const reusableTemplates = screen.getByText('Reusable templates');

    expectBefore(subject, message);
    expectBefore(message, send);
    expectBefore(send, savedDrafts);
    expectBefore(savedDrafts, reusableTemplates);

    fireEvent.click(draftButton);
    expect(subject).toHaveValue('Practice reminder');
    expect(message).toHaveValue('Bring shoes and water.');
    expect(props.setSelectedRecipientTarget).toHaveBeenCalledWith('individuals');
    expect(props.setSelectedRecipientIds).toHaveBeenCalledWith(['user:parent-1']);

    fireEvent.change(screen.getByLabelText('Saved template'), { target: { value: 'template-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply template' }));
    expect(subject).toHaveValue('Week ahead');
    expect(message).toHaveValue('Here is the plan.');
  });

  it('keeps recipient errors and selected-member validation before disabled save/send actions', async () => {
    renderTeamEmailSheet({
      selectedRecipientTarget: 'individuals',
      selectedRecipientIds: [],
      recipientOptionsError: 'Could not load team recipients.'
    });

    await screen.findByText('Saved drafts');
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Rainout' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Practice is canceled.' } });

    const recipientError = screen.getByText('Could not load team recipients.');
    const selectedMemberValidation = screen.getByText('Choose at least one selected member before saving or sending email.');
    const send = screen.getByRole('button', { name: 'Send email' });
    expectBefore(recipientError, send);
    expectBefore(selectedMemberValidation, send);
    expect(send).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    fireEvent.submit(send.closest('form') as HTMLFormElement);
    expect(chatServiceMocks.sendTeamEmailMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Choose at least one selected member before sending.');
  });
});
