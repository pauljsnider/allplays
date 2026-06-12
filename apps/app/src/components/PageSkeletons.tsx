import type { ReactNode } from 'react';

type SkeletonBlockProps = {
  className?: string;
  children?: ReactNode;
};

export function SkeletonBlock({ className = '', children }: SkeletonBlockProps) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-gray-200/80 ${className}`}>{children}</div>;
}

export function SkeletonCard({ className = '', lines = 3 }: { className?: string; lines?: number }) {
  return (
    <section className={`app-card p-4 ${className}`}>
      <div className="space-y-3">
        <SkeletonBlock className="h-4 w-28 rounded-full" />
        <SkeletonBlock className="h-7 w-3/4" />
        <div className="space-y-2">
          {Array.from({ length: lines }).map((_, index) => (
            <SkeletonBlock key={index} className={`h-3 ${index === lines - 1 ? 'w-1/2' : 'w-full'}`} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function SkeletonListRows({ rows = 4, leading = 'dot' }: { rows?: number; leading?: 'dot' | 'avatar' | 'date'; }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <section key={index} className="app-card p-3">
          <div className="flex items-start gap-3">
            {leading === 'avatar' ? <SkeletonBlock className="h-11 w-11 flex-none rounded-xl" /> : null}
            {leading === 'date' ? <SkeletonBlock className="h-12 w-12 flex-none rounded-xl" /> : null}
            {leading === 'dot' ? <SkeletonBlock className="mt-1 h-3 w-3 flex-none rounded-full" /> : null}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-3 w-24 rounded-full" />
                <SkeletonBlock className="h-3 w-14 rounded-full" />
              </div>
              <SkeletonBlock className="h-5 w-2/3" />
              <SkeletonBlock className="h-3 w-5/6" />
              <div className="flex flex-wrap gap-2">
                <SkeletonBlock className="h-5 w-16 rounded-full" />
                <SkeletonBlock className="h-5 w-20 rounded-full" />
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

export function SkeletonDetailHeader({ showTabs = false }: { showTabs?: boolean }) {
  return (
    <div className="space-y-3">
      <section className="app-card overflow-hidden p-4">
        <div className="flex items-start gap-3">
          <SkeletonBlock className="h-16 w-16 flex-none rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock className="h-3 w-24 rounded-full" />
            <SkeletonBlock className="h-7 w-2/3" />
            <SkeletonBlock className="h-3 w-5/6" />
            <div className="flex flex-wrap gap-2 pt-1">
              <SkeletonBlock className="h-6 w-20 rounded-full" />
              <SkeletonBlock className="h-6 w-24 rounded-full" />
              <SkeletonBlock className="h-6 w-16 rounded-full" />
            </div>
          </div>
        </div>
      </section>
      {showTabs ? (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonBlock key={index} className="h-11 rounded-2xl" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SkeletonStatus({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="space-y-4">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function HomePageSkeleton() {
  return (
    <SkeletonStatus label="Loading Home">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
      <SkeletonListRows rows={3} leading="date" />
    </SkeletonStatus>
  );
}

export function SchedulePageSkeleton() {
  return (
    <SkeletonStatus label="Loading schedule">
      <div className="grid gap-3 md:grid-cols-4">
        <SkeletonBlock className="h-11 rounded-2xl" />
        <SkeletonBlock className="h-11 rounded-2xl" />
        <SkeletonBlock className="h-11 rounded-2xl" />
        <SkeletonBlock className="h-11 rounded-2xl" />
      </div>
      <SkeletonListRows rows={4} leading="date" />
    </SkeletonStatus>
  );
}

export function MessagesPageSkeleton({ embedded = false }: { embedded?: boolean }) {
  return (
    <SkeletonStatus label={embedded ? 'Loading team chat' : 'Loading team chats'}>
      <section className={`app-card p-3 sm:p-4 ${embedded ? 'chat-window-embedded' : ''}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock className="h-3 w-20 rounded-full" />
            <SkeletonBlock className="h-7 w-40" />
            <SkeletonBlock className="h-3 w-36" />
          </div>
          <SkeletonBlock className="h-10 w-10 flex-none rounded-full" />
        </div>
      </section>
      <SkeletonListRows rows={embedded ? 5 : 4} leading="avatar" />
    </SkeletonStatus>
  );
}

export function TeamDetailPageSkeleton() {
  return (
    <SkeletonStatus label="Loading team">
      <SkeletonDetailHeader showTabs />
      <div className="grid gap-3 md:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonListRows rows={3} leading="avatar" />
    </SkeletonStatus>
  );
}

export function EventDetailPageSkeleton() {
  return (
    <SkeletonStatus label="Loading event">
      <SkeletonDetailHeader showTabs />
      <SkeletonCard lines={2} />
      <SkeletonListRows rows={2} leading="avatar" />
    </SkeletonStatus>
  );
}

export function ProtectedRouteSkeleton({ pathname }: { pathname: string }) {
  if (pathname.startsWith('/schedule/')) return <EventDetailPageSkeleton />;
  if (pathname.startsWith('/schedule')) return <SchedulePageSkeleton />;
  if (pathname.startsWith('/messages/')) return <MessagesPageSkeleton embedded />;
  if (pathname.startsWith('/messages')) return <MessagesPageSkeleton />;
  if (pathname.startsWith('/teams/')) return <TeamDetailPageSkeleton />;
  return <HomePageSkeleton />;
}
