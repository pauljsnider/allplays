import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, KeyRound, LogIn, Mail, ShieldCheck } from 'lucide-react';
import { AuthFrame } from '../components/AuthFrame';
import {
  completeGoogleRedirect,
  describeAuthError,
  getRouteForUser,
  hydrateFirebaseUser,
  rememberPendingInvite,
  sendResetEmail,
  signInWithEmail,
  signInWithGoogleAccount,
  signUpWithEmail
} from '../lib/authService';
import type { AuthState } from '../lib/types';

type AuthMode = 'login' | 'signup';

export function AuthPage({ auth }: { auth: AuthState }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const inviteCode = (searchParams.get('code') || '').trim().toUpperCase();
  const inviteType = (searchParams.get('type') || 'parent').trim().toLowerCase();
  const requestedMode = searchParams.get('mode');
  const initialMode: AuthMode = requestedMode === 'login' ? 'login' : inviteCode ? 'signup' : 'login';
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [activationCode, setActivationCode] = useState(inviteCode);
  const [resetEmail, setResetEmail] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const title = mode === 'signup' ? 'Create your account' : 'Sign in';
  const subtitle = mode === 'signup'
    ? 'Use an activation or invite code, then verify your email.'
    : 'Use email/password or Google to continue.';

  const postAuthRoute = useMemo(() => {
    if (inviteCode) {
      return `/accept-invite?code=${encodeURIComponent(inviteCode)}&type=${encodeURIComponent(inviteType)}`;
    }
    return getRouteForUser(auth.user);
  }, [auth.user, inviteCode, inviteType]);

  useEffect(() => {
    if (!auth.loading && auth.user && !inviteCode) {
      navigate(getRouteForUser(auth.user), { replace: true });
    }
  }, [auth.loading, auth.user, inviteCode, navigate]);

  useEffect(() => {
    let cancelled = false;

    async function finishRedirect() {
      try {
        const result = await completeGoogleRedirect();
        if (!result || cancelled) {
          return;
        }
        await auth.refresh();
        navigate(postAuthRoute, { replace: true });
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
  }, [auth, navigate, postAuthRoute]);

  const clearStatus = () => {
    setError('');
    setMessage('');
  };

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    clearStatus();
    setBusy(true);

    try {
      if (mode === 'signup') {
        const code = activationCode.trim().toUpperCase();
        if (!code) {
          throw new Error('Activation code is required.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }

        await signUpWithEmail(email, password, code);
        await auth.refresh();
        navigate('/verify-pending', { replace: true });
        return;
      }

      const credential = await signInWithEmail(email, password);
      if (inviteCode) {
        rememberPendingInvite(inviteCode, inviteType);
      }
      const hydrated = inviteCode ? null : await hydrateFirebaseUser(credential.user).catch(() => null);
      const postLoginRoute = inviteCode ? postAuthRoute : getRouteForUser(hydrated?.user || auth.user);
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
        const postGoogleRoute = mode === 'signup'
          ? '/verify-pending'
          : inviteCode
            ? postAuthRoute
            : getRouteForUser(hydrated?.user || auth.user);
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
      await sendResetEmail(resetEmail || email);
      setMessage('Password reset email sent. Check your inbox and spam folder.');
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
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          Invite code applied: <span className="font-mono font-black tracking-widest">{inviteCode}</span>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
        <button type="button" className={`min-h-10 rounded-lg text-sm font-black ${mode === 'login' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`} onClick={() => setMode('login')}>
          Sign in
        </button>
        <button type="button" className={`min-h-10 rounded-lg text-sm font-black ${mode === 'signup' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`} onClick={() => setMode('signup')}>
          Sign up
        </button>
      </div>

      <form className="mt-4 space-y-3" onSubmit={handleEmailSubmit}>
        <Field icon={Mail} label="Email">
          <input className="auth-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
        </Field>
        <Field icon={KeyRound} label="Password">
          <input className="auth-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
        </Field>
        {mode === 'signup' ? (
          <>
            <Field icon={KeyRound} label="Confirm password">
              <input className="auth-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={6} autoComplete="new-password" />
            </Field>
            <Field icon={Eye} label="Activation or invite code">
              <input className="auth-input font-mono uppercase tracking-widest" value={activationCode} onChange={(event) => setActivationCode(event.target.value.toUpperCase())} required maxLength={12} />
            </Field>
          </>
        ) : null}

        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div> : null}
        {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</div> : null}

        <button type="submit" className="primary-button w-full" disabled={busy}>
          {busy ? 'Working...' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button type="button" className="secondary-button mt-3 w-full" onClick={handleGoogle} disabled={busy}>
        Continue with Google
      </button>

      {mode === 'login' ? (
        <button type="button" className="mt-3 w-full text-center text-sm font-black text-primary-700" onClick={() => setShowReset((current) => !current)}>
          Forgot password?
        </button>
      ) : null}

      {showReset ? (
        <form className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3" onSubmit={handleReset}>
          <label className="text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">Password reset email</label>
          <input className="auth-input mt-2" type="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} placeholder={email || 'you@example.com'} />
          <button type="submit" className="secondary-button mt-3 w-full" disabled={busy}>
            Send reset email
          </button>
        </form>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-center gap-3 text-xs font-bold text-gray-500">
        <Link to="/accept-invite" className="text-primary-700">Enter invite code</Link>
        <Link to="/reset-password" className="text-primary-700">Account action</Link>
      </div>
    </AuthFrame>
  );
}

function Field({ icon: Icon, label, children }: { icon: typeof Mail; label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </span>
      {children}
    </label>
  );
}
