let activeBodyScrollLocks = 0;
let restoredBodyOverflow = '';

export function lockBodyScroll() {
  let released = false;

  if (activeBodyScrollLocks === 0) {
    restoredBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  activeBodyScrollLocks += 1;

  return () => {
    if (released) return;
    released = true;
    activeBodyScrollLocks = Math.max(0, activeBodyScrollLocks - 1);

    if (activeBodyScrollLocks === 0) {
      document.body.style.overflow = restoredBodyOverflow;
      restoredBodyOverflow = '';
    }
  };
}
