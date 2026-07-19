import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, LogIn, Mail, ShieldCheck } from 'lucide-react';
import { AuthFrame } from '../components/AuthFrame';
import {
  completeGoogleRedirect,
  describeAuthError,
  getRouteForUser,
  hydrateFirebaseUser,
  isValidAuthEmail,
  normalizeAuthEmail,
  passwordResetConfirmationMessage,
  rememberPendingInvite,
  sendResetEmail,
  signInWithEmail,
  signInWithGoogleAccount,
  signUpWithEmail
} from '../lib/authService';
import type { AuthState } from '../lib/types';
import { getSafeAuthNextRoute } from '../lib/authNextRoute';

type AuthMode = 'login' | 'signup';

export function AuthPage({ auth }: { auth: AuthState }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const inviteCode = (searchParams.get('code') || '').trim().toUpperCase();
  const inviteType = (searchParams.get('type') || 'parent').trim().toLowerCase();
  const requestedMode = searchParams.get('mode');
  const requestedNextRoute = getSafeAuthNextRoute(searchParams.get('next'));
  const initialMode: AuthMode = requestedMode === 'login'
    ? 'login'
    : requestedMode === 'signup' || inviteCode
      ? 'signup'
      : 'login';
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [activationCode, setActivationCode] = useState(inviteCode);
  const [resetEmail, setResetEmail] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetError, setResetError] = useState('');
  const loginTabRef = useRef<HTMLButtonElement>(null);
  const signupTabRef = useRef<HTMLButtonElement>(null);

  const title = mode === 'signup' ? 'Create your account' : 'Sign in';
  const subtitle = mode === 'signup'
    ? 'Account creation requires an 8-character team or family join code. You’ll verify your email next.'
    : 'Use email/password or Google to continue.';

  const postAuthRoute = useMemo(() => {
    if (inviteCode) {
      return `/accept-invite?code=${encodeURIComponent(inviteCode)}&type=${encodeURIComponent(inviteType)}`;
    }
    return requestedNextRoute || getRouteForUser(auth.user);
  }, [auth.user, inviteCode, inviteType, requestedNextRoute]);

  useEffect(() => {
    if (!auth.loading && auth.user && !inviteCode) {
      navigate(postAuthRoute, { replace: true });
    }
  }, [auth.loading, auth.user, inviteCode, navigate, postAuthRoute]);

  useEffect(() => {
    let cancelled = false;

    async function finishRedirect() {
      try {
        const result = await completeGoogleRedirect();
        if (!result || cancelled) {
          return;
        }
        await auth.refresh();
        const redirectRoute = result.wasNewUser
          ? '/verify-pending'
          : inviteCode
            ? postAuthRoute
            : '/home';
        navigate(redirectRoute, { replace: true });
      } catch (redirectError: any) {
        if (!cancelled) {
          setError(describeAuthError(redirectError));
        }
      }
    }

    finishRedirect();
    return () => {
      cancelled = true;
    };
  }, [auth, inviteCode, navigate, postAuthRoute]);

  const clearStatus = () => {
    setError('');
    setResetError('');
    setMessage('');
  };

  const selectMode = (nextMode: AuthMode, moveFocus = false) => {
    clearStatus();
    setMode(nextMode);
    if (nextMode === 'signup') {
      setShowReset(false);
    }
    if (moveFocus) {
      (nextMode === 'login' ? loginTabRef : signupTabRef).current?.focus();
    }
  };

  const handleModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextMode: AuthMode | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextMode = mode === 'login' ? 'signup' : 'login';
    } else if (event.key === 'Home') {
      nextMode = 'login';
    } else if (event.key === 'End') {
      nextMode = 'signup';
    }
    if (!nextMode) return;
    event.preventDefault();
    selectMode(nextMode, true);
  };

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    clearStatus();
    setBusy(true);

    try {
      const normalizedEmail = normalizeAuthEmail(email);
      if (!isValidAuthEmail(normalizedEmail)) {
        throw new Error('Enter a valid email address.');
      }

      if (mode === 'signup') {
        const code = activationCode.trim().toUpperCase();
        if (!code) {
          throw new Error('Activation code is required.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }

        await signUpWithEmail(normalizedEmail, password, code);
        await auth.refresh();
        navigate(requestedNextRoute ? `/verify-pending?next=${encodeURIComponent(requestedNextRoute)}` : '/verify-pending', { replace: true });
        return;
      }

      const credential = await signInWithEmail(normalizedEmail, password);
      if (inviteCode) {
        rememberPendingInvite(inviteCode, inviteType);
      }
      const hydrated = inviteCode ? null : await hydrateFirebaseUser(credential.user).catch(() => null);
      const postLoginRoute = inviteCode || requestedNextRoute ? postAuthRoute : getRouteForUser(hydrated?.user || auth.user);
      if (credential.nativeRest) {
        window.location.hash = `#${postLoginRoute}`;
        window.location.reload();
        return;
      }

      await auth.refresh();
      navigate(postLoginRoute, { replace: true });
    } catch (submitError: any) {
      setError(describeAuthError(submitError));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    clearStatus();
    setBusy(true);

    try {
      const code = mode === 'signup' ? activationCode.trim().toUpperCase() : '';
      if (mode === 'signup' && !code) {
        throw new Error('Activation code is required for new Google accounts.');
      }
      if (inviteCode) {
        rememberPendingInvite(inviteCode, inviteType);
      }

      const result = await signInWithGoogleAccount(code || null);
      if (result) {
        const hydrated = mode === 'signup' || inviteCode ? null : await hydrateFirebaseUser(result.user).catch(() => null);
        const postGoogleRoute = mode === 'signup' && result.wasNewUser
          ? requestedNextRoute ? `/verify-pending?next=${encodeURIComponent(requestedNextRoute)}` : '/verify-pending'
          : inviteCode
            ? postAuthRoute
            : requestedNextRoute || getRouteForUser(hydrated?.user || auth.user);
        if (result.nativeRest) {
          window.location.hash = `#${postGoogleRoute}`;
          window.location.reload();
          return;
        }

        await auth.refresh();
        navigate(postGoogleRoute, { replace: true });
      }
    } catch (googleError: any) {
      setError(describeAuthError(googleError));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event: FormEvent) => {
    event.preventDefault();
    clearStatus();
    setBusy(true);

    try {
      const normalizedEmail = normalizeAuthEmail(resetEmail || email);
      if (!isValidAuthEmail(normalizedEmail)) {
        throw new Error('Enter a valid email address.');
      }
      await sendResetEmail(normalizedEmail);
      setMessage(passwordResetConfirmationMessage);
      setShowReset(false);
    } catch (resetFailure: any) {
      setResetError(describeAuthError(resetFailure));
    } finally {
      setBusy(false);
    }
  };

  const toggleReset = () => {
    clearStatus();
    setShowReset((current) => {
      const next = !current;
      if (next && !resetEmail.trim() && email.trim()) {
        setResetEmail(email);
      }
      return next;
    });
  };

  return (
    <AuthFrame eyebrow={mode === 'signup' ? 'Sign up' : 'Sign in'}>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          {mode === 'signup' ? <ShieldCheck className="h-6 w-6" aria-hidden="true" /> : <LogIn className="h-6 w-6" aria-hidden="true" />}
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-950">{title}</h1>
          <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">{subtitle}</p>
        </div>
      </div>

      {inviteCode ? (
        <div className="mt-4 rounded-xl border border-primary-100 bg-primary-50 p-3 text-sm font-semibold text-primary-800">
          <div>Join code entered: <span className="font-mono font-black tracking-widest">{inviteCode}</span></div>
          <div className="mt-1">We’ll verify it after you sign in or create your account.</div>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Account access">
        <button
          ref={loginTabRef}
          id="auth-login-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          aria-controls="auth-mode-panel"
          tabIndex={mode === 'login' ? 0 : -1}
          className={`min-h-11 rounded-lg text-sm font-black ${mode === 'login' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}
          onClick={() => selectMode('login')}
          onKeyDown={handleModeKeyDown}
        >
          Sign in
        </button>
        <button
          ref={signupTabRef}
          id="auth-signup-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          aria-controls="auth-mode-panel"
          tabIndex={mode === 'signup' ? 0 : -1}
          className={`min-h-11 rounded-lg text-sm font-black ${mode === 'signup' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}
          onClick={() => selectMode('signup')}
          onKeyDown={handleModeKeyDown}
        >
          Sign up
        </button>
      </div>

      <div id="auth-mode-panel" role="tabpanel" aria-labelledby={mode === 'login' ? 'auth-login-tab' : 'auth-signup-tab'}>
      <form className="mt-4 space-y-3" onSubmit={handleEmailSubmit}>
        <Field icon={Mail} label="Email" htmlFor="auth-email">
          <input
            id="auth-email"
            className="auth-input"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              clearStatus();
            }}
            required
            autoComplete="email"
          />
        </Field>
        <Field icon={KeyRound} label="Password" htmlFor="auth-password">
          <div className="relative">
            <input
              id="auth-password"
              className="auth-input !pr-14"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearStatus();
              }}
              required
              minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
            <PasswordVisibilityButton visible={showPassword} label="password" onToggle={() => setShowPassword((current) => !current)} />
          </div>
        </Field>
        {mode === 'signup' ? (
          <>
            <Field icon={KeyRound} label="Confirm password" htmlFor="auth-confirm-password">
              <div className="relative">
                <input
                  id="auth-confirm-password"
                  className="auth-input !pr-14"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    clearStatus();
                  }}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <PasswordVisibilityButton visible={showConfirmPassword} label="confirmation password" onToggle={() => setShowConfirmPassword((current) => !current)} />
              </div>
            </Field>
            <Field icon={Eye} label="Join code" htmlFor="auth-join-code">
              <input
                id="auth-join-code"
                className="auth-input font-mono uppercase tracking-widest"
                value={activationCode}
                onChange={(event) => {
                  setActivationCode(event.target.value.toUpperCase());
                  clearStatus();
                }}
                required
                maxLength={12}
                autoComplete="one-time-code"
                aria-describedby="auth-join-code-help"
              />
              <p id="auth-join-code-help" className="mt-1.5 text-xs font-semibold leading-5 text-gray-500">Get this code from your coach, organizer, or family admin.</p>
            </Field>
          </>
        ) : null}

        {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div> : null}
        {message ? <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</div> : null}

        <button type="submit" className="primary-button !min-h-11 w-full" disabled={busy}>
          {busy ? 'Working...' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button type="button" className="secondary-button mt-3 !min-h-11 w-full" onClick={handleGoogle} disabled={busy}>
        Continue with Google
      </button>

      {mode === 'login' ? (
        <button
          id="password-reset-trigger"
          type="button"
          className="mt-3 min-h-11 w-full text-center text-sm font-black text-primary-700"
          onClick={toggleReset}
          aria-expanded={showReset}
          aria-controls="password-reset-panel"
        >
          Forgot password?
        </button>
      ) : null}

      {showReset ? (
        <form id="password-reset-panel" role="region" aria-labelledby="password-reset-trigger" className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3" onSubmit={handleReset}>
          <label htmlFor="password-reset-email" className="text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">Password reset email</label>
          <input id="password-reset-email" className="auth-input mt-2" type="email" value={resetEmail} onChange={(event) => { setResetEmail(event.target.value); setResetError(''); }} placeholder="you@example.com" autoComplete="email" required />
          {resetError ? <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{resetError}</div> : null}
          <button type="submit" className="secondary-button mt-3 !min-h-11 w-full" disabled={busy}>
            Send reset email
          </button>
        </form>
      ) : null}

      {mode === 'login' ? <div className="mt-4 flex flex-wrap justify-center gap-3 text-xs font-bold text-gray-500">
        <Link to="/accept-invite" className="inline-flex min-h-11 items-center text-primary-700">Enter join code</Link>
      </div> : null}
      </div>
    </AuthFrame>
  );
}

function Field({ icon: Icon, label, htmlFor, children }: { icon: typeof Mail; label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="block">
      <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </label>
      {children}
    </div>
  );
}

function PasswordVisibilityButton({ visible, label, onToggle }: { visible: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center rounded-r-xl text-gray-500 hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600"
      onClick={onToggle}
      aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
      aria-pressed={visible}
    >
      {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}
