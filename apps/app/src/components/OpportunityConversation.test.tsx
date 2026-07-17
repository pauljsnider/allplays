// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { OpportunityInquiry } from '../lib/opportunityLogic';
import type { AuthState } from '../lib/types';
import { OpportunityConversation } from './OpportunityConversation';

const opportunityMocks = vi.hoisted(() => ({
  getOpportunityInquiry: vi.fn(),
  replyToOpportunityInquiry: vi.fn()
}));

vi.mock('../lib/opportunityService', () => opportunityMocks);

const auth: AuthState = {
  user: {
    uid: 'parent-1',
    email: 'parent@example.com',
    emailVerified: true,
    displayName: 'Pat Parent',
    roles: ['parent']
  },
  profile: {},
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: async () => null,
  signOut: async () => {}
};

function inquiry(messages: OpportunityInquiry['messages']): OpportunityInquiry {
  const lastMessage = messages[messages.length - 1];
  return {
    id: 'inquiry-1',
    listingId: 'listing-1',
    listingTitle: 'Need a tournament opponent',
    listingKind: 'team_seeking_players',
    teamId: 'team-1',
    participantIds: ['parent-1', 'coach-1', 'owner-1'],
    status: 'open',
    createdAt: '2026-06-15T02:00:00.000Z',
    updatedAt: '2026-06-15T03:00:00.000Z',
    lastMessagePreview: lastMessage?.body || '',
    lastMessageAuthorName: lastMessage?.authorName || '',
    messages
  };
}

describe('OpportunityConversation', () => {
  it('ignores an older private thread response after switching conversations', async () => {
    let resolveFirst!: (value: OpportunityInquiry) => void;
    const firstPromise = new Promise<OpportunityInquiry>((resolve) => {
      resolveFirst = resolve;
    });
    const first = {
      ...inquiry([]),
      id: 'inquiry-1',
      listingTitle: 'First opportunity'
    };
    const second = {
      ...inquiry([]),
      id: 'inquiry-2',
      listingId: 'listing-2',
      listingTitle: 'Second opportunity'
    };
    opportunityMocks.getOpportunityInquiry
      .mockReset()
      .mockImplementation((inquiryId: string) => inquiryId === 'inquiry-1' ? firstPromise : Promise.resolve(second));

    const { rerender } = render(
      <MemoryRouter>
        <OpportunityConversation auth={auth} inquiryId="inquiry-1" />
      </MemoryRouter>
    );
    await waitFor(() => expect(opportunityMocks.getOpportunityInquiry).toHaveBeenCalledWith('inquiry-1'));

    rerender(
      <MemoryRouter>
        <OpportunityConversation auth={auth} inquiryId="inquiry-2" />
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Second opportunity' })).toBeInTheDocument();

    await act(async () => {
      resolveFirst(first);
      await firstPromise;
    });

    expect(screen.getByRole('heading', { name: 'Second opportunity' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'First opportunity' })).not.toBeInTheDocument();
  });

  it('does not reload or overwrite the active conversation after an older reply finishes', async () => {
    let resolveReply!: (value: { success: boolean }) => void;
    const replyPromise = new Promise<{ success: boolean }>((resolve) => {
      resolveReply = resolve;
    });
    const first = {
      ...inquiry([]),
      id: 'inquiry-1',
      listingTitle: 'First opportunity'
    };
    const second = {
      ...inquiry([]),
      id: 'inquiry-2',
      listingId: 'listing-2',
      listingTitle: 'Second opportunity'
    };
    const onReplied = vi.fn();
    opportunityMocks.getOpportunityInquiry
      .mockReset()
      .mockImplementation((inquiryId: string) => Promise.resolve(inquiryId === 'inquiry-1' ? first : second));
    opportunityMocks.replyToOpportunityInquiry.mockReset().mockReturnValue(replyPromise);

    const { rerender } = render(
      <MemoryRouter>
        <OpportunityConversation auth={auth} inquiryId="inquiry-1" onReplied={onReplied} />
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'First opportunity' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Write a private reply'), {
      target: { value: 'Reply for the first conversation.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(opportunityMocks.replyToOpportunityInquiry).toHaveBeenCalledWith(
      'inquiry-1',
      'Reply for the first conversation.'
    ));

    rerender(
      <MemoryRouter>
        <OpportunityConversation auth={auth} inquiryId="inquiry-2" onReplied={onReplied} />
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Second opportunity' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Write a private reply'), {
      target: { value: 'Draft for the second conversation.' }
    });

    await act(async () => {
      resolveReply({ success: true });
      await replyPromise;
    });

    expect(screen.getByRole('heading', { name: 'Second opportunity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Write a private reply')).toHaveValue('Draft for the second conversation.');
    expect(opportunityMocks.getOpportunityInquiry.mock.calls.filter(([id]) => id === 'inquiry-1')).toHaveLength(1);
    expect(onReplied).not.toHaveBeenCalled();
  });

  it('loads a private multi-participant thread and sends a reply', async () => {
    const first = inquiry([{
      id: 'message-1',
      authorId: 'coach-1',
      authorName: 'Coach Jamie',
      body: 'Saturday morning works for our team.',
      createdAt: '2026-06-15T02:00:00.000Z'
    }]);
    const updated = inquiry([...first.messages, {
      id: 'message-2',
      authorId: 'parent-1',
      authorName: 'Pat Parent',
      body: 'Great, I will confirm the field.',
      createdAt: '2026-06-15T03:00:00.000Z'
    }]);
    const onReplied = vi.fn();
    opportunityMocks.getOpportunityInquiry
      .mockReset()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(updated);
    opportunityMocks.replyToOpportunityInquiry.mockReset().mockResolvedValue({ success: true });

    render(
      <MemoryRouter>
        <OpportunityConversation auth={auth} inquiryId="inquiry-1" onReplied={onReplied} />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Need a tournament opponent' })).toBeInTheDocument();
    expect(screen.getByText('3 participants')).toBeInTheDocument();
    expect(screen.getByText('Saturday morning works for our team.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Write a private reply'), {
      target: { value: 'Great, I will confirm the field.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(opportunityMocks.replyToOpportunityInquiry).toHaveBeenCalledWith(
      'inquiry-1',
      'Great, I will confirm the field.'
    ));
    expect(await screen.findByText('Great, I will confirm the field.')).toBeInTheDocument();
    expect(onReplied).toHaveBeenCalledWith(updated);
  });
});
