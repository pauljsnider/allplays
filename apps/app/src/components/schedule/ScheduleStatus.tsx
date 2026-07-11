import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface StatusProps {
  tone: 'success' | 'warning' | 'error';
  message: string;
}

export function Status({ tone, message }: StatusProps) {
  const config = {
    success: {
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      icon: CheckCircle2
    },
    warning: {
      className: 'border-amber-200 bg-amber-50 text-amber-800',
      icon: AlertTriangle
    },
    error: {
      className: 'border-rose-200 bg-rose-50 text-rose-800',
      icon: AlertCircle
    }
  }[tone];
  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${config.className}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      {message}
    </div>
  );
}
