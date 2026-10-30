import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { StoreProvider } from './lib/store';
import { createDemoState } from './data/demo';
import { todayISO } from './lib/schedule';
import { LocalStorageAdapter, MemoryAdapter, SupabaseAuth, supabaseConfig, type SupabaseConfig, type StorageAdapter } from './lib/storage';
import type { AppState } from './types';
import { ArtifactDbAdapter, artifactAdapter } from './lib/artifactDb';
import { SupabaseDocDb, supabaseUser } from './lib/supabaseDb';
import { roomPairing, rpcPairing, setPairing } from './lib/pairing';
import { setTeam, type TeamMember } from './lib/team';

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

const fa = (() => {
  try {
    const p = JSON.parse(window.localStorage.getItem('tennis-progress:prefs') ?? '{}');
    if (p.lang) return p.lang === 'fa';
  } catch {
    /* ignore */
  }
  return navigator.language?.toLowerCase().startsWith('fa');
})();
const T = fa
  ? { title: 'پیشرفت تنیس', sub: 'آکادمی تنیس — ورود مربی‌ها و والدین', email: 'ایمیل', pass: 'رمز عبور (حداقل ۸ کاراکتر)', signIn: 'ورود', signUp: 'ساخت حساب جدید', forgot: 'رمز را فراموش کرده‌ام', sent: 'ایمیل بازیابی رمز فرستاده شد.', newPass: 'رمز جدید', save: 'ذخیرهٔ رمز', toggle: 'English', created: 'حساب ساخته شد. اگر ایمیل تأیید آمد، روی لینکش بزنید و بعد وارد شوید.' }
  : { title: 'Tennis Progress', sub: 'Tennis academy — sign in for coaches and parents', email: 'Email', pass: 'Password (8+ characters)', signIn: 'Sign in', signUp: 'Create an account', forgot: 'Forgot password', sent: 'Password reset email sent.', newPass: 'New password', save: 'Save password', toggle: 'فارسی', created: 'Account created. If a confirmation email arrives, open its link, then sign in.' };

function SignIn({ auth, onDone, recovery }: { auth: SupabaseAuth; onDone: () => void; recovery?: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (/confirm/i.test(text)) setMsg({ text: T.created, bad: false });
      else setMsg({ text, bad: true });
    } finally {
      setBusy(false);
    }
  };
  const cls = 'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink';
  return (
    <div className="gutter mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-4" dir={fa ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="font-display text-4xl">{T.title}</h1>
        <p className="text-sm text-muted">{T.sub}</p>
      </div>
      {recovery ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(() => auth.updatePassword(password), onDone); }}>
          <input className={cls} type="password" autoComplete="new-password" placeholder={T.newPass} value={password} onChange={(e) => setPassword(e.target.value)} id="sb-newpass" />
          {msg && <p className={msg.bad ? 'text-sm font-semibold text-bad' : 'text-sm font-semibold text-good'}>{msg.text}</p>}
          <button type="submit" disabled={busy || password.length < 8} className="h-11 rounded-full bg-accent font-semibold text-accent-ink disabled:opacity-40">{T.save}</button>
        </form>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(() => auth.signIn(email.trim(), password), onDone); }}>
          <input className={cls} type="email" autoComplete="email" placeholder={T.email} value={email} onChange={(e) => setEmail(e.target.value)} id="sb-email" dir="ltr" />
          <input className={cls} type="password" autoComplete="current-password" placeholder={T.pass} value={password} onChange={(e) => setPassword(e.target.value)} id="sb-password" dir="ltr" />
          {msg && <p className={msg.bad ? 'text-sm font-semibold text-bad' : 'text-sm font-semibold text-good'} role="alert">{msg.text}</p>}
          <button type="submit" disabled={busy || !email || !password} className="h-11 rounded-full bg-accent font-semibold text-accent-ink disabled:opacity-40" data-testid="sign-in">{T.signIn}</button>
          <button
            type="button"
            disabled={busy || !email || password.length < 8}
            className="h-11 rounded-full border border-line font-semibold disabled:opacity-40"
            data-testid="sign-up"
            onClick={() => void run(async () => { await auth.signUp(email.trim(), password); }, onDone)}
          >
            {T.signUp}
          </button>
          <button type="button" disabled={busy || !email} className="text-sm font-semibold text-accent disabled:opacity-40" onClick={() => void run(() => auth.resetPassword(email.trim()), () => setMsg({ text: T.sent, bad: false }))}>
            {T.forgot}
          </button>
        </form>
      )}
      <button
        type="button"
        className="self-start text-[13px] text-muted underline"
        onClick={() => {
          try {
            const p = JSON.parse(window.localStorage.getItem('tennis-progress:prefs') ?? '{}');
            window.localStorage.setItem('tennis-progress:prefs', JSON.stringify({ ...p, lang: fa ? 'en' : 'fa' }));
          } catch {
            /* ignore */
          }
          window.location.reload();
        }}
      >
        {T.toggle}
      </button>
    </div>
  );
}

async function startSupabase(cfg: SupabaseConfig, auth: SupabaseAuth) {
  const db = new SupabaseDocDb(cfg, auth);
  const user = await supabaseUser(db, auth);
  setPairing(rpcPairing((fn, args) => db.rpc(fn, args)));
  const rest = async (path: string, init: RequestInit = {}) => {
    const s = await auth.refresh();
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(init.headers as Record<string, string>) },
    });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return res;
  };
  setTeam({
    myEmail: user.email,
    signOut: () => {
      auth.signOut();
      window.location.reload();
    },
    async list() {
      const staff = (await (await rest('staff?select=user_id,email,role&order=email')).json()) as { user_id: string; email: string; role: 'admin' | 'coach' }[];
      const invites = user.role === 'admin' ? ((await (await rest('staff_invites?select=email,role&order=email')).json()) as { email: string; role: 'admin' | 'coach' }[]) : [];
      return [...staff.map((s): TeamMember => ({ email: s.email, role: s.role, pending: false, userId: s.user_id })), ...invites.map((i): TeamMember => ({ ...i, pending: true }))];
    },
    async invite(email, role) {
      await rest('staff_invites?on_conflict=email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ email, role }) });
    },
    async remove(m) {
      if (m.pending) await rest(`staff_invites?email=eq.${encodeURIComponent(m.email)}`, { method: 'DELETE' });
      else await rest(`staff?user_id=eq.${m.userId}`, { method: 'DELETE' });
    },
  });
  const adapter = new ArtifactDbAdapter(db, user, `Shared academy database (Supabase) — saved for all coaches; parents see only their own child`);
  render(await adapter.load(), adapter);
}

const root = createRoot(document.getElementById('root')!);

(async () => {
  // Inside claude.ai: shared academy database (falls back to browser demo storage if unavailable).
  const shared = await artifactAdapter().catch(() => null);
  if (shared) {
    const p = roomPairing();
    if (p) setPairing(p);
    render(await shared.load(), shared);
    return;
  }
  const cfg = supabaseConfig();
  if (cfg) {
    const auth = new SupabaseAuth(cfg);
    const isRecovery = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type') === 'recovery';
    const fromLink = auth.fromUrl();
    const go = () => void startSupabase(cfg, auth).catch((e) => {
      console.error(e);
      root.render(<SignIn auth={auth} onDone={go} />);
    });
    if (fromLink && isRecovery) root.render(<SignIn auth={auth} onDone={go} recovery />);
    else if (await auth.refresh()) go();
    else root.render(<SignIn auth={auth} onDone={go} />);
    return;
  }
  const local: StorageAdapter = LocalStorageAdapter.available() ? new LocalStorageAdapter() : new MemoryAdapter();
  render(await boot(local), local);
})();
