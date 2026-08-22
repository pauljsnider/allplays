function createTimeoutError(label) {
    return new Error(`${label} timed out.`);
}

export function isRetryableReadTransportError(error) {
    const code = String(error?.code || '').toLowerCase();
    if (code === 'unavailable' || code.endsWith('/unavailable')) return true;
    const text = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
    return text.includes('timed out')
        || text.includes('timeout')
        || text.includes('failed to fetch')
        || text.includes('network request failed')
        || text.includes('networkerror')
        || text.includes('aborterror')
        || text.includes('offline');
}

/**
 * Start an authoritative fallback when a primary read is slow, then return the
 * first source that succeeds. A rejection from one source is never converted
 * into an empty result: the read rejects unless the other source completes.
 */
export function raceFirstSuccessfulRead({
    primary,
    fallback,
    label = 'Data read',
    fallbackDelayMs = 750,
    primaryTimeoutMs = 5000,
    fallbackTimeoutMs = primaryTimeoutMs,
    shouldFallbackAfterPrimaryError = () => true
}) {
    if (typeof primary !== 'function' || typeof fallback !== 'function') {
        return Promise.reject(new TypeError('Both primary and fallback read functions are required.'));
    }

    let fallbackDelayTimerId;
    let fallbackOperationTimerId;
    let primaryTimerId;
    let fallbackStarted = false;
    let startFallback;
    let primaryError;
    let fallbackError;

    let primaryOperation;
    try {
        primaryOperation = Promise.resolve(primary());
    } catch (error) {
        primaryOperation = Promise.reject(error);
    }
    const primaryAttempt = new Promise((resolve, reject) => {
        primaryTimerId = globalThis.setTimeout(() => {
            reject(createTimeoutError(label));
        }, Math.max(0, Number(primaryTimeoutMs) || 0));

        primaryOperation.then(resolve, reject).finally(() => {
            if (primaryTimerId !== undefined) {
                globalThis.clearTimeout(primaryTimerId);
                primaryTimerId = undefined;
            }
        });
    });

    const fallbackAttempt = new Promise((resolve, reject) => {
        startFallback = () => {
            if (fallbackStarted) return;
            fallbackStarted = true;
            if (fallbackDelayTimerId !== undefined) {
                globalThis.clearTimeout(fallbackDelayTimerId);
                fallbackDelayTimerId = undefined;
            }
            fallbackOperationTimerId = globalThis.setTimeout(() => {
                reject(createTimeoutError(`${label} fallback`));
            }, Math.max(0, Number(fallbackTimeoutMs) || 0));
            Promise.resolve().then(fallback).then(resolve, reject).finally(() => {
                if (fallbackOperationTimerId !== undefined) {
                    globalThis.clearTimeout(fallbackOperationTimerId);
                    fallbackOperationTimerId = undefined;
                }
            });
        };
        fallbackDelayTimerId = globalThis.setTimeout(
            startFallback,
            Math.max(0, Number(fallbackDelayMs) || 0)
        );
    });

    return new Promise((resolve, reject) => {
        let failures = 0;
        const fail = () => {
            failures += 1;
            if (failures === 2) {
                reject(fallbackError || primaryError || new Error(`${label} failed.`));
            }
        };

        primaryAttempt.then((value) => {
            if (fallbackDelayTimerId !== undefined) {
                globalThis.clearTimeout(fallbackDelayTimerId);
                fallbackDelayTimerId = undefined;
            }
            resolve({ value, source: 'primary', primaryError: undefined });
        }).catch((error) => {
            primaryError = error;
            if (!shouldFallbackAfterPrimaryError(error)) {
                if (fallbackDelayTimerId !== undefined) {
                    globalThis.clearTimeout(fallbackDelayTimerId);
                    fallbackDelayTimerId = undefined;
                }
                reject(error);
                return;
            }
            startFallback();
            fail();
        });

        fallbackAttempt.then((value) => {
            if (primaryTimerId !== undefined) {
                globalThis.clearTimeout(primaryTimerId);
                primaryTimerId = undefined;
            }
            resolve({ value, source: 'fallback', primaryError });
        }).catch((error) => {
            fallbackError = error;
            fail();
        });
    });
}
