import { Capacitor } from '@capacitor/core';

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
