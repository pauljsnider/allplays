import { describe, expect, it, vi } from 'vitest';
import { addNativeDeepLinkListener, resolveNativeDeepLinkRoute } from '../../apps/app/src/lib/nativeDeepLinkRouting';

describe('native deep link routing', () => {
    it('maps universal app links to HashRouter routes', () => {
        expect(resolveNativeDeepLinkRoute('https://allplays.ai/app/schedule/team-1/event-1?source=share')).toBe('/schedule/team-1/event-1?source=share');
        expect(resolveNativeDeepLinkRoute('https://allplays.ai/app#/accept-invite?code=ABC&type=parent')).toBe('/accept-invite?code=ABC&type=parent');
        expect(resolveNativeDeepLinkRoute('https://allplays.ai/app#/reset-password?mode=resetPassword&oobCode=valid-code')).toBe('/reset-password?mode=resetPassword&oobCode=valid-code');
    });

    it('maps custom scheme links to app routes', () => {
        expect(resolveNativeDeepLinkRoute('allplays://messages/team-1')).toBe('/messages/team-1');
        expect(resolveNativeDeepLinkRoute('ai.allplays.lite://app#/teams/browse')).toBe('/teams/browse');
    });

    it('ignores links outside the app surface', () => {
        expect(resolveNativeDeepLinkRoute('https://allplays.ai/team.html#teamId=team-1')).toBeNull();
        expect(resolveNativeDeepLinkRoute('https://example.com/app/schedule')).toBeNull();
        expect(resolveNativeDeepLinkRoute('http://allplays.ai/app/schedule')).toBeNull();
        expect(resolveNativeDeepLinkRoute('https://user:password@allplays.ai/app/schedule')).toBeNull();
        expect(resolveNativeDeepLinkRoute('https://allplays.ai:8443/app/schedule')).toBeNull();
        expect(resolveNativeDeepLinkRoute('https://allplays.ai/app\\schedule')).toBeNull();
        expect(resolveNativeDeepLinkRoute('not a url')).toBeNull();
    });

    it('does not accept Firebase action codes through hijackable custom URL schemes', () => {
        expect(resolveNativeDeepLinkRoute('allplays://reset-password?mode=resetPassword&oobCode=secret-code')).toBeNull();
        expect(resolveNativeDeepLinkRoute('ai.allplays.lite://app#/reset-password?oobCode=secret-code')).toBeNull();
        expect(resolveNativeDeepLinkRoute('allplays://accept-invite?mode=verifyEmail&oobCode=secret-code')).toBeNull();
    });

    it('routes a verified cold-start launch URL after registering the foreground listener', async () => {
        const onRoute = vi.fn();
        let foregroundListener: ((event: { url?: string }) => void) | undefined;
        const remove = vi.fn();
        const appPlugin = {
            addListener: vi.fn(async (_eventName: 'appUrlOpen', listener: (event: { url?: string }) => void) => {
                foregroundListener = listener;
                return { remove };
            }),
            getLaunchUrl: vi.fn(async () => ({ url: 'https://allplays.ai/app/schedule/team-1' }))
        };

        const dispose = await addNativeDeepLinkListener(onRoute, {
            appPlugin,
            isNativePlatform: () => true,
            isPluginAvailable: () => true
        });

        expect(appPlugin.addListener).toHaveBeenCalledBefore(appPlugin.getLaunchUrl);
        expect(onRoute).toHaveBeenCalledWith('/schedule/team-1');
        foregroundListener?.({ url: 'https://allplays.ai/app/messages/team-1' });
        expect(onRoute).toHaveBeenLastCalledWith('/messages/team-1');
        dispose();
        expect(remove).toHaveBeenCalledTimes(1);
    });
});
