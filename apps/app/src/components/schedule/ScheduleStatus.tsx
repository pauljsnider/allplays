import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface StatusProps {
  tone: 'success' | 'error';
  message: string;
}

export function Status({ tone, message }: StatusProps) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {isError ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      {message}
    </div>
  );
}
