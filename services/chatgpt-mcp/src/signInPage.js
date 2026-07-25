// Server-rendered OAuth sign-in page.
//
// This intentionally mirrors the visual language and interaction model of
// apps/app/src/components/AuthFrame.tsx and apps/app/src/pages/AuthPage.tsx so
// connecting ChatGPT feels like signing in to AllPlays, not a separate admin
// utility.

const APP_URL = 'https://allplays.ai/app/#/auth?mode=login';
const LOGO_URL = 'https://allplays.ai/app/logo_small.png';

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
    ));
}

function safeJson(value) {
    return JSON.stringify(value)
        .replaceAll('<', '\\u003c')
        .replaceAll('>', '\\u003e')
        .replaceAll('&', '\\u0026');
}

function renderHiddenInputs(params) {
    return Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([name, value]) => (
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        ))
        .join('\n                    ');
}

function pageStyles() {
    return `
        :root {
            color-scheme: light;
            font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #f6f8fb;
            color: #111827;
        }
        * { box-sizing: border-box; }
        body {
            min-height: 100vh;
            margin: 0;
            background:
                radial-gradient(circle at 12% 8%, rgba(224, 231, 255, 0.72), transparent 28rem),
                #f6f8fb;
            padding: 1.5rem 1rem;
        }
        button, input { font: inherit; }
        button, a { -webkit-tap-highlight-color: transparent; }
        .shell {
            display: flex;
            min-height: calc(100vh - 3rem);
            width: 100%;
            max-width: 28rem;
            flex-direction: column;
            justify-content: center;
            margin: 0 auto;
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            width: fit-content;
            margin-bottom: 1.25rem;
            color: inherit;
            text-decoration: none;
        }
        .brand-logo {
            width: 2.75rem;
            height: 2.75rem;
            border-radius: 0.75rem;
            box-shadow: 0 2px 7px rgba(16, 24, 40, 0.12);
        }
        .brand-name {
            display: block;
            color: #030712;
            font-size: 1.125rem;
            font-weight: 900;
            line-height: 1.2;
        }
        .brand-eyebrow, .field-label {
            color: #4338ca;
            font-size: 0.75rem;
            font-weight: 800;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }
        .card {
            border: 1px solid #e5e7eb;
            border-radius: 1rem;
            background: #ffffff;
            padding: 1.25rem;
            box-shadow: 0 10px 24px rgba(16, 24, 40, 0.07);
        }
        .heading {
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
        }
        .heading-icon {
            display: flex;
            width: 2.75rem;
            height: 2.75rem;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            border-radius: 0.75rem;
            background: #eef2ff;
            color: #4338ca;
        }
        h1 {
            margin: 0;
            color: #030712;
            font-size: 1.5rem;
            font-weight: 900;
            line-height: 1.25;
        }
        .subtitle {
            margin: 0.25rem 0 0;
            color: #4b5563;
            font-size: 0.875rem;
            font-weight: 600;
            line-height: 1.5rem;
        }
        .permission {
            display: flex;
            gap: 0.625rem;
            margin-top: 1rem;
            border: 1px solid #e0e7ff;
            border-radius: 0.75rem;
            background: #eef2ff;
            padding: 0.75rem;
            color: #3730a3;
            font-size: 0.8125rem;
            font-weight: 650;
            line-height: 1.25rem;
        }
        .permission svg { flex: 0 0 auto; margin-top: 0.1rem; }
        .status {
            margin-top: 0.875rem;
            border: 1px solid;
            border-radius: 0.75rem;
            padding: 0.75rem;
            font-size: 0.875rem;
            font-weight: 700;
            line-height: 1.25rem;
        }
        .status-error { border-color: #fecdd3; background: #fff1f2; color: #be123c; }
        .status-success { border-color: #a7f3d0; background: #ecfdf5; color: #047857; }
        .form { margin-top: 1rem; }
        .field { display: block; margin-top: 0.75rem; }
        .field:first-child { margin-top: 0; }
        .field-label {
            display: flex;
            align-items: center;
            gap: 0.375rem;
            margin-bottom: 0.375rem;
            color: #6b7280;
        }
        .input-wrap { position: relative; }
        .auth-input {
            min-height: 2.75rem;
            width: 100%;
            border: 1px solid #d0d5dd;
            border-radius: 0.625rem;
            background: #ffffff;
            padding: 0.625rem 0.75rem;
            color: #111827;
            font-size: 1rem;
            font-weight: 650;
            outline: none;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .auth-input.password { padding-right: 3rem; }
        .auth-input:focus {
            border-color: #818cf8;
            box-shadow: 0 0 0 3px #e0e7ff;
        }
        .password-toggle {
            position: absolute;
            inset: 0 0 0 auto;
            display: flex;
            width: 3rem;
            align-items: center;
            justify-content: center;
            border: 0;
            background: transparent;
            color: #6b7280;
            cursor: pointer;
        }
        .password-toggle svg[hidden] { display: none; }
        .primary-button, .secondary-button {
            display: inline-flex;
            min-height: 2.75rem;
            width: 100%;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            border-radius: 0.625rem;
            padding: 0.625rem 0.875rem;
            font-size: 0.9rem;
            font-weight: 800;
            cursor: pointer;
        }
        .primary-button {
            margin-top: 0.875rem;
            border: 0;
            background: linear-gradient(90deg, #4f46e5, #4338ca);
            color: #ffffff;
            box-shadow: 0 10px 20px rgba(79, 70, 229, 0.22);
        }
        .secondary-button {
            margin-top: 0.75rem;
            border: 1px solid #c7d2fe;
            background: #eef2ff;
            color: #4338ca;
        }
        .primary-button:disabled, .secondary-button:disabled {
            cursor: wait;
            opacity: 0.68;
        }
        .text-button {
            display: block;
            width: 100%;
            margin-top: 0.75rem;
            border: 0;
            background: transparent;
            color: #4338ca;
            font-size: 0.875rem;
            font-weight: 800;
            text-align: center;
            cursor: pointer;
        }
        .reset-panel {
            margin-top: 0.75rem;
            border: 1px solid #e5e7eb;
            border-radius: 0.75rem;
            background: #f9fafb;
            padding: 0.75rem;
        }
        .reset-panel[hidden] { display: none; }
        .legal {
            margin: 1rem 0 0;
            color: #6b7280;
            font-size: 0.75rem;
            font-weight: 600;
            line-height: 1.25rem;
            text-align: center;
        }
        .legal a { color: #4338ca; font-weight: 800; }
        .google-mark { width: 1.15rem; height: 1.15rem; }
        .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        }
        @media (max-width: 360px) {
            body { padding-inline: 0.75rem; }
            .card { padding: 1rem; }
        }
    `;
}

export function renderSignInPage({
    clientId,
    redirectUri,
    codeChallenge,
    state,
    scope,
    resource,
    email = '',
    error = '',
    message = '',
    firebaseConfig
}) {
    const oauthParams = {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        state,
        scope,
        resource
    };
    const hiddenInputs = renderHiddenInputs(oauthParams);
    const resetInputs = renderHiddenInputs({ ...oauthParams, intent: 'password_reset' });
    const clientConfig = safeJson(firebaseConfig || {});

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Sign in to ALL PLAYS</title>
    <style>${pageStyles()}</style>
</head>
<body>
    <main class="shell">
        <a class="brand" href="${APP_URL}">
            <img class="brand-logo" src="${LOGO_URL}" alt="">
            <span>
                <span class="brand-name">ALL PLAYS</span>
                <span class="brand-eyebrow">Connect ChatGPT</span>
            </span>
        </a>
        <section class="card" aria-labelledby="signin-title">
            <div class="heading">
                <span class="heading-icon" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                        <path d="m10 17 5-5-5-5"></path>
                        <path d="M15 12H3"></path>
                    </svg>
                </span>
                <span>
                    <h1 id="signin-title">Sign in</h1>
                    <p class="subtitle">Use email/password or Google to connect your AllPlays account.</p>
                </span>
            </div>

            <div class="permission">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"></path>
                    <path d="m9 12 2 2 4-4"></path>
                </svg>
                <span>ChatGPT will be able to read your teams, family schedule, and game summaries. It cannot make changes in AllPlays.</span>
            </div>

            ${error ? `<div class="status status-error" role="alert">${escapeHtml(error)}</div>` : ''}
            ${message ? `<div class="status status-success" role="status">${escapeHtml(message)}</div>` : ''}
            <div id="client-error" class="status status-error" role="alert" hidden></div>
            <div id="busy-status" class="sr-only" role="status" aria-live="polite"></div>

            <form id="signin-form" class="form" method="POST" action="/oauth/authorize">
                ${hiddenInputs}
                <input id="firebase-refresh-token" type="hidden" name="firebase_refresh_token">
                <label class="field" for="email">
                    <span class="field-label">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <rect width="20" height="16" x="2" y="4" rx="2"></rect>
                            <path d="m22 7-10 5L2 7"></path>
                        </svg>
                        Email
                    </span>
                    <input id="email" class="auth-input" name="email" type="email" value="${escapeHtml(email)}" autocomplete="email" required>
                </label>
                <label class="field" for="password">
                    <span class="field-label">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <circle cx="7.5" cy="15.5" r="5.5"></circle>
                            <path d="m21 2-9.6 9.6"></path>
                            <path d="m15.5 7.5 3 3L22 7l-3-3"></path>
                        </svg>
                        Password
                    </span>
                    <span class="input-wrap">
                        <input id="password" class="auth-input password" name="password" type="password" minlength="6" autocomplete="current-password" required>
                        <button id="password-toggle" class="password-toggle" type="button" aria-label="Show password" aria-pressed="false">
                            <svg id="eye-open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                                <path d="M2.1 12a10.7 10.7 0 0 1 19.8 0 10.7 10.7 0 0 1-19.8 0Z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                            <svg id="eye-closed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" hidden>
                                <path d="m2 2 20 20"></path>
                                <path d="M6.7 6.7A10.7 10.7 0 0 0 2.1 12a10.7 10.7 0 0 0 14.4 5.3"></path>
                                <path d="M10.7 10.7a2 2 0 0 0 2.6 2.6"></path>
                                <path d="M14.1 5.2A10.8 10.8 0 0 1 21.9 12a10.8 10.8 0 0 1-1.8 2.8"></path>
                            </svg>
                        </button>
                    </span>
                </label>
                <button id="signin-button" class="primary-button" type="submit">Sign in &amp; connect ChatGPT</button>
            </form>

            <button id="google-button" class="secondary-button" type="button">
                <svg class="google-mark" viewBox="0 0 18 18" aria-hidden="true">
                    <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.8 2.7-6.5Z"></path>
                    <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2L12 13.5c-.8.6-1.9.9-3 .9-2.3 0-4.3-1.6-5-3.7H1v2.3A9 9 0 0 0 9 18Z"></path>
                    <path fill="#FBBC05" d="M4 10.7a5.4 5.4 0 0 1 0-3.4V5H1a9 9 0 0 0 0 8l3-2.3Z"></path>
                    <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.5 1.4L15 2.5A8.5 8.5 0 0 0 9 0a9 9 0 0 0-8 5l3 2.3c.7-2.1 2.7-3.7 5-3.7Z"></path>
                </svg>
                Continue with Google
            </button>

            <button id="reset-toggle" class="text-button" type="button" aria-expanded="false" aria-controls="password-reset-form">Forgot password?</button>
            <form id="password-reset-form" class="reset-panel" method="POST" action="/oauth/authorize" hidden>
                ${resetInputs}
                <label class="field" for="reset-email">
                    <span class="field-label">Password reset email</span>
                    <input id="reset-email" class="auth-input" name="email" type="email" value="${escapeHtml(email)}" placeholder="you@example.com" autocomplete="email" required>
                </label>
                <button class="secondary-button" type="submit">Send reset email</button>
            </form>

            <p class="legal">
                By continuing, you agree to our <a href="https://allplays.ai/terms.html" target="_blank" rel="noreferrer">Terms</a>
                and acknowledge our <a href="https://allplays.ai/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.
            </p>
        </section>
    </main>
    <script type="module">
        const firebaseConfig = ${clientConfig};
        const signinForm = document.querySelector('#signin-form');
        const signinButton = document.querySelector('#signin-button');
        const googleButton = document.querySelector('#google-button');
        const password = document.querySelector('#password');
        const passwordToggle = document.querySelector('#password-toggle');
        const eyeOpen = document.querySelector('#eye-open');
        const eyeClosed = document.querySelector('#eye-closed');
        const resetToggle = document.querySelector('#reset-toggle');
        const resetForm = document.querySelector('#password-reset-form');
        const email = document.querySelector('#email');
        const resetEmail = document.querySelector('#reset-email');
        const clientError = document.querySelector('#client-error');
        const busyStatus = document.querySelector('#busy-status');

        function showClientError(message) {
            clientError.textContent = message;
            clientError.hidden = false;
        }

        function setBusy(busy, message = '') {
            signinButton.disabled = busy;
            googleButton.disabled = busy;
            signinButton.textContent = busy ? 'Working...' : 'Sign in & connect ChatGPT';
            busyStatus.textContent = message;
        }

        signinForm.addEventListener('submit', () => setBusy(true, 'Authentication in progress.'));
        passwordToggle.addEventListener('click', () => {
            const visible = password.type === 'text';
            password.type = visible ? 'password' : 'text';
            passwordToggle.setAttribute('aria-pressed', String(!visible));
            passwordToggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
            eyeOpen.hidden = !visible;
            eyeClosed.hidden = visible;
        });
        resetToggle.addEventListener('click', () => {
            const opening = resetForm.hidden;
            resetForm.hidden = !opening;
            resetToggle.setAttribute('aria-expanded', String(opening));
            if (opening) {
                resetEmail.value = email.value;
                resetEmail.focus();
            }
        });
        googleButton.addEventListener('click', async () => {
            clientError.hidden = true;
            setBusy(true, 'Opening Google sign-in.');
            try {
                const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup }] = await Promise.all([
                    import('https://allplays.ai/js/vendor/firebase-app.js'),
                    import('https://allplays.ai/js/vendor/firebase-auth.js')
                ]);
                const app = initializeApp(firebaseConfig);
                const auth = getAuth(app);
                auth.useDeviceLanguage();
                const result = await signInWithPopup(auth, new GoogleAuthProvider());
                const refreshToken = result.user.refreshToken;
                if (!refreshToken) throw new Error('Google sign-in did not return a reusable credential.');
                document.querySelector('#firebase-refresh-token').value = refreshToken;
                email.value = result.user.email || '';
                email.required = false;
                password.required = false;
                setBusy(true, 'Finishing your AllPlays connection.');
                signinForm.requestSubmit();
            } catch (error) {
                const code = String(error?.code || '');
                const message = code.includes('popup-closed')
                    ? 'Google sign-in was canceled.'
                    : code.includes('unauthorized-domain')
                        ? 'Google sign-in is not available on this AllPlays domain yet.'
                        : 'Google sign-in failed. Please try again or use email and password.';
                showClientError(message);
                setBusy(false);
            }
        });
    </script>
</body>
</html>`;
}
