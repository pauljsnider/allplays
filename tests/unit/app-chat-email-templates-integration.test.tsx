// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  loadSentTeamEmails: vi.fn(),
  loadTeamEmailTemplates: vi.fn(),
  markTeamChatRead: vi.fn(),
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
      { id: 'player-1', name: 'Avery Smith', detail: 'Player' },
      { id: 'player-2', name: 'Blake Jones', detail: 'Player' }
    ]);
    chatServiceMocks.subscribeToTeamChatMessages.mockImplementation((_teamId, _conversationId, onMessages) => {
      onMessages([], null);
      return { unsubscribe: vi.fn() };
    });
    chatServiceMocks.loadOlderTeamChatMessages.mockResolvedValue([]);
    chatServiceMocks.loadSentTeamEmails.mockResolvedValue([]);
    chatServiceMocks.loadTeamEmailTemplates.mockResolvedValue([
      { id: 'template-1', name: 'Practice reminder', subject: 'Practice tonight', body: 'Please arrive 15 minutes early.' }
    ]);
    chatServiceMocks.sendTeamEmailMessage.mockResolvedValue({ recipientCount: 1 });
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
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open Team Email' }));

    expect(await screen.findByRole('dialog', { name: 'Team Email' })).toBeTruthy();
    expect(chatServiceMocks.loadTeamEmailTemplates).toHaveBeenCalledWith('team-1');

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
        recipientIds: ['player-1']
      }));
    });
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
