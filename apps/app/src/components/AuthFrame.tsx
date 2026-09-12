import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { getDocumentAuthNextRoute, getHostedDocumentAuthNextUrl, getSafeAuthNextRoute } from '../lib/authNextRoute';
import { isNativeRuntime } from '../lib/nativeRuntime';
import { openPublicUrl } from '../lib/publicActions';

export function DocumentAuthLink({ route, className, children }: {
  route: string;
  className?: string;
  children: ReactNode;
}) {
  const documentRoute = getDocumentAuthNextRoute(route);
  if (!documentRoute) return null;

  if (isNativeRuntime()) {
    const hostedAuthUrl = getHostedDocumentAuthNextUrl(documentRoute);
    return (
      <button
        type="button"
        className={className}
        onClick={() => {
          if (hostedAuthUrl) {
            // Browser.open is the only supported native handoff. Keep a plugin
            // failure contained here instead of producing an unhandled promise
            // rejection or falling back to the local WebView viewer.
            void openPublicUrl(hostedAuthUrl).catch(() => undefined);
          }
        }}
      >
        {children}
      </button>
    );
  }

  return <a href={documentRoute} className={className}>{children}</a>;
}

export function AuthFrame({
  children,
  eyebrow = 'Account',
  brandTo = '/auth',
  backTo,
  backLabel = 'Back'
}: {
  children: ReactNode;
  eyebrow?: string;
  brandTo?: string;
  backTo?: string;
  backLabel?: string;
}) {
  const safeBrandTo = getSafeAuthNextRoute(brandTo) || '/auth';
  const documentBackTo = getDocumentAuthNextRoute(backTo);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] w-full max-w-md flex-col justify-center">
        <Link to={safeBrandTo} className="mb-5 flex items-center gap-3">
          <img src="./logo_small.png" alt="" decoding="async" className="h-11 w-11 rounded-xl shadow-sm" />
          <span>
            <span className="block text-lg font-black leading-tight text-gray-950">ALL PLAYS</span>
            <span className="block text-xs font-extrabold uppercase tracking-[0.04em] text-primary-700">{eyebrow}</span>
          </span>
        </Link>
        {documentBackTo ? (
          <DocumentAuthLink route={documentBackTo} className="ghost-button mb-3 w-fit !min-h-9 !px-3 !py-1.5 text-sm">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {backLabel}
          </DocumentAuthLink>
        ) : backTo ? (
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
