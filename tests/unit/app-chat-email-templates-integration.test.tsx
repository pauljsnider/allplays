// @vitest-environment jsdom
// Keep Messages app coverage in tests/unit so the root npm test script runs it in CI.
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../apps/app/node_modules/@testing-library/react/dist/index.js';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../../apps/app/src/lib/types';
import { Messages } from '../../apps/app/src/pages/Messages.tsx';

const chatServiceMocks = vi.hoisted(() => ({
  deleteTeamChatMessage: vi.fn(),
  editTeamChatMessage: vi.fn(),
  ensureStaffChatConversation: vi.fn(),
  getChatInboxPreview: vi.fn(() => ''),
  loadChatConversations: vi.fn(),
  loadChatInbox: vi.fn(),
  loadChatRecipientOptions: vi.fn(),
  loadChatTeamContext: vi.fn(),
  loadOlderTeamChatMessages: vi.fn(),
  loadTeamEmailDrafts: vi.fn(),
  loadSentTeamEmails: vi.fn(),
  loadTeamEmailTemplates: vi.fn(),
  markTeamChatRead: vi.fn(),
  saveTeamEmailDraft: vi.fn(),
  saveTeamEmailTemplate: vi.fn(),
  sendAllPlaysChatAnswer: vi.fn(),
  sendTeamChatMessage: vi.fn(),
  sendTeamEmailMessage: vi.fn(),
  subscribeToTeamChatMessages: vi.fn(),
  toggleTeamChatReaction: vi.fn()
}));

vi.mock('../../apps/app/src/lib/chatService.ts', () => chatServiceMocks);
vi.mock('../../apps/app/src/lib/useShellLayout.ts', () => ({ useShellLayout: vi.fn(() => ({ isDesktopWeb: false })) }));
vi.mock('../../apps/app/src/lib/publicActions.ts', () => ({ sharePublicUrl: vi.fn() }));
vi.mock('../../apps/app/src/lib/voiceService.ts', () => ({
  voiceRecognition: {
    isNativeRuntime: vi.fn(() => false),
    hasBrowserSupport: vi.fn(() => false),
    available: vi.fn(),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    addPartialResultsListener: vi.fn(),
    addListeningStateListener: vi.fn(),
    addErrorListener: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    getLastPartialResult: vi.fn()
  }
}));

const auth: AuthState = {
  user: {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach Carter'
  } as any,
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

function renderMessages() {
  return render(
    <MemoryRouter initialEntries={['/messages/team-1']}>
      <Routes>
        <Route path="/messages/:teamId" element={<Messages auth={auth} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Messages team email templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });

    chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: [] });
    chatServiceMocks.loadChatTeamContext.mockResolvedValue({
      team: { id: 'team-1', name: 'Bears', ownerId: 'coach-1', adminEmails: ['coach@example.com'] },
      profile: { fullName: 'Coach Carter' },
      canModerate: true
    });
    chatServiceMocks.loadChatConversations.mockResolvedValue([
      { id: 'team', type: 'team', isDefault: true, name: 'Team chat' }
    ]);
    chatServiceMocks.loadChatRecipientOptions.mockResolvedValue([
      { id: 'email:avery.parent@example.com', name: 'Avery Parent', detail: 'Guardian for Avery Smith', email: 'avery.parent@example.com' },
      { id: 'email:blake.parent@example.com', name: 'Blake Parent', detail: 'Guardian for Blake Jones', email: 'blake.parent@example.com' }
    ]);
    chatServiceMocks.subscribeToTeamChatMessages.mockImplementation((_teamId, _conversationId, onMessages) => {
      onMessages([], null);
      return { unsubscribe: vi.fn() };
    });
    chatServiceMocks.loadOlderTeamChatMessages.mockResolvedValue([]);
    chatServiceMocks.loadTeamEmailDrafts.mockResolvedValue([
      {
        id: 'draft-1',
        subject: 'Bus update',
        body: 'Wear warmups on the bus.',
        recipientIds: ['email:blake.parent@example.com'],
        recipients: [{ key: 'email:blake.parent@example.com', email: 'blake.parent@example.com', name: 'Blake Parent', detail: 'Guardian for Blake Jones' }],
        updatedAt: { seconds: 5 }
      }
    ]);
    chatServiceMocks.loadSentTeamEmails.mockResolvedValue([]);
    chatServiceMocks.loadTeamEmailTemplates.mockResolvedValue([
      { id: 'template-1', name: 'Practice reminder', subject: 'Practice tonight', body: 'Please arrive 15 minutes early.' }
    ]);
    chatServiceMocks.sendTeamEmailMessage.mockResolvedValue({ recipientCount: 1 });
    chatServiceMocks.saveTeamEmailDraft.mockResolvedValue({
      id: 'draft-2',
      subject: 'Game tomorrow',
      body: 'Bring uniforms.',
      recipientIds: ['email:avery.parent@example.com'],
      recipients: [{ key: 'email:avery.parent@example.com', email: 'avery.parent@example.com', name: 'Avery Parent', detail: 'Guardian for Avery Smith' }],
      updatedAt: { seconds: 10 }
    });
    chatServiceMocks.saveTeamEmailTemplate.mockResolvedValue({
      id: 'template-2',
      name: 'Game day',
      subject: 'Game tomorrow',
      body: 'Bring uniforms.'
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads templates, applies one, and keeps selected recipients when sending', async () => {
    renderMessages();

    fireEvent.click(await screen.findByRole('button', { name: /audience:/i }));
    fireEvent.click(screen.getByRole('button', { name: /selected members/i }));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open Team Email' }));

    expect(await screen.findByRole('dialog', { name: 'Team Email' })).toBeTruthy();
    await waitFor(() => {
      expect(chatServiceMocks.loadTeamEmailTemplates).toHaveBeenCalledWith('team-1');
    });

    fireEvent.change(screen.getByLabelText('Saved template'), { target: { value: 'template-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply template' }));

    expect(screen.getByDisplayValue('Practice tonight')).toBeTruthy();
    expect(screen.getByDisplayValue('Please arrive 15 minutes early.')).toBeTruthy();
    expect(screen.getByText(/Applied template/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

    await waitFor(() => {
      expect(chatServiceMocks.sendTeamEmailMessage).toHaveBeenCalledWith(expect.objectContaining({
        teamId: 'team-1',
        subject: 'Practice tonight',
        body: 'Please arrive 15 minutes early.',
        targetType: 'individuals',
        recipientIds: ['email:avery.parent@example.com']
      }));
    });
  });

  it('shows the mobile team email composer before drafts and templates', async () => {
    renderMessages();

    fireEvent.click(await screen.findByRole('button', { name: /audience:/i }));
    fireEvent.click(screen.getByRole('button', { name: /selected members/i }));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Team Email' }));

    const dialog = await screen.findByRole('dialog', { name: 'Team Email' });
    const subjectField = within(dialog).getByLabelText('Subject');
    const messageField = within(dialog).getByLabelText('Message');
    const sendButton = within(dialog).getByRole('button', { name: 'Send email' });
    const savedDraftsHeading = within(dialog).getByText('Saved drafts');
    const reusableTemplatesHeading = within(dialog).getByText('Reusable templates');

    expect(chatServiceMocks.loadTeamEmailDrafts).toHaveBeenCalledWith('team-1');
    expect(subjectField.compareDocumentPosition(savedDraftsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(messageField.compareDocumentPosition(savedDraftsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sendButton.compareDocumentPosition(savedDraftsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sendButton.compareDocumentPosition(reusableTemplatesHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('loads saved drafts and restores one into the team email composer', async () => {
    renderMessages();

    fireEvent.click(await screen.findByRole('button', { name: /audience:/i }));
    fireEvent.click(screen.getByRole('button', { name: /selected members/i }));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Team Email' }));

    expect(await screen.findByRole('dialog', { name: 'Team Email' })).toBeTruthy();
    expect(chatServiceMocks.loadTeamEmailDrafts).toHaveBeenCalledWith('team-1');

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Changed subject' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Changed body' } });
    fireEvent.click(screen.getByRole('button', { name: /Bus update/i }));

    expect(screen.getByDisplayValue('Bus update')).toBeTruthy();
    expect(screen.getByDisplayValue('Wear warmups on the bus.')).toBeTruthy();
    expect(screen.getByText(/Restored draft/)).toBeTruthy();
    expect(screen.getAllByText(/Audience: Blake Parent/).length).toBeGreaterThan(0);
  });

  it('saves a draft and updates the rendered draft list without touching sent history', async () => {
    chatServiceMocks.loadTeamEmailDrafts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'draft-2',
          subject: 'Game tomorrow',
          body: 'Bring uniforms.',
          recipientIds: ['email:avery.parent@example.com'],
          recipients: [{ key: 'email:avery.parent@example.com', email: 'avery.parent@example.com', name: 'Avery Parent', detail: 'Guardian for Avery Smith' }],
          updatedAt: { seconds: 10 }
        }
      ]);

    renderMessages();

    fireEvent.click(await screen.findByRole('button', { name: /audience:/i }));
    fireEvent.click(screen.getByRole('button', { name: /selected members/i }));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Team Email' }));
    await screen.findByRole('dialog', { name: 'Team Email' });

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Game tomorrow' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Bring uniforms.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(chatServiceMocks.saveTeamEmailDraft).toHaveBeenCalledWith({
        teamId: 'team-1',
        draftId: null,
        subject: 'Game tomorrow',
        body: 'Bring uniforms.',
        recipientIds: ['email:avery.parent@example.com'],
        recipientOptions: [
          { id: 'email:avery.parent@example.com', name: 'Avery Parent', detail: 'Guardian for Avery Smith', email: 'avery.parent@example.com' },
          { id: 'email:blake.parent@example.com', name: 'Blake Parent', detail: 'Guardian for Blake Jones', email: 'blake.parent@example.com' }
        ],
        authorId: 'coach-1',
        authorEmail: 'coach@example.com',
        authorName: 'Coach Carter'
      });
    });

    expect(await screen.findByText(/Saved draft .*Game tomorrow/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Game tomorrow/i })).toBeTruthy();
    expect(chatServiceMocks.loadSentTeamEmails).toHaveBeenCalledTimes(1);
  });

  it('saves a new template from the current subject and body', async () => {
    chatServiceMocks.loadTeamEmailTemplates
      .mockResolvedValueOnce([
        { id: 'template-1', name: 'Practice reminder', subject: 'Practice tonight', body: 'Please arrive 15 minutes early.' }
      ])
      .mockResolvedValueOnce([
        { id: 'template-2', name: 'Game day', subject: 'Game tomorrow', body: 'Bring uniforms.' },
        { id: 'template-1', name: 'Practice reminder', subject: 'Practice tonight', body: 'Please arrive 15 minutes early.' }
      ]);

    renderMessages();

    fireEvent.click(await screen.findByRole('button', { name: 'Open Team Email' }));
    await screen.findByRole('dialog', { name: 'Team Email' });

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Game tomorrow' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Bring uniforms.' } });
    fireEvent.change(screen.getByPlaceholderText('Weekly reminder'), { target: { value: 'Game day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() => {
      expect(chatServiceMocks.saveTeamEmailTemplate).toHaveBeenCalledWith({
        teamId: 'team-1',
        name: 'Game day',
        subject: 'Game tomorrow',
        body: 'Bring uniforms.'
      });
    });

    expect(await screen.findByText(/Saved template .*Game day/)).toBeTruthy();

    const select = screen.getByLabelText('Saved template');
    const options = within(select).getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('Game day');
  });
});
