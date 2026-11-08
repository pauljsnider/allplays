const productionOrigins = new Set([
    'https://allplays.ai',
    'https://www.allplays.ai',
    'https://game-flow-c6311.web.app',
    'https://game-flow-c6311.firebaseapp.com'
]);

function isRecaptchaAnchor(value) {
    const url = new URL(value);
    return !url.username && !url.password
        && url.origin === 'https://www.google.com'
        && url.pathname === '/recaptcha/enterprise/anchor';
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
