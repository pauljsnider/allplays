// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationInboxSheet } from '../../apps/app/src/components/NotificationInboxSheet';
import { subscribeToNotificationInbox } from '../../apps/app/src/lib/notificationInboxService';

const { navigateMock } = vi.hoisted(() => ({
    navigateMock: vi.fn(),
}));

const firebaseMocks = vi.hoisted(() => ({
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    db: {},
    doc: vi.fn(),
    limit: vi.fn((count: number) => ({ type: 'limit', count })),
    onSnapshot: vi.fn(() => vi.fn()),
    orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
    query: vi.fn((...args: unknown[]) => ({ args })),
    serverTimestamp: vi.fn(),
    updateDoc: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

vi.mock('../../js/firebase.js', () => firebaseMocks);

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
                    {
                        id: 'notif-1',
                        type: 'team_message',
                        text: 'New team message',
                        appRoute: '/messages',
                        createdAt: null,
                        readAt: null,
                    },
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
            expect(navigateMock).toHaveBeenCalledWith('/messages');
            expect(onClose).toHaveBeenCalled();
        });
        expect(navigateMock.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
    });

    it('logs Firestore subscription errors when no error callback is provided', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const subscriptionError = new Error('subscription failed');

        subscribeToNotificationInbox('user-1', vi.fn());

        const errorHandler = firebaseMocks.onSnapshot.mock.calls[0][2] as (error: unknown) => void;
        errorHandler(subscriptionError);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to subscribe to notification inbox:',
            subscriptionError
        );
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
                    {
                        id: 'notif-2',
                        type: 'game_update',
                        text: 'Game rescheduled',
                        appRoute: '/schedule',
                        createdAt: null,
                        readAt: null,
                    },
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
});
