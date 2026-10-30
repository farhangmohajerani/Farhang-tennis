import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { AppState } from '../types';
import { createDemoState } from '../data/demo';
import { reducer, type Action } from './reducer';
import { translate, type DictKey, type Lang } from './i18n';
import { todayISO } from './schedule';
import type { StorageAdapter } from './storage';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'warn' | 'error';
}

interface Ctx {
  state: AppState;
  dispatch: (a: Action) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  lang: Lang;
  adapter: StorageAdapter;
  saveStatus: SaveStatus;
  saveError: string | null;
  toast: (text: string, tone?: Toast['tone']) => void;
  toasts: Toast[];
  resetDemo: () => void;
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ initial, adapter, children }: { initial: AppState; adapter: StorageAdapter; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(state);
  latest.current = state;

  // Debounced persistence on every state change (skip the initial hydrate).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaveStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      adapter
        .save(latest.current)
        .then(() => {
          setSaveStatus('saved');
          setSaveError(null);
        })
        .catch((e: unknown) => {
          setSaveStatus('error');
          setSaveError(e instanceof Error ? e.message : String(e));
        });
    }, adapter.debounceMs ?? 250);
  }, [state, adapter]);

  // Shared mode: other people's changes arrive here.
  useEffect(() => {
    adapter.subscribe?.((apply) => dispatch({ type: 'remote', apply }));
  }, [adapter]);

  // Flush pending save when the page is hidden (iOS Safari may kill the tab).
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        adapter.save(latest.current).catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [adapter]);

  const lang = state.settings.lang;
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }, [lang]);

  const t = useCallback((key: DictKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3200);
  }, []);

  const resetDemo = useCallback(() => {
    const fresh = createDemoState(todayISO());
    fresh.settings.lang = latest.current.settings.lang;
    fresh.settings.role = latest.current.settings.role;
    dispatch({ type: 'replace', state: fresh });
  }, []);

  const value = useMemo<Ctx>(
    () => ({ state, dispatch, t, lang, adapter, saveStatus, saveError, toast, toasts, resetDemo }),
    [state, t, lang, adapter, saveStatus, saveError, toast, toasts, resetDemo],
  );
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useStore must be used inside StoreProvider');
  return c;
}
