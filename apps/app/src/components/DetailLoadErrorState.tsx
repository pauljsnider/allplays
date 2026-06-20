import { Link } from 'react-router-dom';
import { RefreshCw, type LucideIcon } from 'lucide-react';
import { getAppServiceErrorMessage, type AppServiceError } from '../lib/appErrors';

type DetailLoadErrorStateProps = {
  icon: LucideIcon;
  title: string;
  error: AppServiceError | null;
  fallbackMessage: string;
  backTo: string;
  backLabel: string;
  onRetry: () => void;
  retrying?: boolean;
};

export function DetailLoadErrorState({
  icon: Icon,
  title,
  error,
  fallbackMessage,
  backTo,
  backLabel,
  onRetry,
  retrying = false
}: DetailLoadErrorStateProps) {
  return (
    <div className="space-y-4">
      <section className="app-card p-5">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 flex-none text-rose-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-gray-950">{title}</div>
            <div className="mt-1 text-sm font-semibold text-gray-600">{getAppServiceErrorMessage(error, fallbackMessage)}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="primary-button !min-h-9 text-xs" onClick={onRetry} disabled={retrying}>
                <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
                Retry
              </button>
              <Link to={backTo} className="secondary-button !min-h-9 text-xs">{backLabel}</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
