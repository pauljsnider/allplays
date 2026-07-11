import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, KeyRound, LogIn, ShieldCheck, UserPlus, XCircle } from 'lucide-react';
import { AuthFrame } from '../components/AuthFrame';
import {
  clearPendingInvite,
  completeEmailLink,
  isEmailLink,
  mapLegacyRedirectToAppRoute,
  readPendingInvite,
  redeemInviteForUser,
  rememberPendingInvite
} from '../lib/authService';
import { getValidatedInviteCode, normalizeInviteCode, redeemSignedInInvite } from '../lib/inviteRedemption';
import type { AuthState } from '../lib/types';

function readEmailForSignIn() {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : null;
    return typeof storage?.getItem === 'function' ? storage.getItem('emailForSignIn') || '' : '';
  } catch {
    return '';
  }
}

export function AcceptInvite({ auth }: { auth: AuthState }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const pendingInvite = readPendingInvite();
  const urlCode = (searchParams.get('code') || '').trim().toUpperCase();
  const code = urlCode || pendingInvite.code.trim().toUpperCase();
  const inviteType = (searchParams.get('type') || pendingInvite.type || 'parent').trim().toLowerCase();
  const [manualCode, setManualCode] = useState(code);
  const [email, setEmail] = useState(readEmailForSignIn);
  const [state, setState] = useState<'idle' | 'processing' | 'email-link' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const processedKeyRef = useRef('');
  const redirectTimerRef = useRef<number | null>(null);
  const currentPathnameRef = useRef(location.pathname);

  const authUrl = useMemo(() => {
    return buildInviteAuthUrl(code, inviteType);
  }, [code, inviteType]);

  useEffect(() => {
    currentPathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, []);

  const scheduleRedirect = useCallback((path: string) => {
    if (!path) return;

    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current);
    }

    redirectTimerRef.current = window.setTimeout(() => {
      redirectTimerRef.current = null;
      if (!isCurrentInviteRoute(currentPathnameRef.current)) {
        return;
      }
      navigate(path, { replace: true });
    }, 700);
  }, [navigate]);

  const redeem = useCallback(async (codeToRedeem: string) => {
    const normalizedCode = normalizeInviteCode(codeToRedeem);
    if (!auth.user) {
      rememberPendingInvite(normalizedCode, inviteType);
      navigate(`${buildInviteAuthUrl(normalizedCode, inviteType)}&mode=login`);
      return;
    }

    const key = `${auth.user.uid}:${normalizedCode}`;
    if (processedKeyRef.current === key) {
      return;
    }
    processedKeyRef.current = key;

    setState('processing');
    setMessage('Processing invite...');

    try {
      const result = await redeemSignedInInvite({
        userId: auth.user.uid,
        code: normalizedCode,
        email: auth.user.email,
        refresh: auth.refresh
      });
      setState('success');
      setMessage(result.message);
      scheduleRedirect(result.redirectPath);
    } catch (error: any) {
      processedKeyRef.current = '';
      setState('error');
      setMessage(error?.message || 'Unable to accept this invite.');
    }
  }, [auth.refresh, auth.user, inviteType, navigate, scheduleRedirect]);

  useEffect(() => {
    if (isEmailLink(window.location.href) && !auth.user) {
      setState('email-link');
      return;
    }

    if (!auth.loading && auth.user && code) {
      redeem(code);
    }
  }, [auth.loading, auth.user, code, redeem]);

  const handleManualSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await redeem(getValidatedInviteCode(manualCode));
    } catch (error: any) {
      setState('error');
      setMessage(error?.message || 'Please enter a valid 8-character invite code.');
    }
  };

  const handleEmailLink = async (event: FormEvent) => {
    event.preventDefault();
    setState('processing');
    setMessage('Completing sign-in link...');

    try {
      const result = await completeEmailLink(email, window.location.href);
      await auth.refresh();
      const codeToRedeem = code || pendingInvite.code;
      if (codeToRedeem) {
        const inviteResult = await redeemInviteForUser(result.user.uid, codeToRedeem, result.user.email || email);
        clearPendingInvite();
        setState('success');
        setMessage(inviteResult?.message || 'Invite accepted.');
        scheduleRedirect(mapLegacyRedirectToAppRoute(inviteResult?.redirectUrl));
      } else {
        setState('success');
        setMessage('Signed in successfully.');
        scheduleRedirect('/home');
      }
    } catch (error: any) {
      setState('error');
      setMessage(error?.message || 'Unable to complete this sign-in link.');
    }
  };

  return (
    <AuthFrame eyebrow="Invite" backTo="/auth" backLabel="Back to sign in">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <UserPlus className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-950">Accept invite</h1>
          <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">Redeem an invite code, link your account, then continue to the right dashboard.</p>
        </div>
      </div>

      {code && !auth.user && state !== 'email-link' ? (
        <div className="mt-4 rounded-xl border border-primary-100 bg-primary-50 p-3">
          <div className="text-xs font-extrabold uppercase tracking-[0.04em] text-primary-700">Invite code entered</div>
          <div className="mt-1 font-mono text-lg font-black tracking-widest text-primary-900">{code}</div>
          <p className="mt-1 text-sm font-semibold text-primary-800">We’ll verify this code after you sign in or create your account.</p>
          <div className="mt-3 grid gap-2">
            <Link to={`${authUrl}&mode=login`} className="primary-button justify-center">
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign in to accept
            </Link>
            <Link to={`${authUrl}&mode=signup`} className="secondary-button justify-center">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Create account with code
            </Link>
          </div>
        </div>
      ) : null}

      {state === 'email-link' ? (
        <form className="mt-4 space-y-3" onSubmit={handleEmailLink}>
          <p className="text-sm font-semibold leading-6 text-gray-600">Enter the email address that received this invite link.</p>
          <input className="auth-input" type="email" inputMode="email" autoComplete="email" enterKeyHint="next" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" />
          <button type="submit" className="primary-button w-full justify-center">Continue</button>
        </form>
      ) : null}

      <form className="mt-4 space-y-3" onSubmit={handleManualSubmit}>
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            Invite code
          </span>
          <input className="auth-input text-center font-mono uppercase tracking-widest" value={manualCode} onChange={(event) => setManualCode(event.target.value.toUpperCase())} maxLength={8} placeholder="XXXXXXXX" inputMode="text" autoCapitalize="characters" autoComplete="one-time-code" enterKeyHint="go" />
        </label>
        <button type="submit" className="secondary-button w-full justify-center" disabled={state === 'processing'}>
          {auth.user ? 'Join team' : 'Continue with code'}
        </button>
      </form>

      {state === 'processing' ? <Status icon={KeyRound} message={message} tone="neutral" /> : null}
      {state === 'success' ? <Status icon={CheckCircle2} message={message} tone="success" /> : null}
      {state === 'error' ? <Status icon={XCircle} message={message} tone="error" /> : null}
    </AuthFrame>
  );
}

function isCurrentInviteRoute(fallbackPathname: string) {
  if (typeof window !== 'undefined') {
    const hashPath = window.location.hash.replace(/^#/, '').split('?')[0];
    if (hashPath) {
      return hashPath === '/accept-invite';
    }
  }

  return fallbackPathname === '/accept-invite';
}

function buildInviteAuthUrl(code: string, inviteType: string) {
  const params = new URLSearchParams();
  const normalizedCode = code.trim().toUpperCase();
  if (normalizedCode) {
    params.set('code', normalizedCode);
    params.set('type', inviteType);
  }
  return `/auth?${params.toString()}`;
}

function Status({ icon: Icon, message, tone }: { icon: typeof KeyRound; message: string; tone: 'neutral' | 'success' | 'error' }) {
  const classes = {
    neutral: 'border-primary-100 bg-primary-50 text-primary-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800'
  };

  return (
    <div className={`mt-4 flex items-center gap-2 rounded-xl border p-3 text-sm font-bold ${classes[tone]}`}>
      <Icon className="h-4 w-4 flex-none" aria-hidden="true" />
      {message}
    </div>
  );
}
