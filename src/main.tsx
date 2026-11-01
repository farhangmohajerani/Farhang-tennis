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
  ? {
      title: 'پیشرفت تنیس', sub: 'آکادمی تنیس — ورود مربی‌ها و والدین', email: 'ایمیل', pass: 'رمز عبور (حداقل ۸ کاراکتر)',
      signIn: 'ورود', signUp: 'ساخت حساب جدید', forgot: 'رمز را فراموش کرده‌ام', show: 'نمایش رمز', hide: 'پنهان کردن رمز',
      sent: 'ایمیل بازیابی رمز فرستاده شد. روی لینک داخل ایمیل بزنید تا رمز جدید بگذارید.', newPass: 'رمز جدید (حداقل ۸ کاراکتر)',
      newPassTitle: 'رمز جدید بگذارید', save: 'ذخیرهٔ رمز و ورود', toggle: 'English',
      checkEmail: 'حساب ساخته شد. یک ایمیل تأیید برایتان فرستادیم؛ روی لینکش بزنید تا وارد شوید.',
      welcomeTitle: 'تبریک! 🎾', welcomeText: 'ایمیل شما تأیید شد و حسابتان آماده است.', enter: 'ورود به اپ',
      badLogin: 'ایمیل یا رمز اشتباه است. اگر رمز را فراموش کرده‌اید، «رمز را فراموش کرده‌ام» را بزنید.',
      exists: 'با این ایمیل قبلاً حساب ساخته شده. «ورود» را بزنید.', notConfirmed: 'ایمیل هنوز تأیید نشده. روی لینک ایمیل تأیید بزنید.',
      expired: 'این لینک منقضی شده یا قبلاً استفاده شده. دوباره «رمز را فراموش کرده‌ام» را بزنید یا وارد شوید.',
      tooMany: 'تعداد درخواست‌ها زیاد بود. چند دقیقه صبر کنید و دوباره امتحان کنید.', passwordSaved: 'رمز ذخیره شد.',
      tabSignIn: 'ورود', tabSignUp: 'ساخت حساب', whoAreYou: 'شما کدام هستید؟', coach: 'مربی', parent: 'والدین / خانواده',
      coachHint: 'مدیر آکادمی باید دسترسی شما را تأیید کند.', parentHint: 'بعد از ثبت‌نام یک کد ۶ رقمی می‌گیرید که به مربی می‌دهید.',
      pickType: 'اول انتخاب کنید مربی هستید یا والدین.',
      pwHint: 'رمز عبور حداقل ۸ کاراکتر',
      pendingTitle: 'درخواست شما فرستاده شد', pendingText: 'حساب مربی شما ساخته شد. مدیر آکادمی باید دسترسی‌تان را تأیید کند. بعد از تأیید، همین صفحه را دوباره باز کنید.',
      checkAgain: 'دوباره بررسی کن', signOut: 'خروج',
    }
  : {
      title: 'Tennis Progress', sub: 'Tennis academy — sign in for coaches and parents', email: 'Email', pass: 'Password (8+ characters)',
      signIn: 'Sign in', signUp: 'Create an account', forgot: 'Forgot password', show: 'Show password', hide: 'Hide password',
      sent: 'Password reset email sent. Open the link in it to choose a new password.', newPass: 'New password (8+ characters)',
      newPassTitle: 'Choose a new password', save: 'Save password and continue', toggle: 'فارسی',
      checkEmail: 'Account created. We sent you a confirmation email — open its link to sign in.',
      welcomeTitle: 'Congratulations! 🎾', welcomeText: 'Your email is confirmed and your account is ready.', enter: 'Open the app',
      badLogin: 'Wrong email or password. If you forgot your password, tap “Forgot password”.',
      exists: 'An account with this email already exists. Tap “Sign in”.', notConfirmed: 'Your email is not confirmed yet. Open the link in the confirmation email.',
      expired: 'This link has expired or was already used. Tap “Forgot password” again, or sign in.',
      tooMany: 'Too many attempts. Wait a few minutes and try again.', passwordSaved: 'Password saved.',
      tabSignIn: 'Sign in', tabSignUp: 'Create account', whoAreYou: 'Who are you?', coach: 'Coach', parent: 'Parent / family',
      coachHint: 'The academy admin approves coach access.', parentHint: 'After signing up you get a 6-digit code to give to your coach.',
      pickType: 'First choose whether you are a coach or a parent.',
      pwHint: 'Password: at least 8 characters',
      pendingTitle: 'Request sent', pendingText: 'Your coach account is created. The academy admin needs to approve your access. Open this page again once approved.',
      checkAgain: 'Check again', signOut: 'Sign out',
    };

function friendly(raw: string): string {
  if (/invalid login credentials/i.test(raw)) return T.badLogin;
  if (/already registered|already exists/i.test(raw)) return T.exists;
  if (/not confirmed/i.test(raw)) return T.notConfirmed;
  if (/rate limit|too many|429/i.test(raw)) return T.tooMany;
  if (/confirm/i.test(raw)) return T.checkEmail;
  return raw;
}

type Screen = 'signin' | 'recovery' | 'welcome';

function SignIn({ auth, onDone, screen: initial = 'signin', notice }: { auth: SupabaseAuth; onDone: () => void; screen?: Screen; notice?: string }) {
  const [screen] = useState<Screen>(initial);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [kind, setKind] = useState<'coach' | 'parent' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(notice ? { text: notice, bad: true } : null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      const text = friendly(e instanceof Error ? e.message : String(e));
      setMsg({ text, bad: text !== T.checkEmail });
    } finally {
      setBusy(false);
    }
  };
  const cls = 'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink';
  const primary = 'h-11 rounded-full bg-accent font-semibold text-accent-ink disabled:opacity-40';
  const note = msg && (
    <p className={msg.bad ? 'text-sm font-semibold text-bad' : 'text-sm font-semibold text-good'} role="alert" data-testid="auth-message">
      {msg.text}
    </p>
  );
  return (
    <div className="gutter mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-4" dir={fa ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="font-display text-4xl">{T.title}</h1>
        <p className="text-sm text-muted">{T.sub}</p>
      </div>
      {screen === 'welcome' ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5" data-testid="welcome">
          <h2 className="font-display text-3xl">{T.welcomeTitle}</h2>
          <p>{T.welcomeText}</p>
          <button type="button" className={primary} onClick={onDone}>{T.enter}</button>
        </div>
      ) : screen === 'recovery' ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(() => auth.updatePassword(password), onDone); }}>
          <h2 className="font-display text-2xl">{T.newPassTitle}</h2>
          <input className={cls} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder={T.newPass} value={password} onChange={(e) => setPassword(e.target.value)} id="sb-newpass" dir="ltr" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {T.show}</label>
          {note}
          <button type="submit" disabled={busy || password.length < 8} className={primary} data-testid="save-new-password">{T.save}</button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 rounded-full border border-line bg-surface p-1" role="tablist">
            {(['in', 'up'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                data-testid={`tab-${m}`}
                onClick={() => { setMode(m); setMsg(null); }}
                className={mode === m ? 'h-10 rounded-full bg-band font-semibold text-band-ink' : 'h-10 rounded-full font-semibold text-muted'}
              >
                {m === 'in' ? T.tabSignIn : T.tabSignUp}
              </button>
            ))}
          </div>
          {mode === 'up' && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">{T.whoAreYou}</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['coach', 'parent'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    data-testid={`kind-${k}`}
                    onClick={() => setKind(k)}
                    className={kind === k ? 'rounded-2xl border-2 border-accent bg-accent-soft p-3 text-start' : 'rounded-2xl border-2 border-line bg-surface p-3 text-start'}
                  >
                    <span className="block text-2xl" aria-hidden="true">{k === 'coach' ? '🎾' : '👨‍👩‍👧'}</span>
                    <span className="block font-semibold">{k === 'coach' ? T.coach : T.parent}</span>
                  </button>
                ))}
              </div>
              {kind && <p className="text-[13px] text-muted">{kind === 'coach' ? T.coachHint : T.parentHint}</p>}
            </fieldset>
          )}
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === 'in') void run(() => auth.signIn(email.trim(), password), onDone);
              else if (!kind) setMsg({ text: T.pickType, bad: true });
              else
                void run(async () => {
                  try {
                    await auth.signUp(email.trim(), password, kind);
                  } catch (e) {
                    // Accounts are confirmed automatically on the server; sign straight in.
                    if (/confirm/i.test(e instanceof Error ? e.message : String(e))) await auth.signIn(email.trim(), password);
                    else throw e;
                  }
                }, onDone);
            }}
          >
            <input className={cls} type="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={T.email} value={email} onChange={(e) => setEmail(e.target.value)} id="sb-email" dir="ltr" />
            <input className={cls} type={show ? 'text' : 'password'} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} autoCapitalize="none" autoCorrect="off" placeholder={T.pass} value={password} onChange={(e) => setPassword(e.target.value)} id="sb-password" dir="ltr" />
            {mode === 'up' && <p className={`-mt-1 text-[13px] ${password && password.length < 8 ? 'font-semibold text-bad' : 'text-muted'}`} data-testid="pw-hint">{T.pwHint}{password ? ` (${password.length}/8)` : ''}</p>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {T.show}</label>
            {note}
            {mode === 'in' ? (
              <button type="submit" disabled={busy || !email || !password} className={primary} data-testid="sign-in">{T.signIn}</button>
            ) : (
              <button type="submit" disabled={busy || !email || password.length < 8} className={primary} data-testid="sign-up">{T.signUp}</button>
            )}
            {mode === 'in' && (
              <button type="button" disabled={busy || !email} className="text-sm font-semibold text-accent disabled:opacity-40" data-testid="forgot" onClick={() => void run(() => auth.resetPassword(email.trim()), () => setMsg({ text: T.sent, bad: false }))}>
                {T.forgot}
              </button>
            )}
          </form>
        </div>
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

function PendingCoach({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="gutter mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-4" dir={fa ? 'rtl' : 'ltr'} data-testid="pending-coach">
      <h1 className="font-display text-4xl">{T.title}</h1>
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display text-2xl">{T.pendingTitle}</h2>
        <p>{T.pendingText}</p>
        <p className="text-sm text-muted" dir="ltr">{email}</p>
        <button type="button" className="h-11 rounded-full bg-accent font-semibold text-accent-ink" onClick={() => window.location.reload()}>{T.checkAgain}</button>
        <button type="button" className="h-11 rounded-full border border-line font-semibold" onClick={onSignOut}>{T.signOut}</button>
      </div>
    </div>
  );
}

async function startSupabase(cfg: SupabaseConfig, auth: SupabaseAuth) {
  const db = new SupabaseDocDb(cfg, auth);
  const user = await supabaseUser(db, auth);
  if (user.pendingCoach) {
    db.stop();
    root.render(<PendingCoach email={user.email} onSignOut={() => { auth.signOut(); window.location.reload(); }} />);
    return;
  }
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
      let requests: { user_id: string; email: string }[] = [];
      if (user.role === 'admin') {
        try {
          requests = (await (await rest('staff_requests?select=user_id,email&order=created_at')).json()) as typeof requests;
        } catch {
          /* table not set up yet */
        }
      }
      return [
        ...requests.filter((r) => !staff.some((x) => x.user_id === r.user_id)).map((r): TeamMember => ({ email: r.email, role: 'coach', pending: true, requested: true, userId: r.user_id })),
        ...staff.map((s): TeamMember => ({ email: s.email, role: s.role, pending: false, userId: s.user_id })),
        ...invites.map((i): TeamMember => ({ ...i, pending: true })),
      ];
    },
    async invite(email, role) {
      await rest('staff_invites?on_conflict=email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ email, role }) });
    },
    async approve(m) {
      await db.rpc('approve_coach', { p_user: m.userId, p_role: 'coach' });
    },
    async remove(m) {
      if (m.requested) await rest(`staff_requests?user_id=eq.${m.userId}`, { method: 'DELETE' });
      else if (m.pending) await rest(`staff_invites?email=eq.${encodeURIComponent(m.email)}`, { method: 'DELETE' });
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
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const linkType = h.get('type');
    const linkError = h.get('error_code') || h.get('error');
    if (linkError) history.replaceState(null, '', window.location.pathname + window.location.search);
    // Only an email-link hash (#access_token=… / #error=…) is cleared; a normal page hash
    // (#planner, #session-…) is kept so a refresh stays on the same page.
    const authHash = /(^|[#&])(access_token|error|error_code|type)=/.test(window.location.hash);
    const fromLink = auth.fromUrl();
    const go = () => {
      if (authHash && /(access_token|error|type)=/.test(window.location.hash)) window.location.hash = '';
      void startSupabase(cfg, auth).catch((e) => {
        console.error(e);
        root.render(<SignIn auth={auth} onDone={go} />);
      });
    };
    if (linkError) root.render(<SignIn auth={auth} onDone={go} notice={T.expired} />);
    else if (fromLink && linkType === 'recovery') root.render(<SignIn auth={auth} onDone={go} screen="recovery" />);
    else if (fromLink && (linkType === 'signup' || linkType === 'invite' || linkType === 'email_change')) root.render(<SignIn auth={auth} onDone={go} screen="welcome" />);
    else if (await auth.refresh()) go();
    else root.render(<SignIn auth={auth} onDone={go} />);
    return;
  }
  const local: StorageAdapter = LocalStorageAdapter.available() ? new LocalStorageAdapter() : new MemoryAdapter();
  render(await boot(local), local);
})();
