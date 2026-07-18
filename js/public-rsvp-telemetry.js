const DEFAULT_TELEMETRY_ENDPOINT = 'https://us-central1-game-flow-c6311.cloudfunctions.net/collectTelemetry';
const ALLOWED_FAILURE_KINDS = new Set([
    'missing_token',
    'configuration_error',
    'request_rejected',
    'rate_limited',
    'server_error',
    'network_error',
    'unexpected_error'
]);

function randomId(prefix) {
    if (window.crypto?.randomUUID) {
        return `${prefix}_${window.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveTelemetryEndpoint() {
    const configuredEndpoint = window.__ALLPLAYS_CONFIG__?.telemetryEndpoint
        || window.ALLPLAYS_TELEMETRY_ENDPOINT;
    return typeof configuredEndpoint === 'string' && configuredEndpoint.trim()
        ? configuredEndpoint.trim()
        : DEFAULT_TELEMETRY_ENDPOINT;
}

export function normalizePublicRsvpFailure(properties = {}) {
    const providedFailureKind = String(properties.failureKind || '');
    const providedHttpStatus = Number(properties.httpStatus || 0);

    return {
        label: properties.stage === 'submit' ? 'Public RSVP submit' : 'Public RSVP init',
        stage: properties.stage === 'submit' ? 'submit' : 'init',
        failureKind: ALLOWED_FAILURE_KINDS.has(providedFailureKind)
            ? providedFailureKind
            : 'unexpected_error',
        httpStatus: Number.isInteger(providedHttpStatus) && providedHttpStatus >= 400 && providedHttpStatus <= 599
            ? providedHttpStatus
            : 0,
        online: properties.online !== false
    };
}

export async function capturePublicRsvpFailure(properties = {}) {
    try {
        const anonymousContextId = randomId('public_rsvp');
        const event = {
            id: randomId('event'),
            name: 'public_rsvp_error',
            version: '1.0.0',
            sessionId: anonymousContextId,
            visitorId: anonymousContextId,
            signedIn: false,
            clientTimestamp: new Date().toISOString(),
            pagePath: '/public-rsvp.html',
            appRoute: '/public-rsvp.html',
            properties: normalizePublicRsvpFailure(properties)
        };
        const response = await fetch(resolveTelemetryEndpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sentAt: new Date().toISOString(),
                events: [event]
            }),
            keepalive: true
        });
        return response.ok;
    } catch {
        return false;
    }
}
