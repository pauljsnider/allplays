import { LockKeyhole, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PremiumAccessResult } from '../lib/premiumAccessService';

export function PremiumGate({ access, children, label = 'premium features' }: {
  access: PremiumAccessResult;
  children: ReactNode;
  label?: string;
}) {
  if (access.state === 'unlocked') return <>{children}</>;

  const loading = access.state === 'loading';
  const unavailable = access.state === 'unavailable';
  return (
    <div className={`rounded-xl border p-4 ${unavailable || loading ? 'border-gray-200 bg-gray-50' : 'border-amber-200 bg-amber-50'}`} role="status">
      <div className="flex items-start gap-3">
        {loading ? (
          <Loader2 className="mt-0.5 h-5 w-5 flex-none animate-spin text-gray-500" aria-hidden="true" />
        ) : (
          <LockKeyhole className={`mt-0.5 h-5 w-5 flex-none ${unavailable ? 'text-gray-500' : 'text-amber-700'}`} aria-hidden="true" />
        )}
        <div>
          <div className="text-sm font-black text-gray-950">
            {loading ? 'Checking premium access' : unavailable ? 'Premium access unavailable' : 'Premium access required'}
          </div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">
            {loading
              ? `Checking access to ${label}.`
              : unavailable
                ? `We could not verify access to ${label}. Try again later.`
                : `An active premium entitlement is required for ${label}.`}
          </div>
        </div>
      </div>
    </div>
  );
}
