import { describe, expect, it } from 'vitest';
import { resolveNativeDeepLinkRoute } from '../../apps/app/src/lib/nativeDeepLinkRouting';

describe('native deep link routing', () => {
    it('maps universal app links to HashRouter routes', () => {
        expect(resolveNativeDeepLinkRoute('https://allplays.ai/app/schedule/team-1/event-1?source=share')).toBe('/schedule/team-1/event-1?source=share');
        expect(resolveNativeDeepLinkRoute('https://allplays.ai/app#/accept-invite?code=ABC&type=parent')).toBe('/accept-invite?code=ABC&type=parent');
    });

    it('maps custom scheme links to app routes', () => {
        expect(resolveNativeDeepLinkRoute('allplays://messages/team-1')).toBe('/messages/team-1');
        expect(resolveNativeDeepLinkRoute('ai.allplays.lite://app#/teams/browse')).toBe('/teams/browse');
    });

    it('ignores links outside the app surface', () => {
        expect(resolveNativeDeepLinkRoute('https://allplays.ai/team.html#teamId=team-1')).toBeNull();
        expect(resolveNativeDeepLinkRoute('https://example.com/app/schedule')).toBeNull();
        expect(resolveNativeDeepLinkRoute('not a url')).toBeNull();
    });
});
