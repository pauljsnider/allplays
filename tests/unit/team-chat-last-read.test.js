import { describe, it, expect } from 'vitest';
import { shouldUpdateChatLastRead } from '../../js/team-chat-last-read.js';

describe('team chat last-read snapshot policy', () => {
    it('updates last-read on initial realtime snapshot when user and team are present', () => {
        expect(shouldUpdateChatLastRead({
            hasCurrentUser: true,
            hasTeamId: true,
            initialSnapshotLoaded: false
        })).toBe(true);
    });

    it('updates last-read on subsequent realtime snapshots during active session', () => {
        expect(shouldUpdateChatLastRead({
            hasCurrentUser: true,
            hasTeamId: true,
            initialSnapshotLoaded: true
        })).toBe(true);
    });

    it('does not update when user context is missing', () => {
        expect(shouldUpdateChatLastRead({
            hasCurrentUser: false,
            hasTeamId: true,
            initialSnapshotLoaded: true
        })).toBe(false);
    });

    it('does not update when team context is missing', () => {
        expect(shouldUpdateChatLastRead({
            hasCurrentUser: true,
            hasTeamId: false,
            initialSnapshotLoaded: true
        })).toBe(false);
    });
});
