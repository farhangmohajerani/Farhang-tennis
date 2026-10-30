import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { StoreProvider } from './lib/store';
import { createDemoState } from './data/demo';
import { todayISO } from './lib/schedule';
import { LocalStorageAdapter, MemoryAdapter, SupabaseAdapter, SupabaseAuth, supabaseConfig, type StorageAdapter } from './lib/storage';
import type { AppState } from './types';
import { artifactAdapter } from './lib/artifactDb';

async function boot(adapter: StorageAdapter): Promise<AppState> {
  try {
    const loaded = await adapter.load();
    if (loaded) return loaded;
  } catch (e) {
    console.warn('Load failed, starting from seed data', e);
  }
  const seed = createDemoState(todayISO());
  if (navigator.language?.toLowerCase().startsWith('fa')) seed.settings.lang = 'fa';
  return seed;
}

function render(state: AppState, adapter: StorageAdapter) {
  root.render(
    <StrictMode>
      <StoreProvider initial={state} adapter={adapter}>
        <App />
      </StoreProvider>
    </StrictMode>,
  );
}

function SignIn({ auth, onDone }: { auth: SupabaseAuth; onDone: (useDemo: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (mode: 'in' | 'up') => {
    setBusy(true);
    setErr('');
    try {
      if (mode === 'in') await auth.signIn(email, password);
      else await auth.signUp(email, password);
      onDone(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const cls = 'w-full rounded-xl border border-line bg-surface px-3 py-2';
  return (
    <div className="gutter mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-3">
      <h1 className="font-display text-4xl">Tennis Progress</h1>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); go('in'); }}>
        <input className={cls} type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} id="sb-email" />
        <input className={cls} type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} id="sb-password" />
        {err && <p className="text-sm font-semibold text-bad">{err}</p>}
        <button type="submit" disabled={busy} className="h-10 rounded-full bg-accent font-semibold text-accent-ink">Sign in</button>
        <button type="button" disabled={busy} onClick={() => go('up')} className="h-10 rounded-full border border-line font-semibold">Create account</button>
      </form>
      <button type="button" onClick={() => onDone(true)} className="text-sm font-semibold text-accent">Continue with demo data (this browser only)</button>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);

(async () => {
  // Inside claude.ai: shared academy database (falls back to browser demo storage if unavailable).
  const shared = await artifactAdapter().catch(() => null);
  if (shared) {
    render(await shared.load(), shared);
    return;
  }
  const cfg = supabaseConfig();
  const local: StorageAdapter = LocalStorageAdapter.available() ? new LocalStorageAdapter() : new MemoryAdapter();
  if (cfg) {
    const auth = new SupabaseAuth(cfg);
    const start = async (useDemo: boolean) => {
      const adapter = useDemo ? local : new SupabaseAdapter(cfg, auth);
      render(await boot(adapter), adapter);
    };
    if (await auth.refresh()) await start(false);
    else root.render(<SignIn auth={auth} onDone={start} />);
    return;
  }
  render(await boot(local), local);
})();
