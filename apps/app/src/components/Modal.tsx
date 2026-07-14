import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { lockBodyScroll } from '../lib/bodyScrollLock';
import { APP_BACK_DISMISS_EVENT } from '../lib/nativeBackButton';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

type ModalProps = {
  children: ReactNode;
  onClose: () => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  overlayClassName?: string;
};

export function Modal({
  children,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  overlayClassName = 'z-50 flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm'
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseBodyScrollLock = lockBodyScroll();
    const frame = window.requestAnimationFrame(() => {
      const focusable = getFocusableElements(dialogRef.current);
      (focusable[0] || dialogRef.current)?.focus();
    });
    const handleNativeBackDismiss = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener(APP_BACK_DISMISS_EVENT, handleNativeBackDismiss);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(APP_BACK_DISMISS_EVENT, handleNativeBackDismiss);
      releaseBodyScrollLock();
      previousFocusRef.current?.focus?.();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements(dialogRef.current);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={dialogRef}
      className={`fixed inset-0 ${overlayClassName}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      {children}
    </div>
  );
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.getAttribute('aria-hidden') !== 'true');
}
