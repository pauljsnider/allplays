import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  signInWithAppleAccount,
  signInWithEmail,
  signInWithGoogleAccount,
  signUpWithEmail
} from '../lib/authService';
import type { AuthState } from '../lib/types';
import { getSafeAuthNextRoute } from '../lib/authNextRoute';
import { isNativeRuntime } from '../lib/nativeRuntime';
import { Capacitor } from '@capacitor/core';

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
  const [showReset, setShowReset] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const loginTabRef = useRef<HTMLButtonElement>(null);
  const signupTabRef = useRef<HTMLButtonElement>(null);

  const title = mode === 'signup' ? 'Create your account' : 'Sign in';
  const subtitle = mode === 'signup'
    ? 'A team or family join code is required. Then verify your email.'
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
    setMessage('');
  };

  const selectMode = (nextMode: AuthMode, focus = false) => {
    setMode(nextMode);
    if (focus) {
      const tabRef = nextMode === 'login' ? loginTabRef : signupTabRef;
      tabRef.current?.focus();
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextMode: AuthMode | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextMode = mode === 'login' ? 'signup' : 'login';
    } else if (event.key === 'Home') {
      nextMode = 'login';
    } else if (event.key === 'End') {
      nextMode = 'signup';
    }

    if (nextMode) {
      event.preventDefault();
      selectMode(nextMode, true);
    }
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

  const handleApple = async () => {
    clearStatus();
    setBusy(true);

    try {
      const code = mode === 'signup' ? activationCode.trim().toUpperCase() : '';
      if (mode === 'signup' && !code) {
        throw new Error('Activation code is required for new Apple accounts.');
      }
      if (inviteCode) {
        rememberPendingInvite(inviteCode, inviteType);
      }

      const result = await signInWithAppleAccount(code || null);
      if (result) {
        const hydrated = mode === 'signup' || inviteCode ? null : await hydrateFirebaseUser(result.user).catch(() => null);
        const destination = mode === 'signup' && result.wasNewUser
          ? requestedNextRoute ? `/verify-pending?next=${encodeURIComponent(requestedNextRoute)}` : '/verify-pending'
          : inviteCode
            ? postAuthRoute
            : requestedNextRoute || getRouteForUser(hydrated?.user || auth.user);
        window.location.hash = `#${destination}`;
        window.location.reload();
      }
    } catch (appleError: any) {
      setError(describeAuthError(appleError));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event: FormEvent) => {
    event.preventDefault();
    clearStatus();
    setBusy(true);

    try {
      const normalizedEmail = normalizeAuthEmail(email);
      if (!isValidAuthEmail(normalizedEmail)) {
        throw new Error('Enter a valid email address.');
      }
      await sendResetEmail(normalizedEmail);
      setMessage(passwordResetConfirmationMessage);
      setShowReset(false);
    } catch (resetError: any) {
      setError(describeAuthError(resetError));
    } finally {
      setBusy(false);
    }
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

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Authentication mode">
        <button
          ref={loginTabRef}
          id="auth-tab-login"
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          aria-controls="auth-panel-login"
          tabIndex={mode === 'login' ? 0 : -1}
          className={`min-h-10 rounded-lg text-sm font-black ${mode === 'login' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}
          onClick={() => selectMode('login')}
          onKeyDown={handleTabKeyDown}
        >
          Sign in
        </button>
        <button
          ref={signupTabRef}
          id="auth-tab-signup"
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          aria-controls="auth-panel-signup"
          tabIndex={mode === 'signup' ? 0 : -1}
          className={`min-h-10 rounded-lg text-sm font-black ${mode === 'signup' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}
          onClick={() => selectMode('signup')}
          onKeyDown={handleTabKeyDown}
        >
          Sign up
        </button>
      </div>

      <div id={`auth-panel-${mode}`} role="tabpanel" aria-labelledby={`auth-tab-${mode}`}>
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
          <PasswordInput
            id="auth-password"
            value={password}
            visible={showPassword}
            onChange={(value) => {
              setPassword(value);
              clearStatus();
            }}
            onToggle={() => setShowPassword((current) => !current)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            showLabel="Show password"
            hideLabel="Hide password"
          />
        </Field>
        {mode === 'signup' ? (
          <>
            <Field icon={KeyRound} label="Confirm password" htmlFor="auth-confirm-password">
              <PasswordInput
                id="auth-confirm-password"
                value={confirmPassword}
                visible={showConfirmPassword}
                onChange={(value) => {
                  setConfirmPassword(value);
                  clearStatus();
                }}
                onToggle={() => setShowConfirmPassword((current) => !current)}
                autoComplete="new-password"
                showLabel="Show confirmation password"
                hideLabel="Hide confirmation password"
              />
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
              />
            </Field>
          </>
        ) : null}

        {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div> : null}
        {message ? <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</div> : null}
        {busy ? <div role="status" aria-live="polite" className="sr-only">Authentication in progress.</div> : null}

        <button type="submit" className="primary-button w-full" disabled={busy}>
          {busy ? 'Working...' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button type="button" className="secondary-button mt-3 w-full" onClick={handleGoogle} disabled={busy}>
        Continue with Google
      </button>
      {isNativeRuntime() && Capacitor.getPlatform() === 'ios' ? (
        <button type="button" className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-black px-4 text-sm font-black text-white" onClick={handleApple} disabled={busy}>
          Continue with Apple
        </button>
      ) : null}

      {mode === 'login' ? (
        <button
          type="button"
          className="mt-3 w-full text-center text-sm font-black text-primary-700"
          aria-expanded={showReset}
          aria-controls="password-reset-form"
          onClick={() => setShowReset((current) => !current)}
        >
          Forgot password?
        </button>
      ) : null}

      {showReset ? (
        <form id="password-reset-form" className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3" onSubmit={handleReset}>
          <label htmlFor="password-reset-email" className="text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">Password reset email</label>
          <input
            id="password-reset-email"
            className="auth-input mt-2"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              clearStatus();
            }}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <button type="submit" className="secondary-button mt-3 w-full" disabled={busy}>
            Send reset email
          </button>
        </form>
      ) : null}
      <p className="mt-4 text-center text-xs font-semibold leading-5 text-gray-500">
        By continuing, you agree to our <a className="font-black text-primary-700" href="/terms.html" target="_blank" rel="noreferrer">Terms</a> and acknowledge our <a className="font-black text-primary-700" href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.
      </p>
      </div>
      <div
        id={`auth-panel-${mode === 'login' ? 'signup' : 'login'}`}
        role="tabpanel"
        aria-labelledby={`auth-tab-${mode === 'login' ? 'signup' : 'login'}`}
        hidden
      />
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

function PasswordInput({ id, value, visible, onChange, onToggle, autoComplete, showLabel, hideLabel }: {
  id: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  autoComplete: string;
  showLabel: string;
  hideLabel: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        className="auth-input pr-12"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        minLength={6}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-gray-500"
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        onClick={onToggle}
      >
        {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
      </button>
    </div>
  );
}
