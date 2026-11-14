import {
    getAI as getSdkAI,
    getGenerativeModel as getSdkGenerativeModel
} from './vendor/firebase-ai.js';
import { preparePrimaryAppCheckToken } from './firebase-app-check-rest.js?v=2';

export { GoogleAIBackend, Schema } from './vendor/firebase-ai.js';

const contexts = new WeakMap();
const refreshes = new WeakMap();
const TOKEN_TIMEOUT_MS = 10000;
const VERIFICATION_MESSAGE = 'AI could not verify this app. Try again in a moment. If it still fails, update or reopen the app, or use manual entry or CSV import.';

function verificationError() {
    const error = new Error(VERIFICATION_MESSAGE);
    error.code = 'ai/app-check-unavailable';
    return error;
}

async function requireToken(forceRefresh = false) {
    let timeoutId;
    try {
        const token = await Promise.race([
            preparePrimaryAppCheckToken(forceRefresh),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(verificationError()), TOKEN_TIMEOUT_MS);
            })
        ]);
        if (!token) throw verificationError();
    } catch (_error) {
        // Neither token contents nor SDK request URLs belong in user errors.
        throw verificationError();
    } finally {
        clearTimeout(timeoutId);
    }
}

function isAppCheckRejection(error) {
    return error?.code === 'fetch-error'
        && /\b(?:401|403)\b/.test(String(error.message))
        && /\bapp\s*check\b/i.test(String(error.message));
}

function refreshToken(app) {
    if (!refreshes.has(app)) {
        const refresh = requireToken(true).finally(() => refreshes.delete(app));
        refreshes.set(app, refresh);
    }
    return refreshes.get(app);
}

/**
 * Defer SDK service creation: it snapshots App Check at construction, whereas
 * the native bridge intentionally registers asynchronously after app startup.
 */
export function getAI(app, options) {
    const context = {};
    contexts.set(context, { app, options });
    return context;
}

/** Shared by every app and legacy generation path; never wraps write tools. */
export function getGenerativeModel(ai, parameters, requestOptions) {
    const context = contexts.get(ai);
    if (!context) throw new Error('Use the shared ALL PLAYS AI client.');
    return {
        async generateContent(input) {
            await requireToken();
            const model = getSdkGenerativeModel(
                getSdkAI(context.app, context.options), parameters, requestOptions
            );
            try {
                return await model.generateContent(input);
            } catch (error) {
                if (!isAppCheckRejection(error)) throw error;
                // Only an explicit attestation rejection is safe to replay.
                // Network/ambiguous failures and executed AI tools are not retried.
                await refreshToken(context.app);
                try {
                    return await model.generateContent(input);
                } catch (retryError) {
                    if (isAppCheckRejection(retryError)) throw verificationError();
                    throw retryError;
                }
            }
        }
    };
}
