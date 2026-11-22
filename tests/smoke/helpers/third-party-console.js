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

// Chromium can emit the report-only diagnostic before committing the child
// frame URL. Observe actual child document navigations synchronously, so this
// narrow exception has evidence even during that interval. Fetches, top-level
// navigations, failures, detached frames and later documents are not evidence.
export function observeRecaptchaFrameNavigations(page) {
    const navigations = new Map();
    page.on('request', request => {
        try {
            if (!request.isNavigationRequest()) return;
            const frame = request.frame();
            navigations.delete(frame);
            const top = new URL(page.url());
            if (request.resourceType() === 'document' && frame.parentFrame()
                && !top.username && !top.password && productionOrigins.has(top.origin)
                && isRecaptchaAnchor(request.url())) navigations.set(frame, request);
        } catch { /* Missing request/frame evidence fails closed. */ }
    });
    page.on('requestfailed', request => {
        try {
            const frame = request.frame();
            if (navigations.get(frame) === request) navigations.delete(frame);
        } catch { /* A request without frame evidence was never admitted. */ }
    });
    page.on('framedetached', frame => navigations.delete(frame));
    page.on('framenavigated', frame => {
        try {
            if (!frame.parentFrame()) navigations.clear();
            else if (!isRecaptchaAnchor(frame.url())) navigations.delete(frame);
        } catch { navigations.clear(); }
    });
    return () => {
        for (const frame of navigations.keys()) {
            try {
                const url = frame.url();
                if (!frame.isDetached() && frame.parentFrame()
                    && (!url || url === 'about:blank' || isRecaptchaAnchor(url))) return true;
            } catch { /* Unreadable frame state cannot justify an exception. */ }
        }
        return false;
    };
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
// and network failures fatal. A committed anchor or observed child navigation
// scopes this to the Google embed; neither attests to arbitrary console text.
export function isGoogleReportOnlyFrameDiagnostic(page, message, hasObservedNavigation = () => false) {
    const diagnostic = `Framing 'https://www.google.com/' violates the following report-only Content Security Policy directive: "frame-ancestors 'self'". The violation has been logged, but no further action has been taken.`;
    if (message.type() !== 'error' || message.text().trimEnd() !== diagnostic) return false;
    try {
        const top = new URL(page.url());
        if (top.username || top.password || !productionOrigins.has(top.origin)) return false;
        return page.frames().some(frame => frame.parentFrame() && isRecaptchaAnchor(frame.url()))
            || hasObservedNavigation();
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
