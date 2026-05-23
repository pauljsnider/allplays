import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

export function AuthFrame({
  children,
  eyebrow = 'Account',
  backTo,
  backLabel = 'Back'
}: {
  children: ReactNode;
  eyebrow?: string;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] w-full max-w-md flex-col justify-center">
        <Link to="/auth" className="mb-5 flex items-center gap-3">
          <img src="./logo_small.png" alt="" className="h-11 w-11 rounded-xl shadow-sm" />
          <span>
            <span className="block text-lg font-black leading-tight text-gray-950">ALL PLAYS</span>
            <span className="block text-xs font-extrabold uppercase tracking-[0.04em] text-primary-700">{eyebrow}</span>
          </span>
        </Link>
        {backTo ? (
          <Link to={backTo} className="ghost-button mb-3 w-fit !min-h-9 !px-3 !py-1.5 text-sm">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {backLabel}
          </Link>
        ) : null}
        <div className="app-card p-5">{children}</div>
      </div>
    </div>
  );
}
