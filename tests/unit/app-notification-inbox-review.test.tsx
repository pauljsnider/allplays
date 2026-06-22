// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationInboxSheet } from '../../apps/app/src/components/NotificationInboxSheet';
import { markAllNotificationsRead, subscribeToNotificationInbox } from '../../apps/app/src/lib/notificationInboxService';
import type { NotificationInboxItem } from '../../apps/app/src/lib/notificationInboxService';

const { navigateMock } = vi.hoisted(() => ({
    navigateMock: vi.fn(),
}));

const { callableMock } = vi.hoisted(() => ({
    callableMock: vi.fn(),
}));

const firebaseMocks = vi.hoisted(() => ({
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    db: {},
    doc: vi.fn(),
    functions: {},
    httpsCallable: vi.fn(() => callableMock),
    limit: vi.fn((count: number) => ({ type: 'limit', count })),
    onSnapshot: vi.fn(() => vi.fn()),
    orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
    query: vi.fn((...args: unknown[]) => ({ args })),
    where: vi.fn((field: string, operator: string, value: unknown) => ({ type: 'where', field, operator, value })),
    serverTimestamp: vi.fn(),
    updateDoc: vi.fn(),
    writeBatch: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

vi.mock('../../js/firebase.js', () => firebaseMocks);

function notificationItem(overrides: Partial<NotificationInboxItem> = {}): NotificationInboxItem {
    return {
        id: 'notif-1',
        category: 'team_message',
        type: 'team_message',
        title: 'Team update',
        body: 'New team message',
        text: 'Team update: New team message',
        appRoute: '/messages',
        createdAt: null,
        readAt: null,
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('Notification inbox review regressions', () => {
    it('navigates to an item route before closing the sheet', async () => {
        const onClose = vi.fn();
        const onMarkRead = vi.fn(() => Promise.resolve());

        render(
            <NotificationInboxSheet
                items={[
                    notificationItem(),
                ]}
                inboxState="ready"
                uid="user-1"
                onClose={onClose}
                onMarkRead={onMarkRead}
            />
        );

        fireEvent.click(screen.getByTestId('notification-item-notif-1'));

        await waitFor(() => {
            expect(onMarkRead).toHaveBeenCalledWith('user-1', 'notif-1');
        });
        expect(navigateMock).toHaveBeenCalledWith('/messages');
        expect(onClose).toHaveBeenCalled();
        expect(navigateMock.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
        expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onMarkRead.mock.invocationCallOrder[0]);
    });

    it('navigates and closes immediately when mark-read never resolves', () => {
        const onClose = vi.fn();
        const onMarkRead = vi.fn(() => new Promise<void>(() => undefined));

        render(
            <NotificationInboxSheet
                items={[
                    notificationItem({
                        id: 'notif-pending',
                        category: 'live_score',
                        type: 'live_score',
                        title: 'Live score',
                        body: 'Live score update',
                        text: 'Live score update',
                        appRoute: '/games/game-1',
                    }),
                ]}
                inboxState="ready"
                uid="user-1"
                onClose={onClose}
                onMarkRead={onMarkRead}
            />
        );

        fireEvent.click(screen.getByTestId('notification-item-notif-pending'));

        expect(navigateMock).toHaveBeenCalledWith('/games/game-1');
        expect(onClose).toHaveBeenCalled();
        expect(onMarkRead).toHaveBeenCalledWith('user-1', 'notif-pending');
        expect(navigateMock.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
        expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onMarkRead.mock.invocationCallOrder[0]);
    });

    it('still navigates when mark-read rejects and logs the failure', async () => {
        const onClose = vi.fn();
        const rejection = new Error('offline');
        const onMarkRead = vi.fn(() => Promise.reject(rejection));
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        render(
            <NotificationInboxSheet
                items={[
                    notificationItem({
                        id: 'notif-error',
                        category: 'schedule',
                        type: 'schedule',
                        title: 'Schedule changed',
                        body: '',
                        text: 'Schedule changed',
                        appRoute: '/schedule/game-2',
                    }),
                ]}
                inboxState="ready"
                uid="user-1"
                onClose={onClose}
                onMarkRead={onMarkRead}
            />
        );

        fireEvent.click(screen.getByTestId('notification-item-notif-error'));

        expect(navigateMock).toHaveBeenCalledWith('/schedule/game-2');
        expect(onClose).toHaveBeenCalled();
        await waitFor(() => {
            expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to mark notification read:', rejection);
        });
    });

    it('logs Firestore subscription errors when no error callback is provided', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const subscriptionError = new Error('subscription failed');

        subscribeToNotificationInbox('user-1', vi.fn());

        const errorHandler = firebaseMocks.onSnapshot.mock.calls[0][2] as (error: unknown) => void;
        errorHandler(subscriptionError);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            '[notification-inbox-service] Failed to subscribe to notification inbox.',
            { error: { name: 'Error', message: 'subscription failed' } }
        );
    });

    it('maps server-written category, title, and body fields to display text while preserving legacy type/text fallback', () => {
        const callback = vi.fn();
        subscribeToNotificationInbox('user-1', callback);

        const nextHandler = firebaseMocks.onSnapshot.mock.calls[0][1] as (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void;
        nextHandler({
            docs: [
                {
                    id: 'server-shape',
                    data: () => ({
                        category: 'schedule',
                        title: 'Schedule update',
                        body: 'Practice moved to Field 2.',
                        appRoute: '/schedule/team-1/practice-1',
                        createdAt: 'created-at',
                        readAt: null,
                    }),
                },
                {
                    id: 'legacy-shape',
                    data: () => ({
                        type: 'team_message',
                        text: 'Legacy team message',
                        appRoute: '/messages/team-1',
                        createdAt: 'legacy-created-at',
                        readAt: 'read-at',
                    }),
                },
            ],
        });

        expect(callback).toHaveBeenCalledWith([
            expect.objectContaining({
                id: 'server-shape',
                category: 'schedule',
                type: 'schedule',
                title: 'Schedule update',
                body: 'Practice moved to Field 2.',
                text: 'Schedule update: Practice moved to Field 2.',
                appRoute: '/schedule/team-1/practice-1',
                readAt: null,
            }),
            expect.objectContaining({
                id: 'legacy-shape',
                category: 'team_message',
                type: 'team_message',
                text: 'Legacy team message',
                readAt: 'read-at',
            }),
        ]);
    });

    it('marks visible unread notifications read through the backend callable path', async () => {
        callableMock.mockResolvedValue({ data: { status: 'success', updatedCount: 2 } });

        await markAllNotificationsRead('user-1', [
            notificationItem({ id: 'unread-1', readAt: null }),
            notificationItem({ id: 'read-1', readAt: 'already-read' }),
            notificationItem({ id: 'unread-2', readAt: null }),
        ]);

        expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(firebaseMocks.functions, 'markAllNotificationInboxRead');
        expect(callableMock).toHaveBeenCalledWith({});
        expect(firebaseMocks.writeBatch).not.toHaveBeenCalled();
    });

    it('shows loading spinner when inboxState is loading and no items are present', () => {
        render(
            <NotificationInboxSheet
                items={[]}
                inboxState="loading"
                uid="user-1"
                onClose={vi.fn()}
                onMarkRead={vi.fn(() => Promise.resolve())}
            />
        );

        expect(screen.getByTestId('notification-inbox-loading')).toBeTruthy();
        expect(screen.queryByText('No notifications yet')).toBeNull();
    });

    it('shows error message when inboxState is error and no items are present', () => {
        render(
            <NotificationInboxSheet
                items={[]}
                inboxState="error"
                uid="user-1"
                onClose={vi.fn()}
                onMarkRead={vi.fn(() => Promise.resolve())}
            />
        );

        expect(screen.getByTestId('notification-inbox-error')).toBeTruthy();
        expect(screen.queryByText('No notifications yet')).toBeNull();
        expect(screen.queryByTestId('notification-inbox-loading')).toBeNull();
    });

    it('shows items with an error banner when inboxState is error but prior items are loaded', () => {
        render(
            <NotificationInboxSheet
                items={[
                    notificationItem({
                        id: 'notif-2',
                        category: 'game_update',
                        type: 'game_update',
                        title: 'Game rescheduled',
                        body: '',
                        text: 'Game rescheduled',
                        appRoute: '/schedule',
                    }),
                ]}
                inboxState="error"
                uid="user-1"
                onClose={vi.fn()}
                onMarkRead={vi.fn(() => Promise.resolve())}
            />
        );

        expect(screen.getByTestId('notification-item-notif-2')).toBeTruthy();
        expect(screen.getByTestId('notification-inbox-error-banner')).toBeTruthy();
        expect(screen.queryByTestId('notification-inbox-error')).toBeNull();
    });

    it('shows "No notifications yet" only when inboxState is ready and items list is empty', () => {
        render(
            <NotificationInboxSheet
                items={[]}
                inboxState="ready"
                uid="user-1"
                onClose={vi.fn()}
                onMarkRead={vi.fn(() => Promise.resolve())}
            />
        );

        expect(screen.getByText('No notifications yet')).toBeTruthy();
        expect(screen.queryByTestId('notification-inbox-loading')).toBeNull();
        expect(screen.queryByTestId('notification-inbox-error')).toBeNull();
    });

    it('calls the mark-all callback with visible unread items', async () => {
        const onMarkAllRead = vi.fn(() => Promise.resolve());

        render(
            <NotificationInboxSheet
                items={[
                    notificationItem({ id: 'unread-1', readAt: null }),
                    notificationItem({ id: 'read-1', readAt: 'already-read' }),
                    notificationItem({ id: 'unread-2', readAt: null }),
                ]}
                inboxState="ready"
                uid="user-1"
                onClose={vi.fn()}
                onMarkRead={vi.fn(() => Promise.resolve())}
                onMarkAllRead={onMarkAllRead}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /mark all read/i }));

        await waitFor(() => {
            expect(onMarkAllRead).toHaveBeenCalledWith('user-1', [
                expect.objectContaining({ id: 'unread-1' }),
                expect.objectContaining({ id: 'unread-2' }),
            ]);
        });
    });
});
