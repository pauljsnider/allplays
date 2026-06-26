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
    let pendingPayload = null;
    let activeSavePromise = null;

    async function executeSave(teamId, gameId, gamePlan) {
        if (!gameId) {
            return;
        }

        onStatusChange?.('saving');
        activeSavePromise = (async () => {
            await updateGame(teamId, gameId, { gamePlan });
        })();

        try {
            await activeSavePromise;
            hasPendingSave = false;
            onStatusChange?.('saved');
        } catch (err) {
            console.error('Auto-save failed:', err);
            onStatusChange?.('error');
        } finally {
            activeSavePromise = null;
        }
    }

    function scheduleSave(teamId, gameId, gamePlan, game) {
        if (!gameId || game?.isCalendar || game?.isSharedGame) return;
        hasPendingSave = true;
        pendingPayload = { teamId, gameId, gamePlan };
        onStatusChange?.('unsaved');
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const payload = pendingPayload;
            pendingPayload = null;
            if (payload) {
                return executeSave(payload.teamId, payload.gameId, payload.gamePlan);
            }
            return undefined;
        }, delay);
    }

    async function flush(teamId, gameId, gamePlan, game) {
        if (!gameId || game?.isCalendar || game?.isSharedGame) return;

        if (timer) {
            clearTimeout(timer);
            timer = null;
            const payload = pendingPayload ?? { teamId, gameId, gamePlan };
            pendingPayload = null;
            await executeSave(payload.teamId, payload.gameId, payload.gamePlan);
            return;
        }

        if (activeSavePromise) {
            await activeSavePromise;
        }
    }

    function cancel() {
        clearTimeout(timer);
        timer = null;
        pendingPayload = null;
        hasPendingSave = false;
    }

    function isPending() {
        return hasPendingSave;
    }

    return { scheduleSave, flush, cancel, isPending };
}
