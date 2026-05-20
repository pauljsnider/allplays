export function isAISummaryEnabled(flagValue = globalThis.ALLPLAYS_ENABLE_AI_SUMMARY) {
    return flagValue === true;
}

export function applyAISummaryAvailability({ button, loadingDiv, enabled }) {
    if (!button) {
        return;
    }

    if (enabled) {
        button.classList.remove('hidden');
        button.disabled = false;
        button.removeAttribute('aria-disabled');
        return;
    }

    button.classList.add('hidden');
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');

    if (loadingDiv) {
        loadingDiv.classList.add('hidden');
    }
}
