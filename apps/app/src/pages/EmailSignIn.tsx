import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { clearPendingPushRoute } from '../lib/pushNotificationRouting';
import { AuthFrame } from '../components/AuthFrame';
import { isNativeRuntime } from '../lib/nativeRuntime';
import {
  completePilotEmail,
  normalizePilotEmail,
  pilotConfirmation,
  readPilotEmail,
  requestPilotEmail,
  safePilotNext,
  signOutPilotAccount
} from '../lib/webSignInPilot';
import type { AuthState } from '../lib/types';

export function EmailSignIn({ auth }: { auth: AuthState }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locationKey = useRef(location.key);
  locationKey.current = location.key;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [email, setEmail] = useState(readPilotEmail);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const hasLink = Boolean(params.get('oobCode'));
  const native = isNativeRuntime();
  const wrongAccount = Boolean(auth.user && normalizePilotEmail(auth.user.email || '') !== normalizePilotEmail(email));
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    const startedAt = locationKey.current;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await action();
    } catch {
      if (active.current && locationKey.current === startedAt)
        setError(
          'We could not complete this request. Check the email address. The link may be expired or already used, or the pilot unavailable. Request a new link or use your password.'
        );
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <AuthFrame backTo="/auth" backLabel="Password or Google sign-in">
      <h1 className="text-2xl font-bold">Email sign-in pilot</h1>
      <p className="mt-3 text-sm text-gray-600">
        For eligible existing accounts. Your password remains available. Open the email link in a browser and choose Continue.
      </p>
      {native ? (
        <p role="alert">This pilot is available in your web browser only.</p>
      ) : (
        <>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (hasLink) {
                  const startedAt = locationKey.current;
                  clearPendingPushRoute();
                  const next = await completePilotEmail(email, params);
                  await auth.refresh();
                  if (!active.current || locationKey.current !== startedAt) return;
                  clearPendingPushRoute();
                  navigate(next, { replace: true });
                } else {
                  await requestPilotEmail(email, safePilotNext(params.get('next')));
                  setSent(true);
                  setMessage(pilotConfirmation);
                }
              });
            }}
          >
            <label className="block" htmlFor="pilot-email">
              Email address that received the link
            </label>
            <input
              className="w-full rounded-lg border p-3"
              id="pilot-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
            />
            {wrongAccount && <p role="alert">A different account is signed in. Sign out before continuing with this email.</p>}
            <button className="primary-button w-full" disabled={busy || auth.loading || (hasLink && wrongAccount)}>
              {busy ? 'Working…' : hasLink ? 'Continue' : sent ? 'Resend link' : 'Email me a sign-in link'}
            </button>
          </form>
          {hasLink && (
            <button
              className="secondary-button mt-3 w-full"
              type="button"
              disabled={busy || !email}
              onClick={() =>
                void run(async () => {
                  await requestPilotEmail(email, safePilotNext(params.get('next')));
                  setMessage(pilotConfirmation);
                })
              }
            >
              Request a new link
            </button>
          )}
          {wrongAccount && (
            <button
              className="secondary-button mt-3 w-full"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await signOutPilotAccount();
                  await auth.refresh();
                })
              }
            >
              Sign out of current account
            </button>
          )}
        </>
      )}
      {message && (
        <p className="mt-4" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-4" role="alert">
          {error}
        </p>
      )}
      <Link className="mt-4 block underline" to="/auth">
        Use password or Google instead
      </Link>
    </AuthFrame>
  );
}
