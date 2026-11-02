/**
 * "New version ready": the build names the bundle app.js?v=<hash> in index.html (scripts/build.mjs).
 * The running app compares its own hash with the one in a fresh copy of index.html and, when they
 * differ, offers a one-tap reload. Off in builds without a stamp (claude.ai single file, dev server).
 */
import { useEffect, useState } from 'react';

const STAMP = /app\.js\?v=([\w-]+)/;

/** The build this page is running, or null when the page has no stamped bundle. */
export function currentBuild(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[src*="app.js?v="]')?.getAttribute('src') ?? '';
  return STAMP.exec(src)?.[1] ?? null;
}

/** The build the server offers right now (bypassing every cache). */
export async function latestBuild(): Promise<string | null> {
  const res = await fetch(`./index.html?check=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return STAMP.exec(await res.text())?.[1] ?? null;
}

/** Reload into that build. A new ?v= makes the browser fetch index.html instead of a cached copy. */
export function reloadTo(build: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('v', build);
  window.location.replace(url.toString());
}

const EVERY_MS = 5 * 60 * 1000;

/** The newer build to offer, if any. Checks shortly after start, when the app comes back, and every 5 min. */
export function useNewVersion(): string | null {
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    const mine = currentBuild();
    if (!mine) return;
    let alive = true;
    let busy = false;
    const check = () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      latestBuild()
        .then((v) => {
          if (alive && v && v !== mine) setNext(v);
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    };
    const first = window.setTimeout(check, 3000);
    const timer = window.setInterval(check, EVERY_MS);
    const onBack = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, []);
  return next;
}
