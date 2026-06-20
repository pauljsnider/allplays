import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const scrollPositions = new Map<string, number>();

export function ScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const scrollKey = getScrollKey(location);
  const previousPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = location.pathname;

    if (navigationType === 'REPLACE' && previousPathname === location.pathname) {
      return () => {
        scrollPositions.set(scrollKey, getWindowScrollY());
      };
    }

    const frame = window.requestAnimationFrame(() => {
      const top = navigationType === 'POP' ? scrollPositions.get(scrollKey) || 0 : 0;
      restoreWindowScroll(top);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      scrollPositions.set(scrollKey, getWindowScrollY());
    };
  }, [location.pathname, navigationType, scrollKey]);

  return null;
}

export function clearScrollRestorationForTests() {
  scrollPositions.clear();
}

function getScrollKey(location: { key?: string; pathname: string; search: string }) {
  return location.key || `${location.pathname}${location.search}`;
}

function getWindowScrollY() {
  return Math.max(0, Number(window.scrollY || window.pageYOffset || 0));
}

function restoreWindowScroll(top: number) {
  try {
    window.scrollTo({ top, left: 0, behavior: 'auto' });
  } catch {
    try {
      window.scrollTo(0, top);
    } catch {
      // Some test environments expose scrollTo but do not implement it.
    }
  }
}
