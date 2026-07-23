import { AlertCircle, Bell, CheckCheck, Loader2, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NotificationInboxItem } from '../lib/notificationInboxService';
import { formatNotificationRecency, normalizeNotificationTimestamp } from '../lib/notificationRecency';

interface NotificationInboxSheetProps {
    items: NotificationInboxItem[];
    inboxState: 'loading' | 'ready' | 'error';
    uid: string;
    onClose: () => void;
    onRetry?: () => void;
    onMarkRead: (uid: string, itemId: string) => Promise<void>;
    onMarkAllRead?: (uid: string, items: NotificationInboxItem[]) => Promise<void>;
}

export function NotificationInboxSheet({ items, inboxState, uid, onClose, onRetry, onMarkRead, onMarkAllRead }: NotificationInboxSheetProps) {
    const navigate = useNavigate();
    const [optimisticallyReadIds, setOptimisticallyReadIds] = useState<Set<string>>(() => new Set());
    const [markAllState, setMarkAllState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
    const unreadItems = items.filter((item) => !item.readAt && !optimisticallyReadIds.has(item.id));

    const handleItemClick = (item: NotificationInboxItem) => {
        if (item.appRoute) {
            navigate(item.appRoute);
        }
        onClose();

        if (!item.readAt) {
            void onMarkRead(uid, item.id).catch((error) => {
                console.error('Failed to mark notification read:', error);
            });
        }
    };

    const handleMarkAllRead = async () => {
        if (!onMarkAllRead || unreadItems.length === 0 || markAllState === 'pending') return;

        const itemsToMarkRead = unreadItems;
        setOptimisticallyReadIds((current) => {
            const next = new Set(current);
            itemsToMarkRead.forEach((item) => next.add(item.id));
            return next;
        });
        setMarkAllState('pending');

        try {
            await onMarkAllRead(uid, itemsToMarkRead);
            setMarkAllState('success');
        } catch (error) {
            setOptimisticallyReadIds((current) => {
                const next = new Set(current);
                itemsToMarkRead.forEach((item) => next.delete(item.id));
                return next;
            });
            setMarkAllState('error');
            console.error('Failed to mark notifications read:', error);
        }
    };

    const renderBody = () => {
        if (inboxState === 'loading' && items.length === 0) {
            return (
                <div
                    className="flex flex-col items-center gap-3 px-4 py-12 text-center"
                    data-testid="notification-inbox-loading"
                    aria-label="Loading notifications"
                >
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" aria-hidden="true" />
                    <p className="text-sm font-semibold text-gray-500">Loading notifications…</p>
                </div>
            );
        }

        if (inboxState === 'error' && items.length === 0) {
            return (
                <div
                    className="flex flex-col items-center gap-3 px-4 py-12 text-center"
                    data-testid="notification-inbox-error"
                >
                    <AlertCircle className="h-10 w-10 text-red-300" aria-hidden="true" />
                    <p className="text-sm font-semibold text-gray-500">Could not load notifications</p>
                    <p className="text-xs text-gray-400">Check your connection and try again.</p>
                    {onRetry ? (
                        <button
                            type="button"
                            className="primary-button !h-10 !min-h-10 text-sm"
                            onClick={onRetry}
                            data-testid="notification-inbox-retry"
                        >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            Retry
                        </button>
                    ) : null}
                </div>
            );
        }

        if (items.length === 0) {
            return (
                <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                    <Bell className="h-10 w-10 text-gray-300" aria-hidden="true" />
                    <p className="text-sm font-semibold text-gray-500">No notifications yet</p>
                </div>
            );
        }

        return (
            <>
                {markAllState === 'error' ? (
                    <div
                        className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700"
                        role="alert"
                        data-testid="notification-mark-all-error"
                    >
                        <AlertCircle className="h-4 w-4 flex-none" aria-hidden="true" />
                        <span>Could not mark all as read. Please try again.</span>
                    </div>
                ) : null}
                {inboxState === 'error' && (
                    <div
                        className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-semibold text-red-600"
                        data-testid="notification-inbox-error-banner"
                    >
                        <AlertCircle className="h-4 w-4 flex-none" aria-hidden="true" />
                        <span className="min-w-0 flex-1">Could not refresh — showing cached notifications.</span>
                        {onRetry ? (
                            <button
                                type="button"
                                className="ghost-button !h-8 !min-h-8 flex-none !border-red-200 !bg-white !px-2 !text-xs !text-red-700 hover:!bg-red-50"
                                onClick={onRetry}
                                data-testid="notification-inbox-retry"
                            >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                Retry
                            </button>
                        ) : null}
                    </div>
                )}
                <ul role="list" className="divide-y divide-gray-100">
                    {items.map((item) => {
                        const isUnread = !item.readAt && !optimisticallyReadIds.has(item.id);
                        const createdAt = normalizeNotificationTimestamp(item.createdAt);
                        const recencyLabel = formatNotificationRecency(createdAt);
                        return (
                            <li key={item.id}>
                                <button
                                    type="button"
                                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-gray-50 ${isUnread ? 'bg-primary-50' : ''}`}
                                    onClick={() => void handleItemClick(item)}
                                    data-testid={`notification-item-${item.id}`}
                                >
                                    {isUnread && (
                                        <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-primary-500" aria-label="Unread" />
                                    )}
                                    {!isUnread && <span className="mt-1.5 h-2 w-2 flex-none" />}
                                    <span className="min-w-0 flex-1">
                                        <span className={`block text-sm leading-snug ${isUnread ? 'font-bold text-gray-950' : 'font-semibold text-gray-700'}`}>
                                            {item.text}
                                        </span>
                                        {item.type || recencyLabel ? (
                                            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs font-medium text-gray-400">
                                                {item.type ? (
                                                    <span className="min-w-0 flex-1 truncate capitalize">
                                                        {item.type.replace(/_/g, ' ')}
                                                    </span>
                                                ) : null}
                                                {recencyLabel && createdAt ? (
                                                    <time
                                                        className="flex-none"
                                                        dateTime={createdAt.toISOString()}
                                                        title={createdAt.toLocaleString()}
                                                    >
                                                        {recencyLabel}
                                                    </time>
                                                ) : null}
                                            </span>
                                        ) : null}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </>
        );
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end bg-gray-950/40 p-3 backdrop-blur-sm sm:items-center sm:justify-center"
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
        >
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-app-lg">
                <div className="flex items-center justify-between border-b border-gray-200 p-4">
                    <div>
                        <div className="app-label">Inbox</div>
                        <h2 className="text-lg font-black text-gray-950">Notifications</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {markAllState === 'pending' ? (
                            <button
                                type="button"
                                className="ghost-button !h-10 !min-h-10 text-xs"
                                disabled
                                aria-label="Marking all notifications as read"
                            >
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                Marking read…
                            </button>
                        ) : unreadItems.length > 0 && onMarkAllRead ? (
                            <button
                                type="button"
                                className="ghost-button !h-10 !min-h-10 text-xs"
                                onClick={() => void handleMarkAllRead()}
                            >
                                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                                Mark all read
                            </button>
                        ) : markAllState === 'success' ? (
                            <span
                                className="flex h-10 items-center gap-1.5 px-2 text-xs font-bold text-emerald-700"
                                role="status"
                                aria-live="polite"
                            >
                                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                                All read
                            </span>
                        ) : null}
                        <button
                            type="button"
                            className="ghost-button !h-10 !min-h-10 !w-10 !p-0"
                            onClick={onClose}
                            aria-label="Close notifications"
                        >
                            <X className="h-5 w-5" aria-hidden="true" />
                        </button>
                    </div>
                </div>

                <div className="max-h-[70vh] overflow-y-auto">
                    {renderBody()}
                </div>
            </div>
        </div>
    );
}
