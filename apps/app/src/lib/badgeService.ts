import { Capacitor } from '@capacitor/core';
import { loadChatInbox, markTeamChatRead } from './chatService';
import type { AuthUser } from './types';

function isNativeRuntime(): boolean {
    return Capacitor.isNativePlatform() || window.location.protocol === 'capacitor:';
}

/**
 * Update the native app icon badge count to reflect unread chat messages.
 * On web/non-native platforms this is a no-op.
 * Uses a dynamic import so the web build is unaffected if @capawesome/capacitor-badge
 * is not installed.
 */
export async function updateAppIconBadge(count: number): Promise<void> {
    if (!isNativeRuntime()) return;
    try {
        const { Badge } = await import('@capawesome/capacitor-badge');
        if (count > 0) {
            await Badge.set({ count });
        } else {
            await Badge.clear();
        }
    } catch {
        // Badge plugin not available or permission denied — ignore silently.
    }
}

export async function refreshUnreadChatBadge(user: AuthUser | null): Promise<void> {
    if (!user?.uid || !isNativeRuntime()) return;
    const result = await loadChatInbox(user, { includeLastMessages: false });
    const totalUnread = result.teams.reduce((sum, team) => sum + team.unreadCount, 0);
    await updateAppIconBadge(totalUnread);
}

export async function markTeamChatReadAndRefreshBadge(user: AuthUser | null, teamId: string): Promise<void> {
    if (!user?.uid || !teamId) return;
    await markTeamChatRead(user.uid, teamId);
    try {
        await refreshUnreadChatBadge(user);
    } catch {
        // The chat read succeeded. Ignore badge refresh failures.
    }
}
