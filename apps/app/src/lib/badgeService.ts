import { isNativeRuntime } from './nativeRuntime';
import type { NotificationInboxItem } from './notificationInboxService';

export function normalizeAppIconBadgeCount(count: unknown): number {
    const numericCount = typeof count === 'number' ? count : Number(count);
    if (!Number.isFinite(numericCount) || numericCount <= 0) {
        return 0;
    }
    return Math.floor(numericCount);
}

/**
 * Update the native app icon badge count.
 * On web/non-native platforms this is a no-op.
 * Uses a dynamic import so the web build is unaffected if @capawesome/capacitor-badge
 * is not installed.
 */
export async function updateAppIconBadge(count: number): Promise<void> {
    if (!isNativeRuntime()) return;
    try {
        const { Badge } = await import('@capawesome/capacitor-badge');
        const normalizedCount = normalizeAppIconBadgeCount(count);
        if (normalizedCount > 0) {
            await Badge.set({ count: normalizedCount });
        } else {
            await Badge.clear();
        }
    } catch {
        // Badge plugin not available or permission denied — ignore silently.
    }
}

export function countUnreadNotificationInboxItems(items: NotificationInboxItem[]): number {
    return (Array.isArray(items) ? items : []).reduce((count, item) => {
        return item && !item.readAt ? count + 1 : count;
    }, 0);
}

export async function syncAppIconBadgeToNotificationInbox(items: NotificationInboxItem[]): Promise<void> {
    await updateAppIconBadge(countUnreadNotificationInboxItems(items));
}
