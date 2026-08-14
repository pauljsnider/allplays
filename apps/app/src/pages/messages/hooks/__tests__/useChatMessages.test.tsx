// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useCallback } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChatMessagesErrorMessage, useChatMessages } from '../useChatMessages';
import { loadOlderTeamChatMessages, subscribeToTeamChatMessages } from '../../../../lib/chatService';
import type { AuthState } from '../../../../lib/types';
import type { ChatMessage } from '../../../../lib/chatService';
import type { NativeChatPageCursor } from '../../../../lib/firestore/types';

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

function nativeCursor(nextPageToken: string | null): NativeChatPageCursor {
    return {
        kind: 'native-chat-rest',
        collectionPath: 'teams/team-1/chatMessages',
        orderBy: 'createdAt desc',
        pageSize: 50,
        nextPageToken
    };
}

function MessagesProbe({
    conversationId = 'team',
    enabled = true,
    onMessagesReset,
    onLoadOlderError
}: {
    conversationId?: string;
    enabled?: boolean;
    onMessagesReset?: () => void;
    onLoadOlderError?: (error: unknown) => void;
}) {
    const handleBeforeLiveUpdate = useCallback(() => true, []);
    const state = useChatMessages({
        teamId: 'team-1',
        team: probeTeam,
        user,
        selectedConversationId: conversationId,
        enabled,
        onBeforeLiveUpdate: handleBeforeLiveUpdate,
        onMessagesReset
    });

    return (
        <div>
            <div data-testid="loading">{String(state.loadingMessages)}</div>
            <div data-testid="loading-older">{String(state.loadingOlder)}</div>
            <div data-testid="message-ids">{state.messages.map((item) => item.id).join(',')}</div>
            <div data-testid="has-more">{String(state.hasMoreMessages)}</div>
            <div data-testid="error">{state.error || ''}</div>
            <button type="button" onClick={() => void state.loadOlderMessages().catch(onLoadOlderError)}>Load older</button>
            <button type="button" onClick={state.retryMessages}>Retry</button>
        </div>
    );
}

describe('useChatMessages', () => {
    let liveCallback: ((messages: ChatMessage[], oldestDoc: unknown | null) => void) | undefined;
    let errorCallback: ((error: Error) => void) | undefined;
    let unsubscribe: () => void;

    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        liveCallback = undefined;
        errorCallback = undefined;
        unsubscribe = vi.fn() as () => void;
        vi.mocked(subscribeToTeamChatMessages).mockImplementation((_teamId, _conversationId, onMessages, onError) => {
            liveCallback = onMessages;
            errorCallback = onError;
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

    it('waits for conversation preparation before subscribing', async () => {
        const { rerender } = render(<MessagesProbe conversationId="group_role%3Astaff" enabled={false} />);

        expect(subscribeToTeamChatMessages).not.toHaveBeenCalled();

        rerender(<MessagesProbe conversationId="group_role%3Astaff" enabled />);

        await waitFor(() => expect(subscribeToTeamChatMessages).toHaveBeenCalledTimes(1));
        expect(subscribeToTeamChatMessages).toHaveBeenCalledWith(
            'team-1',
            'group_role%3Astaff',
            expect.any(Function),
            expect.any(Function)
        );
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
        vi.mocked(loadOlderTeamChatMessages).mockResolvedValue({
            messages: [message('older-page', 5)],
            cursor: null
        });
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

    it('uses replacement native cursors and merges multiple pages without duplicate IDs', async () => {
        const firstCursor = nativeCursor('token-1');
        const secondCursor = nativeCursor('token-2');
        const terminalCursor = nativeCursor(null);
        vi.mocked(loadOlderTeamChatMessages)
            .mockResolvedValueOnce({
                messages: [message('old-49', 49), message('old-25', 25)],
                cursor: secondCursor
            })
            .mockResolvedValueOnce({
                messages: Array.from({ length: 50 }, (_, index) => message(`old-${index}`, index)),
                cursor: terminalCursor
            });
        render(<MessagesProbe conversationId="team" />);
        act(() => {
            liveCallback?.(
                Array.from({ length: 50 }, (_, index) => message(`live-${index}`, index + 50, null)),
                firstCursor
            );
        });

        await waitFor(() => expect(screen.getByTestId('has-more').textContent).toBe('true'));
        fireEvent.click(screen.getByRole('button', { name: 'Load older' }));

        await waitFor(() => expect(loadOlderTeamChatMessages).toHaveBeenNthCalledWith(1, 'team-1', 'team', firstCursor));
        await waitFor(() => expect(screen.getByTestId('message-ids').textContent?.startsWith('old-25,old-49,live-0')).toBe(true));
        expect(screen.getByTestId('has-more').textContent).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'Load older' }));

        await waitFor(() => expect(loadOlderTeamChatMessages).toHaveBeenNthCalledWith(2, 'team-1', 'team', secondCursor));
        await waitFor(() => expect(screen.getByTestId('has-more').textContent).toBe('false'));
        const ids = screen.getByTestId('message-ids').textContent?.split(',') || [];
        expect(ids).toHaveLength(100);
        expect(ids.slice(0, 3)).toEqual(['old-0', 'old-1', 'old-2']);
        expect(ids.slice(-3)).toEqual(['live-47', 'live-48', 'live-49']);
        expect(ids.filter((id) => id === 'old-25')).toHaveLength(1);
        expect(ids.filter((id) => id === 'old-49')).toHaveLength(1);
    });

    it('treats an exact-50 native page without a token as terminal', async () => {
        render(<MessagesProbe conversationId="team" />);
        act(() => {
            liveCallback?.(
                Array.from({ length: 50 }, (_, index) => message(`live-${index}`, index, null)),
                nativeCursor(null)
            );
        });

        await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
        expect(screen.getByTestId('has-more').textContent).toBe('false');
        fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
        expect(loadOlderTeamChatMessages).not.toHaveBeenCalled();
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

    it('retries a failed live subscription for the same team and conversation', async () => {
        const onMessagesReset = vi.fn();
        render(<MessagesProbe conversationId="staff" onMessagesReset={onMessagesReset} />);

        act(() => {
            errorCallback?.(new Error('Subscription failed'));
        });

        await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
        expect(screen.getByTestId('error').textContent).toBe('Subscription failed');

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        expect(screen.getByTestId('loading').textContent).toBe('true');
        expect(screen.getByTestId('error').textContent).toBe('');
        expect(screen.getByTestId('message-ids').textContent).toBe('');
        await waitFor(() => expect(subscribeToTeamChatMessages).toHaveBeenCalledTimes(2));
        expect(unsubscribe).toHaveBeenCalled();
        expect(onMessagesReset).toHaveBeenCalledTimes(3);
        expect(subscribeToTeamChatMessages).toHaveBeenLastCalledWith('team-1', 'staff', expect.any(Function), expect.any(Function));

        act(() => {
            liveCallback?.([message('recovered', 30)], { cursor: 'recovered' });
        });

        await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
        expect(screen.getByTestId('message-ids').textContent).toBe('recovered');
    });

    it('replaces Firestore permission details with actionable, user-safe copy', async () => {
        const permissionError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied'
        });
        render(<MessagesProbe conversationId="staff" />);

        act(() => {
            errorCallback?.(permissionError);
        });

        await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
        expect(screen.getByTestId('error').textContent).toBe("We couldn't open this conversation. Your team access may have changed.");
        expect(screen.getByTestId('error').textContent).not.toContain('permissions');
        expect(getChatMessagesErrorMessage({ code: 'permission-denied' })).toBe("We couldn't open this conversation. Your team access may have changed.");
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
