import { useEffect, useState } from 'react';
import { isNativeRuntime as readNativeRuntime } from './nativeRuntime';

const desktopQuery = '(min-width: 1024px)';

type MediaQueryWithLegacyListeners = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

function readDesktopMatch() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(desktopQuery).matches;
}

function subscribeToMediaQuery(media: MediaQueryWithLegacyListeners, listener: (event: MediaQueryListEvent) => void) {
  if (typeof media.addEventListener === 'function' && typeof media.removeEventListener === 'function') {
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }

  if (typeof media.addListener === 'function' && typeof media.removeListener === 'function') {
    media.addListener(listener);
    return () => media.removeListener(listener);
  }

  return () => undefined;
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
    const media = window.matchMedia(desktopQuery) as MediaQueryWithLegacyListeners;
    const updateDesktop = () => setIsDesktop(media.matches);

    updateDesktop();
    setIsNative(readNativeRuntime());

    return subscribeToMediaQuery(media, updateDesktop);
  }, []);

  return {
    isDesktop,
    isNative,
    isDesktopWeb: isDesktop && !isNative
  };
}
