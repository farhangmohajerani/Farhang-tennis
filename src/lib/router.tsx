import { useEffect, useState } from 'react';

/**
 * Hash router using plain hash names (#library, #drill-fh-001, #session-<id>).
 * Works on static hosting (Vercel), inside sandboxed iframes / artifact viewers,
 * and on iOS Safari without server rewrites.
 */
export function currentRoute(): string {
  return window.location.hash.replace(/^#\/?/, '') || 'dashboard';
}

export function useRoute(): { name: string; param: string } {
  const [route, setRoute] = useState(currentRoute());
  useEffect(() => {
    const on = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parseRoute(route);
}

const PREFIXED = ['drill', 'session', 'planner', 'newmatch', 'match', 'tournament'] as const;

export function parseRoute(route: string): { name: string; param: string } {
  for (const p of PREFIXED) {
    if (route.startsWith(p + '-')) return { name: p, param: route.slice(p.length + 1) };
  }
  return { name: route, param: '' };
}

export function navigate(to: string) {
  if (window.location.hash.replace(/^#/, '') === to) window.scrollTo(0, 0);
  else window.location.hash = to;
}

export function href(to: string) {
  return `#${to}`;
}
