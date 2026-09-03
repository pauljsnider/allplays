import { PREMIUM_ACCESS_CONFIG_PATH } from './premium-access-core.js?v=1';
import { readPremiumAccessConfig } from './premium-access.js?v=8';

async function loadFirebase(deps = {}) {
    if (deps.firebase) return deps.firebase;
    return import('./firebase.js?v=34');
}

function unavailableConfig(reason) {
    return {
        state: 'unavailable',
        openToAll: false,
        reason
    };
}

export function getPremiumAccessToggleConfirmation(openToAll) {
    if (openToAll === true) {
        return 'Turn on premium access for everyone? Premium features will be unlocked immediately for users who already have normal access.';
    }
    return 'Turn off premium access for everyone? Users without a valid premium entitlement will lose access to premium features.';
}

export function buildPremiumAccessControlView(config, {
    busy = false,
    busyLabel = '',
    feedback = '',
    feedbackTone = 'neutral'
} = {}) {
    const ready = config?.state === 'ready';
    const openToAll = ready && config.openToAll === true;

    if (!ready) {
        return {
            state: busy ? 'loading' : 'unavailable',
            openToAll: false,
            statusLabel: busy ? 'Loading' : 'Unavailable',
            summary: busy
                ? 'Loading the current global premium setting...'
                : 'The current global premium setting could not be verified.',
            buttonLabel: busy ? (busyLabel || 'Loading...') : 'Retry current setting',
            buttonDisabled: busy,
            feedback,
            feedbackTone
        };
    }

    return {
        state: openToAll ? 'on' : 'off',
        openToAll,
        statusLabel: openToAll ? 'On' : 'Off',
        summary: openToAll
            ? 'Premium features are unlocked for everyone with normal access.'
            : 'Premium entitlements and Team Pass checks are active.',
        buttonLabel: busy
            ? (busyLabel || 'Saving...')
            : (openToAll ? 'Turn premium off' : 'Turn premium on'),
        buttonDisabled: busy,
        feedback,
        feedbackTone
    };
}

export async function updatePremiumAccessConfig({ openToAll, deps = {} } = {}) {
    if (typeof openToAll !== 'boolean') {
        throw new TypeError('openToAll must be a boolean');
    }

    let firebase;
    try {
        firebase = await loadFirebase(deps);
    } catch (error) {
        console.error('Unable to load Firebase for the premium access update:', error);
        return {
            state: 'unknown',
            reason: 'firebase-unavailable',
            config: unavailableConfig('global-config-write-unavailable')
        };
    }

    const configRef = firebase.doc(firebase.db, ...PREMIUM_ACCESS_CONFIG_PATH);
    let writeFailed = false;
    try {
        await firebase.setDoc(configRef, {
            openToAll,
            updatedAt: firebase.serverTimestamp()
        });
    } catch (error) {
        writeFailed = true;
        console.error('Unable to write the global premium access config:', error);
    }

    const config = await readPremiumAccessConfig({ deps: { firebase } });
    if (config.state === 'ready' && config.openToAll === openToAll) {
        return {
            state: 'confirmed',
            reason: writeFailed ? 'confirmed-after-write-error' : 'confirmed-after-write',
            config
        };
    }
    if (config.state === 'ready') {
        return {
            state: 'not-committed',
            reason: 'requested-state-not-observed',
            config
        };
    }
    return {
        state: 'unknown',
        reason: 'write-state-unverified',
        config
    };
}

function requireElement(root, id) {
    const element = root?.getElementById?.(id);
    if (!element) throw new Error(`Missing premium access control element: #${id}`);
    return element;
}

export function createAdminPremiumAccessControl({
    root = document,
    readConfig = () => readPremiumAccessConfig(),
    writeConfig = ({ openToAll }) => updatePremiumAccessConfig({ openToAll }),
    confirmChange = (message) => window.confirm(message)
} = {}) {
    const container = requireElement(root, 'premium-access-control');
    const status = requireElement(root, 'premium-access-status');
    const summary = requireElement(root, 'premium-access-summary');
    const button = requireElement(root, 'premium-access-toggle');
    const feedbackElement = requireElement(root, 'premium-access-feedback');
    let config = unavailableConfig('not-loaded');
    let busy = false;
    let busyLabel = '';
    let feedback = '';
    let feedbackTone = 'neutral';

    function render() {
        const view = buildPremiumAccessControlView(config, {
            busy,
            busyLabel,
            feedback,
            feedbackTone
        });
        const statusToneClass = view.state === 'on'
            ? 'bg-emerald-100 text-emerald-800'
            : (view.state === 'off' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700');
        const buttonToneClass = view.state === 'on'
            ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
            : 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500';
        const feedbackToneClass = view.feedbackTone === 'success'
            ? 'text-emerald-700'
            : (view.feedbackTone === 'error' ? 'text-red-700' : 'text-gray-600');
        container.dataset.state = view.state;
        status.dataset.state = view.state;
        status.className = `rounded-full px-2.5 py-1 text-xs font-semibold ${statusToneClass}`;
        status.textContent = view.statusLabel;
        summary.textContent = view.summary;
        button.className = `shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${buttonToneClass}`;
        button.textContent = view.buttonLabel;
        button.disabled = view.buttonDisabled;
        button.setAttribute('aria-pressed', String(view.openToAll));
        button.setAttribute('aria-busy', String(busy));
        feedbackElement.dataset.tone = view.feedbackTone;
        feedbackElement.className = `mt-3 min-h-5 text-sm ${feedbackToneClass}`;
        feedbackElement.textContent = view.feedback;
    }

    async function load({ nextFeedback = '', nextFeedbackTone = 'neutral' } = {}) {
        if (busy) return { state: 'busy', config };
        busy = true;
        busyLabel = 'Loading...';
        feedback = nextFeedback;
        feedbackTone = nextFeedbackTone;
        render();
        try {
            config = await readConfig();
        } catch (error) {
            console.error('Unable to load the admin premium access control:', error);
            config = unavailableConfig('global-config-read-failed');
        }
        busy = false;
        busyLabel = '';
        if (config?.state !== 'ready') {
            feedback = 'The current setting could not be loaded. Retry before making a change.';
            feedbackTone = 'error';
        }
        render();
        return { state: config?.state === 'ready' ? 'loaded' : 'unavailable', config };
    }

    async function toggle() {
        if (busy) return { state: 'busy', config };

        busy = true;
        busyLabel = 'Checking...';
        feedback = '';
        feedbackTone = 'neutral';
        render();

        let latestConfig;
        try {
            latestConfig = await readConfig();
        } catch (error) {
            console.error('Unable to refresh the premium access config before changing it:', error);
            latestConfig = unavailableConfig('global-config-read-failed');
        }

        if (latestConfig?.state !== 'ready') {
            config = latestConfig;
            busy = false;
            busyLabel = '';
            feedback = 'No change was made because the current setting could not be verified.';
            feedbackTone = 'error';
            render();
            return { state: 'unavailable', config };
        }

        const openToAll = latestConfig.openToAll !== true;
        const confirmed = await Promise.resolve(confirmChange(getPremiumAccessToggleConfirmation(openToAll)));
        if (!confirmed) {
            config = latestConfig;
            busy = false;
            busyLabel = '';
            feedback = 'No change made.';
            feedbackTone = 'neutral';
            render();
            return { state: 'cancelled', config };
        }

        config = latestConfig;
        busyLabel = 'Saving...';
        render();

        let result;
        try {
            result = await writeConfig({ openToAll });
        } catch (error) {
            console.error('Unable to update the premium access config:', error);
            result = {
                state: 'unknown',
                reason: 'write-failed',
                config: unavailableConfig('global-config-write-failed')
            };
        }

        config = result.config || unavailableConfig('global-config-write-unverified');
        busy = false;
        busyLabel = '';
        if (result.state === 'confirmed') {
            feedback = openToAll
                ? 'Premium features are now unlocked for everyone.'
                : 'Premium entitlements are now required again.';
            feedbackTone = 'success';
        } else if (result.state === 'not-committed') {
            feedback = 'The requested change was not retained. The current setting has been reloaded.';
            feedbackTone = 'error';
        } else {
            feedback = 'The change could not be verified. Refresh the setting before trying again.';
            feedbackTone = 'error';
        }
        render();
        return result;
    }

    button.addEventListener('click', () => {
        if (config?.state === 'ready') {
            void toggle();
        } else {
            void load();
        }
    });
    render();

    return {
        load,
        toggle,
        getConfig: () => config
    };
}
