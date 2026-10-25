import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isNativeRuntime } from '../../lib/nativeRuntime';
import type { AuthState } from '../../lib/types';
import { Modal } from '../Modal';
const Chat = lazy(() => import('../../pages/PrivateAiChat').then((module) => ({ default: module.PrivateAiChat })));

/** Keep the unsaved native composer mounted; never open an unauthenticated web tab. */
export function AssignmentAiLink({
  auth,
  to,
  className,
  children
}: {
  auth: AuthState;
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const [search, setSearch] = useState<string | null>(null);
  if (!isNativeRuntime())
    return (
      <Link to={to} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </Link>
    );
  return (
    <>
      <button type="button" className={className} onClick={() => setSearch(to.slice(to.indexOf('?')))}>
        Help me with AI
      </button>
      {search !== null && (
        <Modal ariaLabel="Assignment coaching help" onClose={() => setSearch(null)}>
          <div className="max-h-[90dvh] w-full overflow-auto rounded-xl bg-white p-4">
            <button type="button" className="min-h-12 underline" onClick={() => setSearch(null)}>
              Return to unsaved assignment
            </button>
            <Suspense fallback={<p role="status">Loading coaching help…</p>}>
              <Chat auth={auth} launchSearch={search} />
            </Suspense>
          </div>
        </Modal>
      )}
    </>
  );
}
