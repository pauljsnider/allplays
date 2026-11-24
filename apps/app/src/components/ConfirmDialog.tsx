import { useId } from 'react';
import { Modal } from './Modal';

// Shared in-app confirmation dialog. Native window.confirm() dialogs can be
// auto-dismissed or never surface in embedded/automated browsers, which made
// the roster Deactivate action look like a dead button (#5312). Route new
// confirmations through this component instead of window.confirm().
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmBusy = false,
  busyLabel,
  destructive = false,
  onConfirm,
  onClose
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmBusy?: boolean;
  busyLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <Modal ariaLabelledBy={titleId} onClose={onClose}>
      <section className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl">
        <h2 id={titleId} className="text-lg font-black text-gray-950">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 font-semibold text-gray-600">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="secondary-button" onClick={onClose} disabled={confirmBusy}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? 'secondary-button !border-rose-200 !bg-rose-50 !text-rose-700' : 'primary-button'}
            onClick={onConfirm}
            disabled={confirmBusy}
          >
            {confirmBusy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </section>
    </Modal>
  );
}
