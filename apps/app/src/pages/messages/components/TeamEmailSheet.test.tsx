// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../../../lib/types';
import TeamEmailSheet from './TeamEmailSheet';

const chatServiceMocks = vi.hoisted(() => ({
  loadSentTeamEmails: vi.fn(),
  loadTeamEmailDrafts: vi.fn(),
  loadTeamEmailTemplates: vi.fn(),
  mergeTeamEmailSavedItems: vi.fn((current: Array<{ id: string }>, next: Array<{ id: string }>) => {
    const merged = new Map(current.map((item) => [item.id, item]));
    next.forEach((item) => merged.set(item.id, item));
    return Array.from(merged.values());
  }),
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
    onEditAudience: vi.fn(),
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
    chatServiceMocks.loadTeamEmailDrafts.mockResolvedValue({
      items: [{
        id: 'draft-1',
        subject: 'Practice reminder',
        body: 'Bring shoes and water.',
        recipientIds: ['user:parent-1'],
        recipients: []
      }],
      nextCursor: null
    });
    chatServiceMocks.loadTeamEmailTemplates.mockResolvedValue({
      items: [{
        id: 'template-1',
        name: 'Weekly update',
        subject: 'Week ahead',
        body: 'Here is the plan.'
      }],
      nextCursor: null
    });
    chatServiceMocks.loadSentTeamEmails.mockResolvedValue([]);
    chatServiceMocks.sendTeamEmailMessage.mockResolvedValue({ recipientCount: 1 });
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

  it('edits the audience and preserves composed content when recipients update', async () => {
    const onEditAudience = vi.fn();
    const view = renderTeamEmailSheet({ onEditAudience });

    await screen.findByText('Saved drafts');
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Schedule change' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Practice starts at six.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit audience' }));

    expect(onEditAudience).toHaveBeenCalledTimes(1);

    view.rerender(<TeamEmailSheet {...view.props} open={false} />);
    view.rerender(
      <TeamEmailSheet
        {...view.props}
        open
        selectedRecipientTarget="individuals"
        selectedRecipientIds={['user:parent-1']}
      />
    );

    expect(screen.getByText('Audience: Parent One')).toBeVisible();
    expect(screen.getByLabelText('Subject')).toHaveValue('Schedule change');
    expect(screen.getByLabelText('Message')).toHaveValue('Practice starts at six.');
  });

  it('loads email data once per team while the sheet stays open', async () => {
    const view = renderTeamEmailSheet();

    await waitFor(() => expect(chatServiceMocks.loadTeamEmailDrafts).toHaveBeenCalledTimes(1));
    expect(chatServiceMocks.loadTeamEmailTemplates).toHaveBeenCalledTimes(1);
    expect(chatServiceMocks.loadSentTeamEmails).toHaveBeenCalledTimes(1);

    view.rerender(<TeamEmailSheet {...view.props} profile={{ fullName: 'Coach One' }} />);
    expect(chatServiceMocks.loadTeamEmailDrafts).toHaveBeenCalledTimes(1);
    expect(chatServiceMocks.loadTeamEmailTemplates).toHaveBeenCalledTimes(1);
    expect(chatServiceMocks.loadSentTeamEmails).toHaveBeenCalledTimes(1);

    view.rerender(<TeamEmailSheet {...view.props} teamId="team-2" />);
    await waitFor(() => expect(chatServiceMocks.loadTeamEmailDrafts).toHaveBeenLastCalledWith('team-2', { cursor: null }));
    expect(chatServiceMocks.loadTeamEmailTemplates).toHaveBeenLastCalledWith('team-2', { cursor: null });
    expect(chatServiceMocks.loadSentTeamEmails).toHaveBeenLastCalledWith('team-2', { limit: 25 });
  });

  it('paginates drafts and templates independently, deduplicates appends, and resets on refresh', async () => {
    const draftCursor = { updatedAt: { seconds: 20 }, id: 'draft-1' };
    const templateCursor = { updatedAt: { seconds: 20 }, id: 'template-1' };
    chatServiceMocks.loadTeamEmailDrafts
      .mockResolvedValueOnce({
        items: [{ id: 'draft-1', subject: 'Newest draft', body: 'One', recipientIds: [], recipients: [] }],
        nextCursor: draftCursor
      })
      .mockResolvedValueOnce({
        items: [
          { id: 'draft-1', subject: 'Newest draft', body: 'One', recipientIds: [], recipients: [] },
          { id: 'draft-2', subject: 'Older draft', body: 'Two', recipientIds: [], recipients: [] }
        ],
        nextCursor: null
      })
      .mockResolvedValueOnce({
        items: [{ id: 'draft-refresh', subject: 'Refreshed draft', body: 'Fresh', recipientIds: [], recipients: [] }],
        nextCursor: null
      });
    chatServiceMocks.loadTeamEmailTemplates
      .mockResolvedValueOnce({
        items: [{ id: 'template-1', name: 'Newest template', subject: 'One', body: 'One' }],
        nextCursor: templateCursor
      })
      .mockResolvedValueOnce({
        items: [{ id: 'template-2', name: 'Older template', subject: 'Two', body: 'Two' }],
        nextCursor: null
      });

    renderTeamEmailSheet();

    fireEvent.click(await screen.findByRole('button', { name: 'Load more drafts' }));
    expect(await screen.findByRole('button', { name: /Older draft/ })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Newest draft/ })).toHaveLength(1);
    expect(chatServiceMocks.loadTeamEmailDrafts).toHaveBeenLastCalledWith('team-1', { cursor: draftCursor });
    expect(screen.queryByRole('button', { name: 'Load more drafts' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more templates' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Load more templates' }));
    expect(await screen.findByRole('option', { name: 'Older template' })).toBeVisible();
    expect(chatServiceMocks.loadTeamEmailTemplates).toHaveBeenLastCalledWith('team-1', { cursor: templateCursor });
    expect(screen.queryByRole('button', { name: 'Load more templates' })).not.toBeInTheDocument();

    const draftsSection = screen.getByText('Saved drafts').closest('.space-y-3') as HTMLElement;
    fireEvent.click(within(draftsSection).getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('button', { name: /Refreshed draft/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Older draft/ })).not.toBeInTheDocument();
    expect(chatServiceMocks.loadTeamEmailDrafts).toHaveBeenLastCalledWith('team-1', { cursor: null });
  });

  it('reconciles saved drafts and templates at the top without rereading their collections', async () => {
    chatServiceMocks.saveTeamEmailDraft.mockResolvedValue({
      id: 'draft-saved',
      subject: 'Saved now',
      body: 'Current body',
      recipientIds: ['user:parent-1'],
      recipients: []
    });
    chatServiceMocks.saveTeamEmailTemplate.mockResolvedValue({
      id: 'template-saved',
      name: 'Current template',
      subject: 'Saved now',
      body: 'Current body'
    });
    renderTeamEmailSheet({
      selectedRecipientTarget: 'individuals',
      selectedRecipientIds: ['user:parent-1']
    });

    await screen.findByText('Saved drafts');
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Saved now' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Current body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('button', { name: /Saved now/ })).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText('Weekly reminder'), { target: { value: 'Current template' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('option', { name: 'Current template' })).toBeVisible();
    expect(chatServiceMocks.loadTeamEmailDrafts).toHaveBeenCalledTimes(1);
    expect(chatServiceMocks.loadTeamEmailTemplates).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['full team', 'full_team', [], 'full_team', []],
    ['selected members', 'individuals', ['user:parent-1'], 'individuals', ['user:parent-1']]
  ] as const)('keeps the %s send payload unchanged', async (_label, selectedRecipientTarget, selectedRecipientIds, targetType, recipientIds) => {
    renderTeamEmailSheet({ selectedRecipientTarget, selectedRecipientIds });

    await screen.findByText('Saved drafts');
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Schedule change' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Practice starts at six.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

    await waitFor(() => expect(chatServiceMocks.sendTeamEmailMessage).toHaveBeenCalledWith({
      teamId: 'team-1',
      subject: 'Schedule change',
      body: 'Practice starts at six.',
      targetType,
      recipientIds
    }));
  });

  it('shows an actionable throttle error without clearing the composer', async () => {
    chatServiceMocks.sendTeamEmailMessage.mockRejectedValue(Object.assign(
      new Error('Team email send limit reached. Keep this message and try again in about 10 minutes.'),
      { code: 'functions/resource-exhausted' }
    ));
    renderTeamEmailSheet();

    await screen.findByText('Saved drafts');
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Schedule change' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Practice starts at six.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Keep this message and try again in about 10 minutes.');
    expect(screen.getByLabelText('Subject')).toHaveValue('Schedule change');
    expect(screen.getByLabelText('Message')).toHaveValue('Practice starts at six.');
  });
});
