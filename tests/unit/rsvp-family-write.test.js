import { describe, expect, it, vi } from 'vitest';
import { commitFamilyRsvpWrite } from '../../js/rsvp-family-write.js';

function createHarness(commit = vi.fn().mockResolvedValue(undefined)) {
    const batch = {
        set: vi.fn(),
        delete: vi.fn(),
        commit
    };
    const writeBatch = vi.fn(() => batch);
    const doc = vi.fn((_db, path, id) => ({ path: `${path}/${id}` }));
    return { batch, writeBatch, doc };
}

describe('family RSVP atomic write', () => {
    it('sets the grouped RSVP and note while deleting both child override collections in one batch', async () => {
        const { batch, writeBatch, doc } = createHarness();
        const rsvpPayload = { userId: 'parent-1', playerIds: ['player-1', 'player-2'], response: 'going' };
        const notePayload = { ...rsvpPayload, note: 'Both need a ride', visibility: 'admins' };

        await commitFamilyRsvpWrite({
            db: {},
            writeBatch,
            doc,
            teamId: 'team-1',
            gameId: 'game-1',
            userId: 'parent-1',
            childIds: ['player-1', 'player-2', 'player-1', ''],
            rsvpPayload,
            notePayload
        });

        expect(writeBatch).toHaveBeenCalledTimes(1);
        expect(batch.set).toHaveBeenCalledTimes(2);
        expect(batch.set).toHaveBeenNthCalledWith(1, { path: 'teams/team-1/games/game-1/rsvps/parent-1' }, rsvpPayload);
        expect(batch.set).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/games/game-1/rsvpNotes/parent-1' }, notePayload);
        expect(batch.delete).toHaveBeenCalledTimes(4);
        expect(batch.delete).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1/rsvps/parent-1__player-1' });
        expect(batch.delete).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1/rsvpNotes/parent-1__player-1' });
        expect(batch.delete).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1/rsvps/parent-1__player-2' });
        expect(batch.delete).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1/rsvpNotes/parent-1__player-2' });
        expect(batch.commit).toHaveBeenCalledTimes(1);
    });

    it('rejects when the single atomic commit fails', async () => {
        const commitError = new Error('commit failed');
        const { batch, writeBatch, doc } = createHarness(vi.fn().mockRejectedValue(commitError));

        await expect(commitFamilyRsvpWrite({
            db: {},
            writeBatch,
            doc,
            teamId: 'team-1',
            gameId: 'game-1',
            userId: 'parent-1',
            childIds: ['player-1', 'player-2'],
            rsvpPayload: { response: 'maybe' },
            notePayload: { response: 'maybe', note: null }
        })).rejects.toBe(commitError);

        expect(batch.commit).toHaveBeenCalledTimes(1);
    });
});
