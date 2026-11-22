const productionOrigins = new Set([
    'https://allplays.ai',
    'https://www.allplays.ai',
    'https://game-flow-c6311.web.app',
    'https://game-flow-c6311.firebaseapp.com'
]);

function isRecaptchaAnchor(value) {
    try {
        const url = new URL(value);
        return !url.username && !url.password
            && url.origin === 'https://www.google.com'
            && url.pathname === '/recaptcha/enterprise/anchor';
    } catch {
        // An attaching frame may have an empty URL. It supplies no evidence,
        // but must not prevent checking a separate, fully identified anchor.
        return false;
    }
}

// Chromium reports Google's optional third-party storage request as a console
// error even when CI attestation and sign-in succeed. Only this exact embedded
// frame diagnostic is nonfatal; token readiness and network errors remain gates.
export function isRecaptchaStorageDiagnostic(page, message) {
    if (message.type() !== 'error' || message.text() !== 'requestStorageAccess: Permission denied.') return false;
    try {
        const top = new URL(page.url());
        if (top.username || top.password || !productionOrigins.has(top.origin)) return false;
        if (!isRecaptchaAnchor(message.location().url)) return false;
        return page.frames().some(frame => frame.parentFrame() && isRecaptchaAnchor(frame.url()));
    } catch {
        return false;
    }
}

// This exact Chromium diagnostic explicitly says the policy is report-only and
// no action was taken. Keep enforced CSP, other origins/directives, pageerrors
// and network failures fatal. Frame presence scopes this to the existing Google
// embed; it does not attest to the origin of an arbitrary console message.
export function isGoogleReportOnlyFrameDiagnostic(page, message) {
    const diagnostic = `Framing 'https://www.google.com/' violates the following report-only Content Security Policy directive: "frame-ancestors 'self'". The violation has been logged, but no further action has been taken.`;
    if (message.type() !== 'error' || message.text().trimEnd() !== diagnostic) return false;
    try {
        const top = new URL(page.url());
        if (top.username || top.password || !productionOrigins.has(top.origin)) return false;
        return page.frames().some(frame => frame.parentFrame() && isRecaptchaAnchor(frame.url()));
    } catch {
        return false;
    }
}

// Evidence only: this never changes the classification above. Use fixed
// categories, not raw URLs, query strings, credentials, frame names or errors.
export function googleReportOnlyFrameContext(page, message) {
    const diagnostic = `Framing 'https://www.google.com/' violates the following report-only Content Security Policy directive: "frame-ancestors 'self'". The violation has been logged, but no further action has been taken.`;
    if (message.type() !== 'error' || message.text().trimEnd() !== diagnostic) return '';
    let top = 'unavailable';
    let frames = 'unavailable';
    let location = 'unavailable';
    try {
        const url = new URL(page.url());
        top = !url.username && !url.password && productionOrigins.has(url.origin) ? 'allowed' : 'rejected';
    } catch { /* Keep the fixed unavailable category. */ }
    try {
        frames = page.frames().some(frame => frame.parentFrame() && isRecaptchaAnchor(frame.url()))
            ? 'anchor-present' : 'no-anchor';
    } catch { /* Never serialize the failure or frame URL. */ }
    try {
        location = isRecaptchaAnchor(message.location().url) ? 'anchor' : 'other';
    } catch { /* Console location is optional. */ }
    return ` [google-frame-context:top=${top};frames=${frames};location=${location}]`;
}
