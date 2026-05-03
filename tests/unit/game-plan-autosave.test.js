import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutoSaveController } from '../../js/game-plan-autosave.js';

describe('createAutoSaveController', () => {
    let updateGame;
    let onStatusChange;
    let autoSave;

    beforeEach(() => {
        vi.useFakeTimers();
        updateGame = vi.fn().mockResolvedValue(undefined);
        onStatusChange = vi.fn();
        autoSave = createAutoSaveController({ updateGame, onStatusChange, delay: 1500 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('scheduleSave — guard conditions', () => {
        it('does nothing when gameId is falsy', () => {
            autoSave.scheduleSave('team-1', null, {}, {});
            vi.runAllTimers();
            expect(updateGame).not.toHaveBeenCalled();
            expect(onStatusChange).not.toHaveBeenCalled();
        });

        it('does nothing for a calendar game', () => {
            autoSave.scheduleSave('team-1', 'game-1', {}, { isCalendar: true });
            vi.runAllTimers();
            expect(updateGame).not.toHaveBeenCalled();
            expect(onStatusChange).not.toHaveBeenCalled();
        });

        it('does nothing for a shared game', () => {
            autoSave.scheduleSave('team-1', 'game-1', {}, { isSharedGame: true });
            vi.runAllTimers();
            expect(updateGame).not.toHaveBeenCalled();
            expect(onStatusChange).not.toHaveBeenCalled();
        });
    });

    describe('scheduleSave — happy path', () => {
        it('immediately signals unsaved status', () => {
            autoSave.scheduleSave('team-1', 'game-1', { lineups: {} }, {});
            expect(onStatusChange).toHaveBeenCalledWith('unsaved');
        });

        it('marks isPending true right after scheduling', () => {
            autoSave.scheduleSave('team-1', 'game-1', { lineups: {} }, {});
            expect(autoSave.isPending()).toBe(true);
        });

        it('signals saving then saved after the debounce delay', async () => {
            autoSave.scheduleSave('team-1', 'game-1', { lineups: {} }, {});
            await vi.runAllTimersAsync();
            expect(onStatusChange).toHaveBeenCalledWith('saving');
            expect(onStatusChange).toHaveBeenCalledWith('saved');
            expect(onStatusChange).toHaveBeenCalledTimes(3); // unsaved, saving, saved
        });

        it('calls updateGame with the correct arguments', async () => {
            const gamePlan = { lineups: { '1-7-pg': 'player-1' } };
            autoSave.scheduleSave('team-1', 'game-1', gamePlan, {});
            await vi.runAllTimersAsync();
            expect(updateGame).toHaveBeenCalledWith('team-1', 'game-1', { gamePlan });
        });

        it('clears isPending after a successful save', async () => {
            autoSave.scheduleSave('team-1', 'game-1', { lineups: {} }, {});
            await vi.runAllTimersAsync();
            expect(autoSave.isPending()).toBe(false);
        });
    });

    describe('scheduleSave — debounce', () => {
        it('debounces rapid calls into a single updateGame call', async () => {
            const gamePlan = { lineups: {} };
            autoSave.scheduleSave('team-1', 'game-1', gamePlan, {});
            autoSave.scheduleSave('team-1', 'game-1', gamePlan, {});
            autoSave.scheduleSave('team-1', 'game-1', gamePlan, {});
            await vi.runAllTimersAsync();
            expect(updateGame).toHaveBeenCalledTimes(1);
        });

        it('uses the gamePlan from the final call', async () => {
            autoSave.scheduleSave('team-1', 'game-1', { lineups: { a: 'p1' } }, {});
            const finalPlan = { lineups: { a: 'p2' } };
            autoSave.scheduleSave('team-1', 'game-1', finalPlan, {});
            await vi.runAllTimersAsync();
            expect(updateGame).toHaveBeenCalledWith('team-1', 'game-1', { gamePlan: finalPlan });
        });
    });

    describe('scheduleSave — error handling', () => {
        it('signals error status when updateGame rejects', async () => {
            updateGame.mockRejectedValue(new Error('Firestore unavailable'));
            autoSave.scheduleSave('team-1', 'game-1', { lineups: {} }, {});
            await vi.runAllTimersAsync();
            expect(onStatusChange).toHaveBeenCalledWith('error');
        });

        it('keeps isPending true after a failed save', async () => {
            updateGame.mockRejectedValue(new Error('network'));
            autoSave.scheduleSave('team-1', 'game-1', { lineups: {} }, {});
            await vi.runAllTimersAsync();
            expect(autoSave.isPending()).toBe(true);
        });

        it('does not signal saved after an error', async () => {
            updateGame.mockRejectedValue(new Error('network'));
            autoSave.scheduleSave('team-1', 'game-1', { lineups: {} }, {});
            await vi.runAllTimersAsync();
            const calls = onStatusChange.mock.calls.map(([s]) => s);
            expect(calls).not.toContain('saved');
        });
    });

    describe('cancel', () => {
        it('prevents a pending save from firing', async () => {
            autoSave.scheduleSave('team-1', 'game-1', { lineups: {} }, {});
            autoSave.cancel();
            await vi.runAllTimersAsync();
            expect(updateGame).not.toHaveBeenCalled();
        });

        it('resets isPending to false', () => {
            autoSave.scheduleSave('team-1', 'game-1', { lineups: {} }, {});
            autoSave.cancel();
            expect(autoSave.isPending()).toBe(false);
        });
    });

    describe('onStatusChange optional', () => {
        it('does not throw when onStatusChange is not provided', async () => {
            const bare = createAutoSaveController({ updateGame, delay: 1500 });
            bare.scheduleSave('team-1', 'game-1', { lineups: {} }, {});
            await expect(vi.runAllTimersAsync()).resolves.not.toThrow();
        });
    });
});
