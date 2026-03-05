import { describe, it, expect } from 'vitest';
import { shouldUpdateChatLastRead, shouldRetryChatLastReadOnViewReturn } from '../../js/team-chat-last-read.js';

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

    it('does not update when active-view gates are omitted', () => {
        expect(shouldUpdateChatLastRead({
            hasCurrentUser: true,
            hasTeamId: true
        })).toBe(false);
    });
});

describe('team chat last-read lifecycle retry policy', () => {
    it('retries last-read when user returns to an active chat view with messages loaded', () => {
        expect(shouldRetryChatLastReadOnViewReturn({
            hasCurrentUser: true,
            hasTeamId: true,
            isPageVisible: true,
            isWindowFocused: true,
            hasMessages: true
        })).toBe(true);
    });

    it('does not retry last-read when no messages are loaded', () => {
        expect(shouldRetryChatLastReadOnViewReturn({
            hasCurrentUser: true,
            hasTeamId: true,
            isPageVisible: true,
            isWindowFocused: true,
            hasMessages: false
        })).toBe(false);
    });
});
