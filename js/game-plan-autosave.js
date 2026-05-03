/**
 * Creates a debounced auto-save controller for the game plan editor.
 *
 * @param {object} opts
 * @param {Function} opts.updateGame - (teamId, gameId, data) => Promise
 * @param {Function} [opts.onStatusChange] - (status: 'unsaved'|'saving'|'saved'|'error') => void
 * @param {number} [opts.delay] - debounce ms (default 1500)
 */
export function createAutoSaveController({ updateGame, onStatusChange, delay = 1500 } = {}) {
    let timer = null;
    let hasPendingSave = false;

    async function executeSave(teamId, gameId, gamePlan) {
        onStatusChange?.('saving');
        try {
            await updateGame(teamId, gameId, { gamePlan });
            hasPendingSave = false;
            onStatusChange?.('saved');
        } catch (err) {
            console.error('Auto-save failed:', err);
            onStatusChange?.('error');
        }
    }

    function scheduleSave(teamId, gameId, gamePlan, game) {
        if (!gameId || game?.isCalendar || game?.isSharedGame) return;
        hasPendingSave = true;
        onStatusChange?.('unsaved');
        clearTimeout(timer);
        timer = setTimeout(() => executeSave(teamId, gameId, gamePlan), delay);
    }

    function cancel() {
        clearTimeout(timer);
        hasPendingSave = false;
    }

    function isPending() {
        return hasPendingSave;
    }

    return { scheduleSave, cancel, isPending };
}
