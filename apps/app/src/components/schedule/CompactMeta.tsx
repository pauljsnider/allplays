import type { LucideIcon } from 'lucide-react';

interface CompactMetaProps {
  icon: LucideIcon;
  value: string;
}

export function CompactMeta({ icon: Icon, value }: CompactMetaProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-gray-800">
      <Icon className="h-4 w-4 flex-none text-primary-600" aria-hidden="true" />
      <span className="min-w-0 truncate">{value}</span>
    </div>
  );
}
