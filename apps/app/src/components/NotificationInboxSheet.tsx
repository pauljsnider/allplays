import { AlertCircle, Bell, CheckCheck, Loader2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { NotificationInboxItem } from '../lib/notificationInboxService';

interface NotificationInboxSheetProps {
    items: NotificationInboxItem[];
    inboxState: 'loading' | 'ready' | 'error';
    uid: string;
    onClose: () => void;
    onMarkRead: (uid: string, itemId: string) => Promise<void>;
    onMarkAllRead?: (uid: string, items: NotificationInboxItem[]) => Promise<void>;
}

export function NotificationInboxSheet({ items, inboxState, uid, onClose, onMarkRead, onMarkAllRead }: NotificationInboxSheetProps) {
    const navigate = useNavigate();
    const unreadItems = items.filter((item) => !item.readAt);

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

    const handleMarkAllRead = () => {
        if (!onMarkAllRead || unreadItems.length === 0) return;
        void onMarkAllRead(uid, unreadItems).catch((error) => {
            console.error('Failed to mark notifications read:', error);
        });
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
                {inboxState === 'error' && (
                    <div
                        className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-semibold text-red-600"
                        data-testid="notification-inbox-error-banner"
                    >
                        <AlertCircle className="h-4 w-4 flex-none" aria-hidden="true" />
                        Could not refresh — showing cached notifications.
                    </div>
                )}
                <ul role="list" className="divide-y divide-gray-100">
                    {items.map((item) => {
                        const isUnread = !item.readAt;
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
                                        {item.type ? (
                                            <span className="mt-0.5 block text-xs font-medium text-gray-400 capitalize">
                                                {item.type.replace(/_/g, ' ')}
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
                        {unreadItems.length > 0 && onMarkAllRead ? (
                            <button
                                type="button"
                                className="ghost-button !h-10 !min-h-10 text-xs"
                                onClick={handleMarkAllRead}
                            >
                                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                                Mark all read
                            </button>
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
