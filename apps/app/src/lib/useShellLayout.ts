import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

const desktopQuery = '(min-width: 1024px)';

function readDesktopMatch() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(desktopQuery).matches;
}

function readNativeRuntime() {
  return typeof window !== 'undefined' && (Capacitor.isNativePlatform() || window.location.protocol === 'capacitor:');
}

export function useShellLayout() {
  const [isDesktop, setIsDesktop] = useState(readDesktopMatch);
  const [isNative, setIsNative] = useState(readNativeRuntime);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setIsDesktop(false);
      setIsNative(readNativeRuntime());
      return undefined;
    }
    const media = window.matchMedia(desktopQuery);
    const updateDesktop = () => setIsDesktop(media.matches);

    updateDesktop();
    setIsNative(readNativeRuntime());

    media.addEventListener('change', updateDesktop);
    return () => media.removeEventListener('change', updateDesktop);
  }, []);

  return {
    isDesktop,
    isNative,
    isDesktopWeb: isDesktop && !isNative
  };
}
