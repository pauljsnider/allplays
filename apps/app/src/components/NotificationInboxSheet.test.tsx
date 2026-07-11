// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationInboxSheet } from './NotificationInboxSheet';
import type { NotificationInboxItem } from '../lib/notificationInboxService';
import { formatNotificationRecency, normalizeNotificationTimestamp } from '../lib/notificationRecency';

function notification(overrides: Partial<NotificationInboxItem>): NotificationInboxItem {
    return {
        id: 'notification-1',
        category: 'schedule_update',
        type: 'schedule_update',
        title: '',
        body: '',
        text: 'Practice moved to 6 PM',
        appRoute: '/schedule',
        conversationId: '',
        createdAt: null,
        readAt: null,
        ...overrides
    };
}

function LocationDisplay() {
    const location = useLocation();
    return <div data-testid="current-route">{location.pathname}</div>;
}

describe('notification recency', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('normalizes supported timestamp values and rejects missing or invalid values', () => {
        const expected = '2026-07-11T11:48:00.000Z';

        expect(normalizeNotificationTimestamp(new Date(expected))?.toISOString()).toBe(expected);
        expect(normalizeNotificationTimestamp({ toDate: () => new Date(expected) })?.toISOString()).toBe(expected);
        expect(normalizeNotificationTimestamp(expected)?.toISOString()).toBe(expected);
        expect(normalizeNotificationTimestamp({ seconds: 1_783_770_480 })?.toISOString()).toBe(expected);
        expect(normalizeNotificationTimestamp(1_783_770_480)?.toISOString()).toBe(expected);
        expect(normalizeNotificationTimestamp(null)).toBeNull();
        expect(normalizeNotificationTimestamp('not-a-date')).toBeNull();
    });

    it('formats compact relative labels and short dates', () => {
        expect(formatNotificationRecency('2026-07-11T11:59:30.000Z')).toBe('Just now');
        expect(formatNotificationRecency('2026-07-11T11:48:00.000Z')).toBe('12m');
        expect(formatNotificationRecency('2026-07-11T09:00:00.000Z')).toBe('3h');
        expect(formatNotificationRecency('2026-07-08T12:00:00.000Z')).toBe('Jul 8');
        expect(formatNotificationRecency('invalid')).toBe('');
    });

    it('renders recency beside notification metadata and preserves unread navigation behavior', () => {
        const onClose = vi.fn();
        const onMarkRead = vi.fn(() => Promise.resolve());
        const items = [
            notification({ id: 'recent', createdAt: { seconds: 1_783_770_480 } }),
            notification({
                id: 'older',
                text: 'Registration fee is due',
                type: 'fee_alert',
                createdAt: new Date('2026-07-08T12:00:00.000Z'),
                readAt: new Date('2026-07-09T12:00:00.000Z')
            })
        ];

        render(
            <MemoryRouter initialEntries={['/home']}>
                <Routes>
                    <Route path="*" element={(
                        <>
                            <LocationDisplay />
                            <NotificationInboxSheet
                                items={items}
                                inboxState="ready"
                                uid="user-123"
                                onClose={onClose}
                                onMarkRead={onMarkRead}
                            />
                        </>
                    )} />
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByText('12m').tagName).toBe('TIME');
        expect(screen.getByText('Jul 8').tagName).toBe('TIME');
        expect(screen.getByText('schedule update')).toBeTruthy();
        expect(screen.getByText('fee alert')).toBeTruthy();

        fireEvent.click(screen.getByTestId('notification-item-recent'));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onMarkRead).toHaveBeenCalledWith('user-123', 'recent');
        expect(screen.getByTestId('current-route').textContent).toBe('/schedule');
    });

    it('renders invalid timestamps without a broken recency label', () => {
        render(
            <MemoryRouter>
                <NotificationInboxSheet
                    items={[notification({ createdAt: 'not-a-date' })]}
                    inboxState="ready"
                    uid="user-123"
                    onClose={vi.fn()}
                    onMarkRead={vi.fn(() => Promise.resolve())}
                />
            </MemoryRouter>
        );

        expect(screen.getByText('Practice moved to 6 PM')).toBeTruthy();
        expect(document.querySelector('time')).toBeNull();
    });
});
