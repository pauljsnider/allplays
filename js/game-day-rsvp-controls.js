function getStatusElement(documentRef) {
    return documentRef.getElementById('coach-rsvp-status');
}

export function createGameDayRsvpController({
    state,
    documentRef = document,
    escapeHtml,
    submitRsvpForPlayer,
    loadRsvps,
    setTimeoutFn = setTimeout,
    consoleRef = console
}) {
    function renderRsvpPanel() {
        const breakdown = state.rsvpBreakdown;
        if (!breakdown) return;
        const el = documentRef.getElementById('rsvp-panel');
        if (!el) return;

        const going = Array.isArray(breakdown.going) ? breakdown.going : [];
        const maybe = Array.isArray(breakdown.maybe) ? breakdown.maybe : [];
        const notGoing = Array.isArray(breakdown.not_going) ? breakdown.not_going : [];
        const noResponse = Array.isArray(breakdown.not_responded) ? breakdown.not_responded : [];

        const rowActions = (player, currentResponse) => {
            const mkBtn = (label, response, activeClass, idleClass) => `
                <button
                    onclick="setCoachPlayerRsvp(decodeURIComponent('${encodeURIComponent(player.playerId || '')}'),'${response}')"
                    class="px-1.5 py-0.5 rounded border text-[10px] font-semibold ${currentResponse === response ? activeClass : idleClass}">
                    ${label}
                </button>`;
            return `
                <span class="ml-1 inline-flex items-center gap-1">
                    ${mkBtn('Going', 'going', 'bg-green-600 text-white border-green-600', 'bg-white text-green-700 border-green-300 hover:bg-green-50')}
                    ${mkBtn('Maybe', 'maybe', 'bg-amber-500 text-white border-amber-500', 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50')}
                    ${mkBtn('Out', 'not_going', 'bg-red-500 text-white border-red-500', 'bg-white text-red-700 border-red-300 hover:bg-red-50')}
                </span>
            `;
        };

        const chip = (player, responseKey) => `
            <span class="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-full text-xs font-medium">
                ${player.playerNumber ? `#${player.playerNumber} ` : ''}${escapeHtml(player.playerName)}
                ${rowActions(player, responseKey)}
            </span>
        `;

        const section = (label, color, players) => {
            if (!players.length) return '';
            return `<div class="mb-2">
                <div class="text-xs font-semibold ${color} mb-1">${label} (${players.length})</div>
                <div class="flex flex-wrap gap-1">${players.map((player) => chip(player, player.response)).join('')}</div>
            </div>`;
        };

        el.innerHTML =
            section('Going', 'text-green-600', going) +
            section('Maybe', 'text-amber-600', maybe) +
            section('Not Going', 'text-red-500', notGoing) +
            section('No Response', 'text-gray-400', noResponse) +
            '<div id="coach-rsvp-status" class="text-[11px] text-gray-400 mt-2"></div>';
    }

    async function setCoachPlayerRsvp(playerId, response) {
        const statusEl = getStatusElement(documentRef);
        if (!playerId || !response) return;
        try {
            if (statusEl) statusEl.textContent = 'Saving availability...';
            await submitRsvpForPlayer(state.teamId, state.gameId, state.user?.uid, {
                displayName: state.user?.displayName || state.user?.email || null,
                playerId,
                response
            });
            const reloadSucceeded = await loadRsvps();
            if (reloadSucceeded === false) {
                throw new Error('RSVP reload failed');
            }
            renderRsvpPanel();
            const nextStatusEl = getStatusElement(documentRef);
            if (nextStatusEl) nextStatusEl.textContent = 'Saved';
            setTimeoutFn(() => {
                const currentStatusEl = getStatusElement(documentRef);
                if (currentStatusEl) currentStatusEl.textContent = '';
            }, 1800);
        } catch (err) {
            consoleRef.error('setCoachPlayerRsvp error', err);
            const nextStatusEl = getStatusElement(documentRef);
            if (nextStatusEl) nextStatusEl.textContent = 'Save failed';
        }
    }

    return {
        renderRsvpPanel,
        setCoachPlayerRsvp
    };
}
