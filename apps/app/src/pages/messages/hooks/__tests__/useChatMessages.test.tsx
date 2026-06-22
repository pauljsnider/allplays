// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useCallback } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatMessages } from '../useChatMessages';
import { loadOlderTeamChatMessages, subscribeToTeamChatMessages } from '../../../../lib/chatService';
import type { AuthState } from '../../../../lib/types';
import type { ChatMessage } from '../../../../lib/chatService';

vi.mock('../../../../lib/chatService', () => ({
    subscribeToTeamChatMessages: vi.fn(),
    loadOlderTeamChatMessages: vi.fn()
}));

const user: NonNullable<AuthState['user']> = {
    uid: 'user-1',
    email: 'coach@example.com',
    displayName: 'Coach Kim',
    roles: []
};

function message(id: string, seconds: number, doc: unknown = { id }): ChatMessage {
    return {
        id,
        text: id,
        senderId: 'sender-1',
        senderName: 'Sender',
        senderEmail: 'sender@example.com',
        createdAt: { seconds },
        reactions: {},
        deleted: false,
        _doc: doc
    } as ChatMessage;
}

const probeTeam = { id: 'team-1', name: 'Bears' };

function MessagesProbe({
    conversationId = 'team',
    onMessagesReset,
    onLoadOlderError
}: {
    conversationId?: string;
    onMessagesReset?: () => void;
    onLoadOlderError?: (error: unknown) => void;
}) {
    const handleBeforeLiveUpdate = useCallback(() => true, []);
    const state = useChatMessages({
        teamId: 'team-1',
        team: probeTeam,
        user,
        selectedConversationId: conversationId,
        onBeforeLiveUpdate: handleBeforeLiveUpdate,
        onMessagesReset
    });

    return (
        <div>
            <div data-testid="loading">{String(state.loadingMessages)}</div>
            <div data-testid="loading-older">{String(state.loadingOlder)}</div>
            <div data-testid="message-ids">{state.messages.map((item) => item.id).join(',')}</div>
            <div data-testid="has-more">{String(state.hasMoreMessages)}</div>
            <button type="button" onClick={() => void state.loadOlderMessages().catch(onLoadOlderError)}>Load older</button>
        </div>
    );
}

describe('useChatMessages', () => {
    let liveCallback: ((messages: ChatMessage[], oldestDoc: unknown | null) => void) | undefined;
    let unsubscribe: () => void;

    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        liveCallback = undefined;
        unsubscribe = vi.fn() as () => void;
        vi.mocked(subscribeToTeamChatMessages).mockImplementation((_teamId, _conversationId, onMessages) => {
            liveCallback = onMessages;
            return { unsubscribe };
        });
    });

    it('falls back to the default conversation when the selected id is blank', async () => {
        render(<MessagesProbe conversationId="" />);

        expect(subscribeToTeamChatMessages).toHaveBeenCalledWith('team-1', 'team', expect.any(Function), expect.any(Function));
    });

    it('subscribes to the selected conversation and exposes live messages', async () => {
        render(<MessagesProbe conversationId="staff" />);

        expect(subscribeToTeamChatMessages).toHaveBeenCalledWith('team-1', 'staff', expect.any(Function), expect.any(Function));
        act(() => {
            liveCallback?.([message('newer', 20), message('older', 10, { cursor: 'oldest' })], { cursor: 'oldest' });
        });

        await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
        expect(screen.getByTestId('message-ids').textContent).toBe('older,newer');
        expect(screen.getByTestId('has-more').textContent).toBe('false');
    });

    it('resubscribes and clears messages when the selected conversation changes', async () => {
        const onMessagesReset = vi.fn();
        const { rerender } = render(<MessagesProbe conversationId="team" onMessagesReset={onMessagesReset} />);
        act(() => {
            liveCallback?.([message('team-message', 20)], { cursor: 'team' });
        });
        await waitFor(() => expect(screen.getByTestId('message-ids').textContent).toBe('team-message'));

        rerender(<MessagesProbe conversationId="staff" onMessagesReset={onMessagesReset} />);

        expect(unsubscribe).toHaveBeenCalled();
        expect(onMessagesReset).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('loading').textContent).toBe('true');
        expect(screen.getByTestId('message-ids').textContent).toBe('');
        expect(subscribeToTeamChatMessages).toHaveBeenLastCalledWith('team-1', 'staff', expect.any(Function), expect.any(Function));
    });

    it('prepends older messages and clears the pagination flag on short batches', async () => {
        vi.mocked(loadOlderTeamChatMessages).mockResolvedValue([message('older-page', 5)]);
        render(<MessagesProbe conversationId="team" />);
        act(() => {
            liveCallback?.(Array.from({ length: 50 }, (_, index) => message(`live-${index}`, index + 50, index === 49 ? { cursor: 'oldest' } : { id: index })), { cursor: 'oldest' });
        });

        await waitFor(() => expect(screen.getByTestId('has-more').textContent).toBe('true'));
        fireEvent.click(screen.getByRole('button', { name: 'Load older' }));

        await waitFor(() => expect(loadOlderTeamChatMessages).toHaveBeenCalledWith('team-1', 'team', { cursor: 'oldest' }));
        await waitFor(() => expect(screen.getByTestId('message-ids').textContent?.startsWith('older-page')).toBe(true));
        expect(screen.getByTestId('has-more').textContent).toBe('false');
    });

    it('skips older message loading when the live page has no older cursor', async () => {
        render(<MessagesProbe conversationId="team" />);
        act(() => {
            liveCallback?.([message('latest', 20)], { cursor: 'latest' });
        });

        await waitFor(() => expect(screen.getByTestId('has-more').textContent).toBe('false'));
        fireEvent.click(screen.getByRole('button', { name: 'Load older' }));

        expect(loadOlderTeamChatMessages).not.toHaveBeenCalled();
        expect(screen.getByTestId('loading-older').textContent).toBe('false');
    });

    it('does not resubscribe when the user object changes identity but keeps the same uid', async () => {
        function MessagesProbeWithUser({ authUser }: { authUser: NonNullable<AuthState['user']> }) {
            useChatMessages({
                teamId: 'team-1',
                team: probeTeam,
                user: authUser,
                selectedConversationId: 'team'
            });
            return null;
        }

        const firstUser = { ...user };
        const secondUser = { ...user };

        const { rerender } = render(<MessagesProbeWithUser authUser={firstUser} />);
        await waitFor(() => expect(subscribeToTeamChatMessages).toHaveBeenCalledTimes(1));

        rerender(<MessagesProbeWithUser authUser={secondUser} />);

        await waitFor(() => expect(subscribeToTeamChatMessages).toHaveBeenCalledTimes(1));
    });

    it('resets the loading state when loading older messages fails and still rejects to the caller', async () => {
        const loadError = new Error('load failed');
        const onLoadOlderError = vi.fn();
        vi.mocked(loadOlderTeamChatMessages).mockRejectedValue(loadError);
        render(<MessagesProbe conversationId="team" onLoadOlderError={onLoadOlderError} />);
        act(() => {
            liveCallback?.(Array.from({ length: 50 }, (_, index) => message(`live-${index}`, index + 50, index === 49 ? { cursor: 'oldest' } : { id: index })), { cursor: 'oldest' });
        });

        await waitFor(() => expect(screen.getByTestId('has-more').textContent).toBe('true'));
        fireEvent.click(screen.getByRole('button', { name: 'Load older' }));

        await waitFor(() => expect(onLoadOlderError).toHaveBeenCalledWith(loadError));
        await waitFor(() => expect(screen.getByTestId('loading-older').textContent).toBe('false'));
    });
});
