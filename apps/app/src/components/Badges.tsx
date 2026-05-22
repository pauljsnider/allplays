import type { CapabilityCategory, MigrationStatus, UserRole } from '../lib/types';

export function RoleBadge({ role }: { role: UserRole | string }) {
  return (
    <span className="inline-flex min-h-6 items-center rounded-full border border-primary-100 bg-primary-50 px-2.5 text-[11px] font-extrabold uppercase tracking-[0.04em] text-primary-700">
      {role}
    </span>
  );
}

export function StatusBadge({ status }: { status: MigrationStatus }) {
  const label: Record<MigrationStatus, string> = {
    'native-shell': 'App route',
    stub: 'Stubbed',
    'legacy-link': 'Legacy page',
    future: 'Future'
  };

  const className: Record<MigrationStatus, string> = {
    'native-shell': 'border-emerald-200 bg-emerald-50 text-emerald-700',
    stub: 'border-amber-200 bg-amber-50 text-amber-700',
    'legacy-link': 'border-gray-200 bg-gray-50 text-gray-600',
    future: 'border-sky-200 bg-sky-50 text-sky-700'
  };

  return (
    <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 text-[11px] font-extrabold uppercase tracking-[0.04em] ${className[status]}`}>
      {label[status]}
    </span>
  );
}

export function CategoryBadge({ category }: { category: CapabilityCategory }) {
  return (
    <span className="inline-flex min-h-6 items-center rounded-full border border-gray-200 bg-white px-2.5 text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-600">
      {category}
    </span>
  );
}
