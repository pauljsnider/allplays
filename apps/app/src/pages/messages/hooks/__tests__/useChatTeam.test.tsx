// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useChatTeam } from '../useChatTeam';
import { DEFAULT_TEAM_CONVERSATION_ID } from '../../../../lib/chatLogic';
import { loadChatConversations, loadChatTeamContext } from '../../../../lib/chatService';
import type { AuthState } from '../../../../lib/types';

vi.mock('../../../../lib/chatService', () => ({
    loadChatTeamContext: vi.fn(),
    loadChatConversations: vi.fn()
}));

const user: NonNullable<AuthState['user']> = {
    uid: 'user-1',
    email: 'coach@example.com',
    displayName: 'Coach Kim',
    roles: []
};

function TeamProbe({ teamId, preferredConversationId = '' }: { teamId: string; preferredConversationId?: string }) {
    const state = useChatTeam({ teamId, user, preferredConversationId });

    return (
        <div>
            <div data-testid="loading">{String(state.loadingContext)}</div>
            <div data-testid="team-name">{state.team?.name || ''}</div>
            <div data-testid="can-moderate">{String(state.canModerate)}</div>
            <div data-testid="selected-conversation">{state.selectedConversationId}</div>
            <div data-testid="conversation-count">{state.conversations.length}</div>
            <button type="button" onClick={() => state.switchConversation('staff')}>Open staff</button>
        </div>
    );
}

describe('useChatTeam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads team context, conversations, and preserves moderation state', async () => {
        vi.mocked(loadChatTeamContext).mockResolvedValue({
            team: { id: 'team-1', name: 'Bears' },
            profile: { chatMuted: {} },
            canModerate: true
        });
        vi.mocked(loadChatConversations).mockResolvedValue([
            { id: DEFAULT_TEAM_CONVERSATION_ID, type: 'team', isDefault: true },
            { id: 'staff', type: 'group', name: 'Staff only' }
        ]);

        render(<TeamProbe teamId="team-1" preferredConversationId="staff" />);

        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
        expect(screen.getByTestId('team-name')).toHaveTextContent('Bears');
        expect(screen.getByTestId('can-moderate')).toHaveTextContent('true');
        expect(screen.getByTestId('selected-conversation')).toHaveTextContent('staff');
        expect(screen.getByTestId('conversation-count')).toHaveTextContent('2');
        expect(loadChatConversations).toHaveBeenCalledWith('team-1', user, { id: 'team-1', name: 'Bears' }, true);
    });

    it('reloads context when switching teams and falls back to the default conversation', async () => {
        vi.mocked(loadChatTeamContext)
            .mockResolvedValueOnce({ team: { id: 'team-1', name: 'Bears' }, profile: {}, canModerate: true })
            .mockResolvedValueOnce({ team: { id: 'team-2', name: 'Hawks' }, profile: {}, canModerate: false });
        vi.mocked(loadChatConversations)
            .mockResolvedValueOnce([{ id: 'staff', type: 'group', name: 'Staff only' }])
            .mockResolvedValueOnce([{ id: DEFAULT_TEAM_CONVERSATION_ID, type: 'team', isDefault: true }]);

        const { rerender } = render(<TeamProbe teamId="team-1" preferredConversationId="staff" />);
        await waitFor(() => expect(screen.getByTestId('team-name')).toHaveTextContent('Bears'));
        expect(screen.getByTestId('selected-conversation')).toHaveTextContent('staff');

        rerender(<TeamProbe teamId="team-2" preferredConversationId="staff" />);

        await waitFor(() => expect(screen.getByTestId('team-name')).toHaveTextContent('Hawks'));
        expect(screen.getByTestId('can-moderate')).toHaveTextContent('false');
        expect(screen.getByTestId('selected-conversation')).toHaveTextContent(DEFAULT_TEAM_CONVERSATION_ID);
    });
});
