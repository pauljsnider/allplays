import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, KeyRound, MailWarning, XCircle } from 'lucide-react';
import { AuthFrame } from '../components/AuthFrame';
import { applyEmailActionCode, confirmReset, verifyResetCode } from '../lib/authService';

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') || '';
  const oobCode = searchParams.get('oobCode') || '';
  const [state, setState] = useState<'loading' | 'reset' | 'success' | 'invalid'>('loading');
  const [message, setMessage] = useState('Verifying account action...');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function handleAction() {
      if (!oobCode) {
        setState('invalid');
        setMessage('No account action code was provided.');
        return;
      }

      try {
        if (mode === 'verifyEmail') {
          await applyEmailActionCode(oobCode);
          if (!cancelled) {
            setState('success');
            setMessage('Email verified. You can continue to ALL PLAYS.');
          }
          return;
        }

        if (mode === 'recoverEmail') {
          await applyEmailActionCode(oobCode);
          if (!cancelled) {
            setState('success');
            setMessage('Email recovered successfully.');
          }
          return;
        }

        if (mode === 'resetPassword') {
          await verifyResetCode(oobCode);
          if (!cancelled) {
            setState('reset');
            setMessage('');
          }
          return;
        }

        setState('invalid');
        setMessage('Unknown account action type.');
      } catch (error: any) {
        if (!cancelled) {
          setState('invalid');
          setMessage(error?.message || 'This link is invalid or expired.');
        }
      }
    }

    handleAction();
    return () => {
      cancelled = true;
    };
  }, [mode, oobCode]);

  const handleReset = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage('Passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setMessage('Password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      await confirmReset(oobCode, newPassword);
      setState('success');
      setMessage('Password reset successful. Sign in with your new password.');
    } catch (error: any) {
      setMessage(error?.message || 'Unable to reset password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame eyebrow="Account action" backTo="/auth" backLabel="Back to sign in">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <KeyRound className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-950">{state === 'reset' ? 'Reset password' : 'Account action'}</h1>
          <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">Complete password reset, email verification, or account recovery.</p>
        </div>
      </div>

      {state === 'loading' ? <Message icon={KeyRound} text={message} tone="neutral" /> : null}
      {state === 'invalid' ? <Message icon={XCircle} text={message} tone="error" /> : null}
      {state === 'success' ? (
        <>
          <Message icon={CheckCircle2} text={message} tone="success" />
          <Link to="/auth" className="primary-button mt-4 w-full justify-center">Continue to login</Link>
        </>
      ) : null}

      {state === 'reset' ? (
        <form className="mt-4 space-y-3" onSubmit={handleReset}>
          <input className="auth-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={6} placeholder="New password" />
          <input className="auth-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={6} placeholder="Confirm password" />
          {message ? <Message icon={MailWarning} text={message} tone="error" /> : null}
          <button type="submit" className="primary-button w-full justify-center" disabled={busy}>
            {busy ? 'Resetting...' : 'Reset password'}
          </button>
        </form>
      ) : null}
    </AuthFrame>
  );
}

function Message({ icon: Icon, text, tone }: { icon: typeof KeyRound; text: string; tone: 'neutral' | 'success' | 'error' }) {
  const classes = {
    neutral: 'border-primary-100 bg-primary-50 text-primary-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800'
  };

  return (
    <div className={`mt-4 flex items-center gap-2 rounded-xl border p-3 text-sm font-bold ${classes[tone]}`}>
      <Icon className="h-4 w-4 flex-none" aria-hidden="true" />
      {text}
    </div>
  );
}
