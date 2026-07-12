import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, LogOut, Mail, Send } from 'lucide-react';
import { AuthFrame } from '../components/AuthFrame';
import { getRouteForUser, reloadCurrentUser, resendVerificationEmail } from '../lib/authService';
import type { AuthState } from '../lib/types';
import { getSafeAuthNextRoute } from '../lib/authNextRoute';

export function VerifyPending({ auth }: { auth: AuthState }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextRoute = getSafeAuthNextRoute(searchParams.get('next'));
  const continueRoute = nextRoute || getRouteForUser(auth.user);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSecondaryOptions, setShowSecondaryOptions] = useState(false);

  if (!auth.loading && !auth.user) {
    return <Navigate to="/auth" replace />;
  }

  const checkVerificationAndContinue = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await reloadCurrentUser(); // Ensure native session is refreshed
      const refreshedUser = await auth.refresh();
      if (refreshedUser?.emailVerified === true) {
        navigate(nextRoute || getRouteForUser(refreshedUser), { replace: true });
        return;
      }
      setShowSecondaryOptions(true);
      setMessage('We could not confirm verification yet. If you just clicked the email link, wait a few seconds and try again.');
    } catch (refreshError: any) {
      setError(refreshError?.message || 'Unable to refresh verification status.');
      setShowSecondaryOptions(true);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await resendVerificationEmail();
      setMessage('Verification email queued. Check your inbox and spam folder shortly.');
    } catch (resendError: any) {
      setError(resendError?.message || 'Unable to resend verification email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame eyebrow="Verify" backTo={continueRoute} backLabel="Back">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
          {auth.user?.emailVerified ? <CheckCircle2 className="h-8 w-8" aria-hidden="true" /> : <Mail className="h-8 w-8" aria-hidden="true" />}
        </div>
        <h1 className="mt-4 text-2xl font-black text-gray-950">{auth.user?.emailVerified ? 'Email verified' : 'Verify your email'}</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
          {auth.user?.email || 'loading...'}
        </p>
        <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
          {auth.user?.emailVerified ? 'You are ready to continue.' : 'After you click the verification link in your email, come back here and continue.'}
        </p>
      </div>

      {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div> : null}

      <div className="mt-4 grid gap-2">
        {auth.user?.emailVerified ? (
          <Link to={continueRoute} className="primary-button justify-center">
            Continue to dashboard
          </Link>
        ) : (
          <button type="button" className="primary-button justify-center" onClick={checkVerificationAndContinue} disabled={busy}>
            I've verified, continue
          </button>
        )}

        {!auth.user?.emailVerified ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-3">
            <button
              type="button"
              className="flex w-full items-center justify-center text-sm font-black text-gray-700"
              onClick={() => setShowSecondaryOptions((current) => !current)}
              aria-expanded={showSecondaryOptions}
            >
              Need another option?
            </button>
            {showSecondaryOptions ? (
              <div className="mt-3 grid gap-2">
                <Link to={continueRoute} className="secondary-button justify-center">
                  Continue without verifying
                </Link>
                <button type="button" className="ghost-button justify-center" onClick={resend} disabled={busy}>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Resend verification email
                </button>
                <button type="button" className="ghost-button justify-center" onClick={() => auth.signOut()} disabled={busy}>
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </AuthFrame>
  );
}
