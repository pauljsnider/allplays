import { describe, it, expect } from 'vitest';
import { shouldUpdateChatLastRead } from '../../js/team-chat-last-read.js';

describe('team chat last-read snapshot policy', () => {
    it('updates last-read when user/team context exists and chat is actively visible/focused', () => {
        expect(shouldUpdateChatLastRead({
            hasCurrentUser: true,
            hasTeamId: true,
            isPageVisible: true,
            isWindowFocused: true
        })).toBe(true);
    });

    it('does not update when page is not visible', () => {
        expect(shouldUpdateChatLastRead({
            hasCurrentUser: true,
            hasTeamId: true,
            isPageVisible: false,
            isWindowFocused: true
        })).toBe(false);
    });

    it('does not update when window is not focused', () => {
        expect(shouldUpdateChatLastRead({
            hasCurrentUser: true,
            hasTeamId: true,
            isPageVisible: true,
            isWindowFocused: false
        })).toBe(false);
    });

    it('does not update when user context is missing', () => {
        expect(shouldUpdateChatLastRead({
            hasCurrentUser: false,
            hasTeamId: true,
            isPageVisible: true,
            isWindowFocused: true
        })).toBe(false);
    });

    it('does not update when team context is missing', () => {
        expect(shouldUpdateChatLastRead({
            hasCurrentUser: true,
            hasTeamId: false,
            isPageVisible: true,
            isWindowFocused: true
        })).toBe(false);
    });
});
