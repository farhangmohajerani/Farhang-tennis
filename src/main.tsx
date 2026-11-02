import { StrictMode, useEffect, useState } from 'react';
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
import { roomPairing, setPairing } from './lib/pairing';
import { setTeam, type TeamMember } from './lib/team';
import { setMyPlan } from './lib/access';
import { cleanUsername, setSocial, USERNAME_RE, type Connection, type Member, type SearchHit, type Social } from './lib/social';

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
      title: '21GRAM Tennis', sub: 'ورود مربی‌ها و خانواده‌ها', email: 'ایمیل', pass: 'رمز عبور (حداقل ۸ کاراکتر)',
      signIn: 'ورود', signUp: 'ساخت حساب جدید', forgot: 'رمز را فراموش کرده‌ام', show: 'نمایش رمز', hide: 'پنهان کردن رمز',
      sent: 'ایمیل بازیابی رمز فرستاده شد. روی لینک داخل ایمیل بزنید تا رمز جدید بگذارید.', newPass: 'رمز جدید (حداقل ۸ کاراکتر)',
      newPassTitle: 'رمز جدید بگذارید', save: 'ذخیرهٔ رمز و ورود', toggle: 'English',
      checkEmail: 'حساب ساخته شد. یک ایمیل تأیید برایتان فرستادیم؛ روی لینکش بزنید تا وارد شوید.',
      welcomeTitle: 'تبریک! 🎾', welcomeText: 'ایمیل شما تأیید شد و حسابتان آماده است.', enter: 'ورود به اپ',
      badLogin: 'ایمیل یا رمز اشتباه است. اگر رمز را فراموش کرده‌اید، «رمز را فراموش کرده‌ام» را بزنید.',
      exists: 'با این ایمیل قبلاً حساب ساخته شده. «ورود» را بزنید.', notConfirmed: 'ایمیل هنوز تأیید نشده. روی لینک ایمیل تأیید بزنید.',
      expired: 'این لینک منقضی شده یا قبلاً استفاده شده. دوباره «رمز را فراموش کرده‌ام» را بزنید یا وارد شوید.',
      tooMany: 'تعداد درخواست‌ها زیاد بود. چند دقیقه صبر کنید و دوباره امتحان کنید.', passwordSaved: 'رمز ذخیره شد.',
      tabSignIn: 'ورود', tabSignUp: 'ساخت حساب', whoAreYou: 'شما کدام هستید؟', coach: 'مربی', parent: 'خانواده / بازیکن',
      coachHint: 'بعد از ورود، بازیکن‌هایتان را با نام کاربری‌شان پیدا می‌کنید و برایشان درخواست می‌فرستید.', parentHint: 'یک حساب برای یک بازیکن. بعد از ورود، مربی‌تان را با نام کاربری‌اش پیدا می‌کنید و درخواست می‌فرستید.',
      pickType: 'اول انتخاب کنید مربی هستید یا خانواده.',
      pwHint: 'رمز عبور حداقل ۸ کاراکتر',
      username: 'نام کاربری', usernameHint: 'حروف کوچک انگلیسی، عدد، نقطه یا _ — ۳ تا ۲۴ کاراکتر. مثلاً yaman',
      yourName: 'نام شما', playerName: 'نام بازیکن', birthYear: 'سال تولد بازیکن (میلادی)', badYear: 'سال تولد درست نیست.',
      setupTitle: 'نام کاربری خود را بسازید', setupText: 'مربی‌ها و خانواده‌ها همدیگر را با نام کاربری پیدا می‌کنند و به هم متصل می‌شوند.',
      available: 'آزاد است ✓', taken: 'این نام کاربری قبلاً گرفته شده؛ یکی دیگر بنویسید.', checking: 'در حال بررسی…',
      setupSave: 'ذخیره و ادامه', setupFailed: 'ذخیره نشد. اینترنت را چک کنید و دوباره امتحان کنید.', adminCoach: 'حساب مدیر به‌عنوان مربی هم کار می‌کند.',
      signOut: 'خروج', deleted: 'حساب شما حذف شد.',
    }
  : {
      title: '21GRAM Tennis', sub: 'Sign in for coaches and families', email: 'Email', pass: 'Password (8+ characters)',
      signIn: 'Sign in', signUp: 'Create an account', forgot: 'Forgot password', show: 'Show password', hide: 'Hide password',
      sent: 'Password reset email sent. Open the link in it to choose a new password.', newPass: 'New password (8+ characters)',
      newPassTitle: 'Choose a new password', save: 'Save password and continue', toggle: 'فارسی',
      checkEmail: 'Account created. We sent you a confirmation email — open its link to sign in.',
      welcomeTitle: 'Congratulations! 🎾', welcomeText: 'Your email is confirmed and your account is ready.', enter: 'Open the app',
      badLogin: 'Wrong email or password. If you forgot your password, tap “Forgot password”.',
      exists: 'An account with this email already exists. Tap “Sign in”.', notConfirmed: 'Your email is not confirmed yet. Open the link in the confirmation email.',
      expired: 'This link has expired or was already used. Tap “Forgot password” again, or sign in.',
      tooMany: 'Too many attempts. Wait a few minutes and try again.', passwordSaved: 'Password saved.',
      tabSignIn: 'Sign in', tabSignUp: 'Create account', whoAreYou: 'Who are you?', coach: 'Coach', parent: 'Family / player',
      coachHint: 'After signing up, find your players by their username and send them a request.', parentHint: 'One account per player. After signing up, find your coach by their username and send a request.',
      pickType: 'First choose: coach or family.',
      pwHint: 'Password: at least 8 characters',
      username: 'Username', usernameHint: 'Lowercase English letters, digits, . or _ — 3 to 24 characters. For example: yaman',
      yourName: 'Your name', playerName: "Player's name", birthYear: "Player's birth year", badYear: 'That birth year does not look right.',
      setupTitle: 'Create your username', setupText: 'Coaches and families find each other by username and connect.',
      available: 'Available ✓', taken: 'This username is taken — choose another.', checking: 'Checking…',
      setupSave: 'Save and continue', setupFailed: 'Could not save. Check the internet and try again.', adminCoach: 'The admin account also works as a coach.',
      signOut: 'Sign out', deleted: 'Your account has been deleted.',
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
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
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
          {mode === 'up' && kind && <ProfileFields kind={kind === 'coach' ? 'coach' : 'family'} username={username} setUsername={setUsername} name={name} setName={setName} year={year} setYear={setYear} />}
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === 'in') void run(() => auth.signIn(email.trim(), password), onDone);
              else if (!kind) setMsg({ text: T.pickType, bad: true });
              else if (!profileOk(kind === 'coach' ? 'coach' : 'family', username, name, year)) setMsg({ text: T.usernameHint, bad: true });
              else
                void run(async () => {
                  const profile = { username, displayName: name.trim(), birthYear: kind === 'parent' && year ? Number(year) : null };
                  try {
                    await auth.signUp(email.trim(), password, kind, profile);
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
              <button
                type="submit"
                disabled={busy || !email || password.length < 8 || !kind || !profileOk(kind === 'coach' ? 'coach' : 'family', username, name, year)}
                className={primary}
                data-testid="sign-up"
              >
                {T.signUp}
              </button>
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

const thisYear = new Date().getFullYear();
const yearOk = (y: string) => !y || (/^\d{4}$/.test(y) && Number(y) >= thisYear - 90 && Number(y) <= thisYear - 3);
function profileOk(kind: 'coach' | 'family', username: string, name: string, year: string) {
  return USERNAME_RE.test(username) && name.trim().length >= 2 && name.trim().length <= 60 && (kind === 'coach' || yearOk(year));
}

const fieldCls = 'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink';

/** Username, name and (for a family) the player's birth year: at sign-up and on the profile screen. */
function ProfileFields({
  kind, username, setUsername, name, setName, year, setYear, status,
}: {
  kind: 'coach' | 'family'; username: string; setUsername: (v: string) => void; name: string; setName: (v: string) => void;
  year: string; setYear: (v: string) => void; status?: 'checking' | 'available' | 'taken' | null;
}) {
  const badName = username.length > 0 && !USERNAME_RE.test(username);
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {T.username}
        <span className="flex items-center rounded-xl border border-line bg-surface ps-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent" dir="ltr">
          <span className="text-muted">@</span>
          <input
            id="sb-username"
            className="min-w-0 flex-1 bg-transparent px-1 py-2.5 font-normal text-ink"
            style={{ outline: 'none' }}
            value={username}
            onChange={(e) => setUsername(cleanUsername(e.target.value))}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            spellCheck={false}
            placeholder="yaman"
          />
        </span>
        <span className={`text-[13px] font-normal ${badName || status === 'taken' ? 'font-semibold text-bad' : status === 'available' ? 'font-semibold text-good' : 'text-muted'}`} data-testid="username-hint">
          {status === 'taken' ? T.taken : status === 'available' ? T.available : status === 'checking' ? T.checking : T.usernameHint}
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {kind === 'coach' ? T.yourName : T.playerName}
        <input id="sb-name" className={`${fieldCls} font-normal`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="name" dir="auto" />
      </label>
      {kind === 'family' && (
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {T.birthYear}
          <input
            id="sb-birthyear"
            className={`${fieldCls} font-normal`}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder={String(thisYear - 12)}
            dir="ltr"
          />
          {year.length === 4 && !yearOk(year) && <span className="text-[13px] font-semibold text-bad">{T.badYear}</span>}
        </label>
      )}
    </div>
  );
}

type RegisterResult = { ok?: boolean; error?: string } | null;

/** First sign-in without a profile (or the username was taken at sign-up): choose it here. */
function ProfileSetup({
  initial, fixedKind, error, register, available, onDone, onSignOut,
}: {
  initial: { kind: 'coach' | 'family' | null; username: string; displayName: string; birthYear: number | null };
  fixedKind: 'coach' | null;
  error: string;
  register: (p: { kind: 'coach' | 'family'; username: string; displayName: string; birthYear: number | null }) => Promise<RegisterResult>;
  available: (u: string) => Promise<boolean>;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [kind, setKind] = useState<'coach' | 'family' | null>(fixedKind ?? initial.kind);
  const [username, setUsername] = useState(cleanUsername(initial.username));
  const [name, setName] = useState(initial.displayName);
  const [year, setYear] = useState(initial.birthYear ? String(initial.birthYear) : '');
  const [status, setStatus] = useState<'checking' | 'available' | 'taken' | null>(error === 'username_taken' ? 'taken' : null);
  const [msg, setMsg] = useState(error && error !== 'username_taken' ? T.setupFailed : '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!USERNAME_RE.test(username)) return setStatus(null);
    setStatus('checking');
    let live = true;
    const timer = setTimeout(() => {
      available(username)
        .then((ok) => live && setStatus(ok ? 'available' : 'taken'))
        .catch(() => live && setStatus(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [username, available]);
  const ok = !!kind && profileOk(kind, username, name, year) && status !== 'taken';
  return (
    <div className="gutter mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-4" dir={fa ? 'rtl' : 'ltr'} data-testid="profile-setup">
      <h1 className="font-display text-4xl">{T.title}</h1>
      <form
        className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok || !kind) return;
          setBusy(true);
          setMsg('');
          try {
            const r = await register({ kind, username, displayName: name.trim(), birthYear: kind === 'family' && year ? Number(year) : null });
            if (r?.ok || r?.error === 'exists') return onDone();
            if (r?.error === 'username_taken') setStatus('taken');
            else setMsg(T.setupFailed);
          } catch {
            setMsg(T.setupFailed);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-display text-2xl">{T.setupTitle}</h2>
        <p className="text-sm text-muted">{T.setupText}</p>
        {fixedKind ? (
          <p className="rounded-xl bg-accent-soft px-3 py-2 text-[13px] font-semibold">🎾 {T.coach} — {T.adminCoach}</p>
        ) : (
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-1 text-sm font-semibold">{T.whoAreYou}</legend>
            {(['coach', 'family'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                data-testid={`setup-kind-${k}`}
                onClick={() => setKind(k)}
                className={kind === k ? 'rounded-2xl border-2 border-accent bg-accent-soft p-3 text-start' : 'rounded-2xl border-2 border-line bg-surface p-3 text-start'}
              >
                <span className="block text-2xl" aria-hidden="true">{k === 'coach' ? '🎾' : '👨‍👩‍👧'}</span>
                <span className="block font-semibold">{k === 'coach' ? T.coach : T.parent}</span>
              </button>
            ))}
          </fieldset>
        )}
        {kind && <ProfileFields kind={kind} username={username} setUsername={setUsername} name={name} setName={setName} year={year} setYear={setYear} status={status} />}
        {msg && <p className="text-sm font-semibold text-bad" role="alert">{msg}</p>}
        <button type="submit" disabled={busy || !ok} className="h-11 rounded-full bg-accent font-semibold text-accent-ink disabled:opacity-40" data-testid="setup-save">
          {busy ? '…' : T.setupSave}
        </button>
        <button type="button" className="text-sm font-semibold text-muted underline" onClick={onSignOut}>
          {T.signOut}
        </button>
      </form>
    </div>
  );
}

interface RawHit { username: string; display_name: string; kind: 'coach' | 'family'; status: SearchHit['status']; direction: SearchHit['direction'] }
interface RawConn { username: string; display_name: string; kind: 'coach' | 'family'; status: Connection['status']; direction: Connection['direction']; player_id: string; since: string }
interface RawMember { user_id: string; username: string; display_name: string; kind: 'coach' | 'family'; email: string; created_at: string; connections: number }

async function startSupabase(cfg: SupabaseConfig, auth: SupabaseAuth, restart: () => void) {
  const db = new SupabaseDocDb(cfg, auth);
  let user = await supabaseUser(db, auth);
  if (!user.profile) {
    // Everyone has a username (supabase/social.sql). The admin's account works as a coach.
    const fixedKind = user.role ? 'coach' : null;
    const typed = auth.signupProfile();
    const register = (x: { kind: 'coach' | 'family'; username: string; displayName: string; birthYear: number | null }) =>
      db.rpc<RegisterResult>('register_profile', { p_username: x.username, p_display_name: x.displayName, p_kind: x.kind, p_birth_year: x.birthYear });
    let error = '';
    const kind = fixedKind ?? typed.kind;
    if (kind && USERNAME_RE.test(typed.username) && typed.displayName.trim()) {
      // Typed at sign-up: save it now.
      const r = await register({ kind, username: typed.username, displayName: typed.displayName, birthYear: typed.birthYear ?? null }).catch((): RegisterResult => ({ error: 'failed' }));
      if (r?.ok || r?.error === 'exists') user = await supabaseUser(db, auth);
      else error = r?.error ?? 'failed';
    }
    if (!user.profile) {
      db.stop();
      root.render(
        <ProfileSetup
          initial={{ ...typed, kind: fixedKind ?? typed.kind, birthYear: typed.birthYear ?? null }}
          fixedKind={fixedKind}
          error={error}
          register={register}
          available={(u) => db.rpc<boolean>('username_available', { p_username: u })}
          onDone={restart}
          onSignOut={() => {
            auth.signOut();
            window.location.reload();
          }}
        />,
      );
      return;
    }
  }
  const profile = user.profile!;
  const social: Social = {
    me: profile,
    async search(q) {
      const rows = (await db.rpc<RawHit[]>('search_profiles', { p_query: q })) ?? [];
      return rows.map((h) => ({ username: h.username, displayName: h.display_name, kind: h.kind, status: h.status ?? null, direction: h.direction ?? null }));
    },
    async connections() {
      const rows = (await db.rpc<RawConn[]>('my_connections')) ?? [];
      return rows.map((c) => ({ username: c.username, displayName: c.display_name, kind: c.kind, status: c.status, direction: c.direction, playerId: c.player_id, since: c.since }));
    },
    send: (u) => db.rpc('send_request', { p_username: u }),
    respond: (u, accept) => db.rpc('respond_request', { p_username: u, p_accept: accept }),
    remove: (u) => db.rpc('remove_connection', { p_username: u }),
    merge: (id, u) => db.rpc('merge_offline_player', { p_offline: id, p_username: u }),
    async members() {
      const rows = (await db.rpc<RawMember[]>('admin_profiles')) ?? [];
      return rows.map((m): Member => ({ userId: m.user_id, username: m.username, displayName: m.display_name, kind: m.kind, email: m.email, createdAt: m.created_at, connections: m.connections }));
    },
    refresh: () => void db.poll(),
  };
  setSocial(social);
  const rest = async (path: string, init: RequestInit = {}) => {
    const s = await auth.refresh();
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(init.headers as Record<string, string>) },
    });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return res;
  };
  // The account's own plan (a parent's Family plan). Missing table or no plan = no plan.
  try {
    const myId = await user.id();
    const rows = (await (await rest(`subscriptions?select=plan,expires_at&user_id=eq.${myId}`)).json()) as { plan: 'coach' | 'family'; expires_at: string | null }[];
    if (rows[0]) setMyPlan({ plan: rows[0].plan, until: rows[0].expires_at });
  } catch {
    /* subscriptions not set up */
  }
  setTeam({
    myEmail: user.email,
    signOut: () => {
      auth.signOut();
      window.location.reload();
    },
    async parents(ids) {
      if (!ids.length) return [];
      const emails = await db.rpc<{ id: string; email: string }[]>('user_emails', { p_ids: ids });
      let subs: { user_id: string; plan: 'coach' | 'family'; expires_at: string | null }[] = [];
      try {
        subs = (await (await rest('subscriptions?select=user_id,plan,expires_at')).json()) as typeof subs;
      } catch {
        /* subscriptions not set up */
      }
      return ids.map((id) => {
        const sub = subs.find((x) => x.user_id === id);
        return { userId: id, email: emails.find((e) => e.id === id)?.email ?? '', plan: sub ? { plan: sub.plan, until: sub.expires_at } : null };
      });
    },
    async setPlan(userId, plan) {
      if (!plan) {
        await rest(`subscriptions?user_id=eq.${userId}`, { method: 'DELETE' });
        return;
      }
      await rest('subscriptions?on_conflict=user_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: userId, plan: plan.plan, expires_at: plan.until, source: 'manual', updated_at: new Date().toISOString() }),
      });
    },
    async deleteAccount() {
      await db.rpc('delete_my_account');
      db.stop();
      auth.signOut();
    },
    async list() {
      const staff = (await (await rest('staff?select=user_id,email,role&order=email')).json()) as { user_id: string; email: string; role: 'admin' | 'coach' }[];
      const invites = user.role === 'admin' ? ((await (await rest('staff_invites?select=email,role,code&used_at=is.null&order=email')).json()) as { email: string; role: 'admin' | 'coach'; code: string }[]) : [];
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
      const r = await db.rpc<{ code: string }>('staff_invite', { p_email: email, p_role: role });
      return { code: r.code };
    },
    async changePassword(password) {
      await auth.updatePassword(password);
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
  const adapter = new ArtifactDbAdapter(db, user, `Online (Supabase) — each coach sees their connected players, each family their own player`);
  adapter.social = true;
  // Families chart their own player's matches through a checked database function (supabase/social.sql).
  adapter.familyWriter = { save: (match) => db.rpc('family_save_match', { p_match: match }) };
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
      void startSupabase(cfg, auth, go).catch((e) => {
        console.error(e);
        root.render(<SignIn auth={auth} onDone={go} />);
      });
    };
    const deleted = window.location.hash === '#account-deleted';
    if (deleted) history.replaceState(null, '', window.location.pathname + window.location.search);
    if (deleted) root.render(<SignIn auth={auth} onDone={go} notice={T.deleted} />);
    else if (linkError) root.render(<SignIn auth={auth} onDone={go} notice={T.expired} />);
    else if (fromLink && linkType === 'recovery') root.render(<SignIn auth={auth} onDone={go} screen="recovery" />);
    else if (fromLink && (linkType === 'signup' || linkType === 'invite' || linkType === 'email_change')) root.render(<SignIn auth={auth} onDone={go} screen="welcome" />);
    else if (await auth.refresh()) go();
    else root.render(<SignIn auth={auth} onDone={go} />);
    return;
  }
  const local: StorageAdapter = LocalStorageAdapter.available() ? new LocalStorageAdapter() : new MemoryAdapter();
  render(await boot(local), local);
})();
