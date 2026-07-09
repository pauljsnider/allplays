import { Shield } from 'lucide-react';

export function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'T';
}

export function TeamAvatar({ name, photoUrl, large = false }: { name: string; photoUrl?: string | null; large?: boolean }) {
  if (photoUrl) {
    return (
      <span className={`flex flex-none overflow-hidden rounded-2xl bg-gray-100 shadow-sm ${large ? 'h-12 w-12' : 'h-11 w-11'}`}>
        <img src={photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      </span>
    );
  }
  return (
    <span className={`flex flex-none items-center justify-center rounded-2xl bg-gray-950 font-black text-white shadow-sm ${large ? 'h-12 w-12 text-sm' : 'h-11 w-11 text-xs'}`}>
      {getInitials(name)}
    </span>
  );
}

export function TeamLauncherChip({ label, tone = 'gray' }: { label: string; tone?: 'gray' | 'primary' | 'amber' }) {
  const toneClass = tone === 'primary'
    ? 'bg-primary-50 text-primary-700'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-gray-100 text-gray-600';

  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${toneClass}`}>{label}</span>;
}

export function Status({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      <Shield className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      {message}
    </div>
  );
}
