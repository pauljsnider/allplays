import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CheckCircle2, LogOut, Mail, RefreshCw, Send } from 'lucide-react';
import { AuthFrame } from '../components/AuthFrame';
import { getRouteForUser, reloadCurrentUser, resendVerificationEmail } from '../lib/authService';
import type { AuthState } from '../lib/types';

export function VerifyPending({ auth }: { auth: AuthState }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!auth.loading && !auth.user) {
    return <Navigate to="/auth" replace />;
  }

  const refreshVerification = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await reloadCurrentUser();
      await auth.refresh();
      setMessage('Verification status refreshed.');
    } catch (refreshError: any) {
      setError(refreshError?.message || 'Unable to refresh verification status.');
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
      setMessage('Verification email sent. Check your inbox and spam folder.');
    } catch (resendError: any) {
      setError(resendError?.message || 'Unable to resend verification email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame eyebrow="Verify" backTo={getRouteForUser(auth.user)} backLabel="Back to dashboard">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
          {auth.user?.emailVerified ? <CheckCircle2 className="h-8 w-8" aria-hidden="true" /> : <Mail className="h-8 w-8" aria-hidden="true" />}
        </div>
        <h1 className="mt-4 text-2xl font-black text-gray-950">{auth.user?.emailVerified ? 'Email verified' : 'Verify your email'}</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
          {auth.user?.email || 'loading...'}
        </p>
        <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
          You can verify now or continue and manage verification from Profile.
        </p>
      </div>

      {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div> : null}

      <div className="mt-4 grid gap-2">
        <Link to={getRouteForUser(auth.user)} className="primary-button justify-center">
          Continue to dashboard
        </Link>
        <button type="button" className="secondary-button justify-center" onClick={resend} disabled={busy}>
          <Send className="h-4 w-4" aria-hidden="true" />
          Resend verification email
        </button>
        <button type="button" className="ghost-button justify-center" onClick={refreshVerification} disabled={busy}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh status
        </button>
        <button type="button" className="ghost-button justify-center" onClick={() => auth.signOut()} disabled={busy}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </AuthFrame>
  );
}
