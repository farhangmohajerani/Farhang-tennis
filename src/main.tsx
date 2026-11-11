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
import { roomPairing, setPairing } from './lib/pairing';
import { setTeam, type TeamMember } from './lib/team';
import { setMyPlan } from './lib/access';
import {
  CONSENT_VERSION,
  profileChanged,
  setSocial,
  type Connection,
  type Holder,
  type LinkRequest,
  type Member,
  type MyProfile,
  type ProfileDetails,
  type Result,
  type SearchHit,
  type SignupKind,
  type Social,
} from './lib/social';
import { PrivacyNoticeOverlay } from './components/PrivacyNotice';
import { disablePush, registerWorker, setPushKeySource, setPushUser, syncPush } from './lib/push';

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
      title: '21GRAM Tennis', sub: 'تمرین، بازی و پیشرفت — برای بازیکن، خانواده و مربی', email: 'ایمیل', pass: 'رمز عبور (حداقل ۸ کاراکتر)',
      signIn: 'ورود', signUp: 'ساخت حساب', forgot: 'رمز را فراموش کرده‌ام', show: 'نمایش رمز', hide: 'پنهان کردن رمز',
      sent: 'ایمیل بازیابی رمز فرستاده شد. روی لینک داخل ایمیل بزنید تا رمز جدید بگذارید.', newPass: 'رمز جدید (حداقل ۸ کاراکتر)',
      newPassTitle: 'رمز جدید بگذارید', save: 'ذخیرهٔ رمز و ورود', toggle: 'English',
      checkEmail: 'حساب ساخته شد. یک ایمیل تأیید برایتان فرستادیم؛ روی لینکش بزنید تا وارد شوید.',
      welcomeTitle: 'تبریک! 🎾', welcomeText: 'ایمیل شما تأیید شد و حسابتان آماده است.', enter: 'ورود به اپ',
      badLogin: 'ایمیل یا رمز اشتباه است. اگر رمز را فراموش کرده‌اید، «رمز را فراموش کرده‌ام» را بزنید.',
      exists: 'با این ایمیل قبلاً حساب ساخته شده. «ورود» را بزنید.', notConfirmed: 'ایمیل هنوز تأیید نشده. روی لینک ایمیل تأیید بزنید.',
      expired: 'این لینک منقضی شده یا قبلاً استفاده شده. دوباره «رمز را فراموش کرده‌ام» را بزنید یا وارد شوید.',
      tooMany: 'تعداد درخواست‌ها زیاد بود. چند دقیقه صبر کنید و دوباره امتحان کنید.', passwordSaved: 'رمز ذخیره شد.',
      tabSignIn: 'ورود', tabSignUp: 'ساخت حساب', whoAreYou: 'با کدام حساب شروع می‌کنید؟',
      kind_player: 'بازیکن', kind_player_text: 'خودم تنیس بازی می‌کنم و تمرین‌ها و بازی‌هایم را دنبال می‌کنم.',
      kind_family: 'خانواده', kind_family_text: 'پدر یا مادر هستم و برای فرزندم حساب می‌سازم.',
      kind_coach: 'مربی', kind_coach_text: 'مربی هستم؛ برای بازیکن‌هایم برنامه می‌سازم و بازی‌هایشان را ثبت می‌کنم.',
      form_player: 'حساب بازیکن', form_family: 'حساب خانواده', form_coach: 'حساب مربی', change: 'تغییر',
      firstName: 'نام', lastName: 'نام خانوادگی', childFirst: 'نام بازیکن (فرزندتان)', childLast: 'نام خانوادگی بازیکن',
      familyNameHint: 'مربی‌ها بازیکن را با همین نام پیدا می‌کنند. بقیهٔ اطلاعات را بعداً در پروفایل وارد می‌کنید.',
      laterHint: 'بقیهٔ اطلاعات را بعد از ساخت حساب در پروفایل وارد می‌کنید.',
      legal_player: 'با ساخت حساب، {privacy} را می‌پذیرید و تأیید می‌کنید که ۱۶ سال یا بیشتر دارید (بازیکنان کوچک‌تر با حساب خانواده وارد می‌شوند).',
      legal_family: 'با ساخت حساب، {privacy} را می‌پذیرید و تأیید می‌کنید که پدر، مادر یا سرپرست قانونی این بازیکن هستید.',
      legal_coach: 'با ساخت حساب، {privacy} را می‌پذیرید.',
      privacyLink: 'متن حریم خصوصی', pickType: 'اول انتخاب کنید بازیکن، خانواده یا مربی هستید.', needName: 'نام و نام خانوادگی را بنویسید.',
      pwHint: 'رمز عبور حداقل ۸ کاراکتر',
      setupTitle: 'حسابتان را کامل کنید', setupText: 'فقط نوع حساب و نام لازم است؛ بقیه را بعداً در پروفایل جواب می‌دهید.',
      setupSave: 'ذخیره و ادامه', setupFailed: 'ذخیره نشد. اینترنت را چک کنید و دوباره امتحان کنید.', adminCoach: 'حساب مدیر به‌عنوان مربی هم کار می‌کند.',
      signOut: 'خروج', deleted: 'حساب شما حذف شد.',
      agree: 'متن حریم خصوصی را خواندم و قبول دارم.', readNotice: 'خواندن متن',
      guardian: 'من پدر، مادر یا سرپرست قانونی بازیکن هستم (یا خودم بازیکنم و ۱۶ سال یا بیشتر دارم).',
      needConsent: 'برای ادامه، متن حریم خصوصی را قبول کنید.', needGuardian: 'حساب بازیکن زیر ۱۶ سال را باید پدر، مادر یا سرپرستش بسازد.',
      close: 'بستن', consentTitle: 'قبل از ادامه', consentText: 'از این نسخه، اپ قبل از هر کاری از شما اجازه می‌گیرد. لطفاً نحوهٔ استفاده از اطلاعاتتان را بخوانید و تأیید کنید.',
      accept: 'قبول و ادامه', blockedTitle: 'این حساب متوقف شده است',
      blockedText: 'آکادمی این حساب را موقتاً متوقف کرده است. اگر فکر می‌کنید اشتباهی شده، با مربی‌تان یا آکادمی تماس بگیرید.',
    }
  : {
      title: '21GRAM Tennis', sub: 'Training, matches and progress — for players, families and coaches', email: 'Email', pass: 'Password (8+ characters)',
      signIn: 'Sign in', signUp: 'Create account', forgot: 'Forgot password', show: 'Show password', hide: 'Hide password',
      sent: 'Password reset email sent. Open the link in it to choose a new password.', newPass: 'New password (8+ characters)',
      newPassTitle: 'Choose a new password', save: 'Save password and continue', toggle: 'فارسی',
      checkEmail: 'Account created. We sent you a confirmation email — open its link to sign in.',
      welcomeTitle: 'Congratulations! 🎾', welcomeText: 'Your email is confirmed and your account is ready.', enter: 'Open the app',
      badLogin: 'Wrong email or password. If you forgot your password, tap “Forgot password”.',
      exists: 'An account with this email already exists. Tap “Sign in”.', notConfirmed: 'Your email is not confirmed yet. Open the link in the confirmation email.',
      expired: 'This link has expired or was already used. Tap “Forgot password” again, or sign in.',
      tooMany: 'Too many attempts. Wait a few minutes and try again.', passwordSaved: 'Password saved.',
      tabSignIn: 'Sign in', tabSignUp: 'Create account', whoAreYou: 'Which account do you need?',
      kind_player: 'Player', kind_player_text: 'I play tennis and follow my own training and matches.',
      kind_family: 'Family', kind_family_text: 'I’m a parent making an account for my child.',
      kind_coach: 'Coach', kind_coach_text: 'I coach: I plan for my players and chart their matches.',
      form_player: 'Player account', form_family: 'Family account', form_coach: 'Coach account', change: 'Change',
      firstName: 'First name', lastName: 'Last name', childFirst: 'Player’s first name (your child)', childLast: 'Player’s last name',
      familyNameHint: 'Coaches find the player by this name. You add everything else later in the profile.',
      laterHint: 'You add everything else later in your profile.',
      legal_player: 'By creating the account you accept the {privacy} and confirm you are 16 or older (younger players join through a Family account).',
      legal_family: 'By creating the account you accept the {privacy} and confirm you are this player’s parent or legal guardian.',
      legal_coach: 'By creating the account you accept the {privacy}.',
      privacyLink: 'privacy notice', pickType: 'First choose: player, family or coach.', needName: 'Write the first and last name.',
      pwHint: 'Password: at least 8 characters',
      setupTitle: 'Finish your account', setupText: 'Only the kind of account and the name are needed; you answer the rest later in your profile.',
      setupSave: 'Save and continue', setupFailed: 'Could not save. Check the internet and try again.', adminCoach: 'The admin account also works as a coach.',
      signOut: 'Sign out', deleted: 'Your account has been deleted.',
      agree: 'I have read and accept the privacy notice.', readNotice: 'Read it',
      guardian: 'I am the player’s parent or legal guardian (or I am the player and 16 or older).',
      needConsent: 'Accept the privacy notice to continue.', needGuardian: 'A parent or guardian must make the account of a player under 16.',
      close: 'Close', consentTitle: 'Before you continue', consentText: 'From this version the app asks before anything is shared. Please read how your information is used and confirm.',
      accept: 'Accept and continue', blockedTitle: 'This account is paused',
      blockedText: 'The academy has paused this account for now. If you think this is a mistake, contact your coach or the academy.',
    };

function friendly(raw: string): string {
  if (/invalid login credentials/i.test(raw)) return T.badLogin;
  if (/already registered|already exists/i.test(raw)) return T.exists;
  if (/not confirmed/i.test(raw)) return T.notConfirmed;
  if (/rate limit|too many|429/i.test(raw)) return T.tooMany;
  if (/confirm/i.test(raw)) return T.checkEmail;
  return raw;
}

const fieldCls = 'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink';
const primaryCls = 'h-12 rounded-full bg-accent text-[16px] font-semibold text-accent-ink disabled:opacity-40';
const KINDS: { k: SignupKind; icon: string }[] = [
  { k: 'player', icon: '🎾' },
  { k: 'family', icon: '👨‍👩‍👧' },
  { k: 'coach', icon: '📋' },
];
const cleanName = (v: string) => v.replace(/\s+/g, ' ').trim();
const namesOk = (first: string, last: string) => cleanName(first).length >= 1 && cleanName(first).length <= 40 && cleanName(last).length >= 1 && cleanName(last).length <= 40;

/** Step one of sign-up: player, family or coach (each gets its own words from here on). */
function KindPicker({ value, onPick, testPrefix = 'kind' }: { value: SignupKind | null; onPick: (k: SignupKind) => void; testPrefix?: string }) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2 font-display text-2xl">{T.whoAreYou}</legend>
      {KINDS.map(({ k, icon }) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          data-testid={`${testPrefix}-${k}`}
          onClick={() => onPick(k)}
          className={`flex items-center gap-3.5 rounded-2xl border-2 p-4 text-start transition ${value === k ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent'}`}
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sunken text-2xl" aria-hidden="true">
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold">{T[`kind_${k}`]}</span>
            <span className="block text-[13.5px] leading-snug text-muted">{T[`kind_${k}_text`]}</span>
          </span>
          <span className="text-xl text-muted rtl:rotate-180" aria-hidden="true">›</span>
        </button>
      ))}
    </fieldset>
  );
}

/** "By creating the account you accept the privacy notice…" with the notice one tap away. */
function LegalLine({ kind }: { kind: SignupKind }) {
  const [reading, setReading] = useState(false);
  const [before, after] = T[`legal_${kind}`].split('{privacy}');
  return (
    <p className="text-[13px] leading-relaxed text-muted" data-testid="legal-line">
      {before}
      <button type="button" className="font-semibold text-accent underline" onClick={() => setReading(true)} data-testid="open-privacy">
        {T.privacyLink}
      </button>
      {after}
      {reading && <PrivacyNoticeOverlay lang={fa ? 'fa' : 'en'} onClose={() => setReading(false)} closeLabel={T.close} />}
    </p>
  );
}

/** First and last name (for a family: the player's, since coaches find the player by it). */
function NameFields({ kind, first, setFirst, last, setLast }: { kind: SignupKind; first: string; setFirst: (v: string) => void; last: string; setLast: (v: string) => void }) {
  const family = kind === 'family';
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {family ? T.childFirst : T.firstName}
          <input id="sb-first" className={`${fieldCls} font-normal`} value={first} maxLength={40} onChange={(e) => setFirst(e.target.value)} autoComplete={family ? 'off' : 'given-name'} dir="auto" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {family ? T.childLast : T.lastName}
          <input id="sb-last" className={`${fieldCls} font-normal`} value={last} maxLength={40} onChange={(e) => setLast(e.target.value)} autoComplete={family ? 'off' : 'family-name'} dir="auto" />
        </label>
      </div>
      <p className="-mt-1 text-[12.5px] text-muted">{family ? T.familyNameHint : T.laterHint}</p>
    </div>
  );
}

type Screen = 'signin' | 'recovery' | 'welcome';

function SignIn({ auth, onDone, screen: initial = 'signin', notice }: { auth: SupabaseAuth; onDone: () => void; screen?: Screen; notice?: string }) {
  const [screen] = useState<Screen>(initial);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [kind, setKind] = useState<SignupKind | null>(null);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
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
  const note = msg && (
    <p className={msg.bad ? 'text-sm font-semibold text-bad' : 'text-sm font-semibold text-good'} role="alert" data-testid="auth-message">
      {msg.text}
    </p>
  );
  const emailField = (
    <input className={fieldCls} type="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={T.email} value={email} onChange={(e) => setEmail(e.target.value)} id="sb-email" dir="ltr" />
  );
  const passwordField = (
    <input
      className={fieldCls}
      type={show ? 'text' : 'password'}
      autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
      autoCapitalize="none"
      autoCorrect="off"
      placeholder={T.pass}
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      id="sb-password"
      dir="ltr"
    />
  );
  const showBox = (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {T.show}
    </label>
  );
  return (
    <div className="gutter mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-4 py-8" dir={fa ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="font-display text-4xl">{T.title}</h1>
        <p className="text-sm text-muted">{T.sub}</p>
      </div>
      {screen === 'welcome' ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5" data-testid="welcome">
          <h2 className="font-display text-3xl">{T.welcomeTitle}</h2>
          <p>{T.welcomeText}</p>
          <button type="button" className={primaryCls} onClick={onDone}>{T.enter}</button>
        </div>
      ) : screen === 'recovery' ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(() => auth.updatePassword(password), onDone); }}>
          <h2 className="font-display text-2xl">{T.newPassTitle}</h2>
          <input className={fieldCls} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder={T.newPass} value={password} onChange={(e) => setPassword(e.target.value)} id="sb-newpass" dir="ltr" />
          {showBox}
          {note}
          <button type="submit" disabled={busy || password.length < 8} className={primaryCls} data-testid="save-new-password">{T.save}</button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
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
          {mode === 'in' ? (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(() => auth.signIn(email.trim(), password), onDone); }}>
              {emailField}
              {passwordField}
              {showBox}
              {note}
              <button type="submit" disabled={busy || !email || !password} className={primaryCls} data-testid="sign-in">{T.signIn}</button>
              <button type="button" disabled={busy || !email} className="text-sm font-semibold text-accent disabled:opacity-40" data-testid="forgot" onClick={() => void run(() => auth.resetPassword(email.trim()), () => setMsg({ text: T.sent, bad: false }))}>
                {T.forgot}
              </button>
            </form>
          ) : !kind ? (
            <KindPicker value={kind} onPick={(k) => { setKind(k); setMsg(null); }} />
          ) : (
            <form
              className="flex flex-col gap-3"
              data-testid={`signup-${kind}`}
              onSubmit={(e) => {
                e.preventDefault();
                if (!namesOk(first, last)) return setMsg({ text: T.needName, bad: true });
                void run(async () => {
                  const profile = { firstName: cleanName(first), lastName: cleanName(last), kind, consent: CONSENT_VERSION };
                  try {
                    await auth.signUp(email.trim(), password, kind === 'coach' ? 'coach' : 'parent', profile);
                  } catch (err) {
                    // Accounts are confirmed automatically on the server; sign straight in.
                    if (/confirm/i.test(err instanceof Error ? err.message : String(err))) await auth.signIn(email.trim(), password);
                    else throw err;
                  }
                }, onDone);
              }}
            >
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-sunken px-3.5 py-2.5">
                <span className="flex items-center gap-2 font-semibold">
                  <span aria-hidden="true">{KINDS.find((x) => x.k === kind)?.icon}</span>
                  {T[`form_${kind}`]}
                </span>
                <button type="button" className="text-sm font-semibold text-accent" onClick={() => { setKind(null); setMsg(null); }} data-testid="change-kind">
                  {T.change}
                </button>
              </div>
              <NameFields kind={kind} first={first} setFirst={setFirst} last={last} setLast={setLast} />
              {emailField}
              {passwordField}
              <p className={`-mt-1 text-[13px] ${password && password.length < 8 ? 'font-semibold text-bad' : 'text-muted'}`} data-testid="pw-hint">
                {T.pwHint}
                {password ? ` (${password.length}/8)` : ''}
              </p>
              {showBox}
              <LegalLine kind={kind} />
              {note}
              <button type="submit" disabled={busy || !email || password.length < 8 || !namesOk(first, last)} className={primaryCls} data-testid="sign-up">
                {busy ? '…' : T.signUp}
              </button>
            </form>
          )}
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

type Consent = { agree: boolean; guardian: boolean };
const consentOk = (kind: 'coach' | 'family', c: Consent) => c.agree && (kind === 'coach' || c.guardian);

/** Accounts from before consent was asked: the privacy notice and, for a parent, the guardian line. */
function ConsentFields({ kind, c, set }: { kind: 'coach' | 'family'; c: Consent; set: (c: Consent) => void }) {
  const [reading, setReading] = useState(false);
  const row = 'flex items-start gap-2.5 text-[14px] leading-snug';
  const box = 'mt-0.5 h-[18px] w-[18px] shrink-0 accent-accent';
  return (
    <fieldset className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3.5" data-testid="consent-fields">
      <label className={row}>
        <input type="checkbox" className={box} checked={c.agree} onChange={(e) => set({ ...c, agree: e.target.checked })} data-testid="consent-privacy" />
        <span>
          {T.agree}{' '}
          <button type="button" className="font-semibold text-accent underline" onClick={() => setReading(true)} data-testid="open-privacy">
            {T.readNotice}
          </button>
        </span>
      </label>
      {kind === 'family' && (
        <label className={row}>
          <input type="checkbox" className={box} checked={c.guardian} onChange={(e) => set({ ...c, guardian: e.target.checked })} data-testid="consent-guardian" />
          <span>{T.guardian}</span>
        </label>
      )}
      {reading && <PrivacyNoticeOverlay lang={fa ? 'fa' : 'en'} onClose={() => setReading(false)} closeLabel={T.close} />}
    </fieldset>
  );
}

type RegisterResult = { ok?: boolean; error?: string } | null;
type Registration = { kind: SignupKind; firstName: string; lastName: string; consent: string };

/** Signed in without a profile (the admin's first sign-in, or an older sign-in): kind and name only. */
function ProfileSetup({
  initial, fixedKind, error, register, onDone, onSignOut,
}: {
  initial: { kind: SignupKind | null; firstName: string; lastName: string };
  fixedKind: 'coach' | null;
  error: string;
  register: (p: Registration) => Promise<RegisterResult>;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [kind, setKind] = useState<SignupKind | null>(fixedKind ?? initial.kind);
  const [first, setFirst] = useState(initial.firstName);
  const [last, setLast] = useState(initial.lastName);
  const [msg, setMsg] = useState(error ? T.setupFailed : '');
  const [busy, setBusy] = useState(false);
  const ok = !!kind && namesOk(first, last);
  return (
    <div className="gutter mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-4 py-8" dir={fa ? 'rtl' : 'ltr'} data-testid="profile-setup">
      <h1 className="font-display text-4xl">{T.title}</h1>
      {!kind ? (
        <KindPicker value={kind} onPick={setKind} testPrefix="setup-kind" />
      ) : (
        <form
          className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ok || !kind) return setMsg(T.needName);
            setBusy(true);
            setMsg('');
            try {
              const r = await register({ kind, firstName: cleanName(first), lastName: cleanName(last), consent: CONSENT_VERSION });
              if (r?.ok || r?.error === 'exists') return onDone();
              setMsg(r?.error === 'bad_name' ? T.needName : T.setupFailed);
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
            <p className="rounded-xl bg-accent-soft px-3 py-2 text-[13px] font-semibold">📋 {T.kind_coach} — {T.adminCoach}</p>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-sunken px-3.5 py-2.5">
              <span className="font-semibold">{T[`form_${kind}`]}</span>
              <button type="button" className="text-sm font-semibold text-accent" onClick={() => setKind(null)} data-testid="change-kind">
                {T.change}
              </button>
            </div>
          )}
          <NameFields kind={kind} first={first} setFirst={setFirst} last={last} setLast={setLast} />
          <LegalLine kind={kind} />
          {msg && <p className="text-sm font-semibold text-bad" role="alert">{msg}</p>}
          <button type="submit" disabled={busy || !ok} className={primaryCls} data-testid="setup-save">
            {busy ? '…' : T.setupSave}
          </button>
          <button type="button" className="text-sm font-semibold text-muted underline" onClick={onSignOut}>
            {T.signOut}
          </button>
        </form>
      )}
    </div>
  );
}

/** Accounts made before consent was asked: accept once, then continue. */
function ConsentGate({ kind, give, onDone, onSignOut }: { kind: 'coach' | 'family'; give: (guardian: boolean) => Promise<Result>; onDone: () => void; onSignOut: () => void }) {
  const [c, setC] = useState<Consent>({ agree: false, guardian: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <div className="gutter mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-4" dir={fa ? 'rtl' : 'ltr'} data-testid="consent-gate">
      <h1 className="font-display text-4xl">{T.title}</h1>
      <form
        className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!consentOk(kind, c)) return setMsg(c.agree ? T.needGuardian : T.needConsent);
          setBusy(true);
          setMsg('');
          try {
            const r = await give(kind === 'family' && c.guardian);
            if (r?.ok) return onDone();
            setMsg(r?.error === 'guardian_required' ? T.needGuardian : r?.error === 'consent_required' ? T.needConsent : T.setupFailed);
          } catch {
            setMsg(T.setupFailed);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-display text-2xl">{T.consentTitle}</h2>
        <p className="text-sm text-muted">{T.consentText}</p>
        <ConsentFields kind={kind} c={c} set={setC} />
        {msg && <p className="text-sm font-semibold text-bad" role="alert">{msg}</p>}
        <button type="submit" disabled={busy || !consentOk(kind, c)} className="h-11 rounded-full bg-accent font-semibold text-accent-ink disabled:opacity-40" data-testid="consent-accept">
          {busy ? '…' : T.accept}
        </button>
        <button type="button" className="text-sm font-semibold text-muted underline" onClick={onSignOut}>
          {T.signOut}
        </button>
      </form>
    </div>
  );
}

/** The academy paused this account: nothing else opens. */
function Blocked({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="gutter mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-4" dir={fa ? 'rtl' : 'ltr'} data-testid="blocked">
      <h1 className="font-display text-4xl">{T.title}</h1>
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display text-2xl">{T.blockedTitle}</h2>
        <p className="text-sm">{T.blockedText}</p>
        <button type="button" className="h-11 rounded-full border border-line font-semibold" onClick={onSignOut} data-testid="blocked-sign-out">
          {T.signOut}
        </button>
      </div>
    </div>
  );
}

interface RawHit {
  username: string; display_name: string; kind: 'coach' | 'family'; holder: Holder | null; verified: boolean; club: string | null; city: string | null;
  status: SearchHit['status']; direction: SearchHit['direction'];
}
interface RawConn {
  username: string; display_name: string; kind: 'coach' | 'family'; holder: Holder | null; verified: boolean; club: string | null; city: string | null;
  status: Connection['status']; direction: Connection['direction']; player_id: string; since: string;
}
interface RawLink {
  id: string; offline_id: string; offline_name: string; coach_username: string; coach_name: string; family_username: string; family_name: string; direction: 'in' | 'out'; created_at: string;
}
interface RawMember {
  user_id: string; username: string; display_name: string; kind: 'coach' | 'family'; holder: Holder | null; email: string; created_at: string; connections: number;
  blocked: boolean; verified: boolean; guardian: boolean; consent_at: string | null; staff: boolean;
}

/** Edge Functions (supabase/functions): JSON in, JSON out, with the signed-in person's token. */
async function callFunction(cfg: SupabaseConfig, auth: SupabaseAuth, name: string, body: unknown): Promise<{ status: number; data: Result & { detail?: string } }> {
  const s = await auth.refresh();
  const res = await fetch(`${cfg.url}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Result & { detail?: string } };
}

async function startSupabase(cfg: SupabaseConfig, auth: SupabaseAuth, restart: () => void) {
  const db = new SupabaseDocDb(cfg, auth);
  let user = await supabaseUser(db, auth);
  // This device's notifications go with the person signed in (and stop at sign-out).
  void registerWorker();
  const signOut = async () => {
    db.stop();
    await Promise.race([disablePush((endpoint) => db.rpc<Result>('disable_push_subscription', { p_endpoint: endpoint })), new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
    auth.signOut();
    window.location.reload();
  };
  // A new account goes to its profile first (the questions sign-up no longer asks).
  let fresh = false;
  if (!user.profile) {
    // Everyone has a profile (supabase/social-3.sql). The admin's account works as a coach.
    const fixedKind = user.role ? 'coach' : null;
    const typed = auth.signupProfile();
    const register = (x: Registration) =>
      db.rpc<RegisterResult>('register_profile_v3', { p_first: x.firstName, p_last: x.lastName, p_kind: x.kind, p_consent: x.consent });
    let error = '';
    const kind = fixedKind ?? typed.kind;
    if (kind && typed.firstName.trim() && typed.lastName.trim() && typed.consent) {
      // Typed and accepted at sign-up: save it now.
      const r = await register({ kind, firstName: typed.firstName, lastName: typed.lastName, consent: typed.consent }).catch((): RegisterResult => ({ error: 'failed' }));
      if (r?.ok || r?.error === 'exists') user = await supabaseUser(db, auth);
      else error = r?.error ?? 'failed';
    }
    if (!user.profile) {
      db.stop();
      root.render(
        <ProfileSetup
          initial={{ kind: fixedKind ?? typed.kind, firstName: typed.firstName, lastName: typed.lastName }}
          fixedKind={fixedKind}
          error={error}
          register={register}
          onDone={() => {
            window.location.hash = 'profile-welcome';
            restart();
          }}
          onSignOut={() => void signOut()}
        />,
      );
      return;
    }
    fresh = true;
  }
  const profile: MyProfile = user.profile!;
  if (profile.blocked) {
    db.stop();
    root.render(<Blocked onSignOut={() => void signOut()} />);
    return;
  }
  if (!profile.consentAt) {
    // Accounts from before consent was asked.
    db.stop();
    root.render(
      <ConsentGate
        kind={profile.kind}
        give={(guardian) => db.rpc<Result>('give_consent', { p_guardian: guardian, p_consent: CONSENT_VERSION })}
        onDone={restart}
        onSignOut={() => void signOut()}
      />,
    );
    return;
  }
  const myId = (await user.id()) ?? '';
  const fn = (name: string, body: unknown) => callFunction(cfg, auth, name, body);
  // Notifications on this device: the server holds the key pair and hands out the public half.
  setPushUser(myId);
  setPushKeySource(async () => {
    const r = await fn('notify', { action: 'publicKey' });
    return (r.data as { publicKey?: string }).publicKey ?? '';
  });
  const rpc = (name: string, args: Record<string, unknown> = {}) => db.rpc<Result>(name, args);
  const social: Social = {
    me: profile,
    myId,
    async search(q) {
      const rows = (await db.rpc<RawHit[]>('search_people_v2', { p_query: q })) ?? [];
      return rows.map((h) => ({
        username: h.username,
        displayName: h.display_name,
        kind: h.kind,
        holder: h.holder,
        verified: !!h.verified,
        club: h.club,
        city: h.city,
        status: h.status ?? null,
        direction: h.direction ?? null,
      }));
    },
    async connections() {
      const rows = (await db.rpc<RawConn[]>('my_connections_v3')) ?? [];
      return rows.map((c) => ({
        username: c.username,
        displayName: c.display_name,
        kind: c.kind,
        holder: c.holder,
        verified: !!c.verified,
        club: c.club,
        city: c.city,
        status: c.status,
        direction: c.direction,
        playerId: c.player_id,
        since: c.since,
      }));
    },
    async links() {
      const rows = (await db.rpc<RawLink[]>('my_link_requests')) ?? [];
      return rows.map(
        (l): LinkRequest => ({
          id: l.id,
          offlineId: l.offline_id,
          offlineName: l.offline_name,
          coachUsername: l.coach_username,
          coachName: l.coach_name,
          familyUsername: l.family_username,
          familyName: l.family_name,
          direction: l.direction,
          createdAt: l.created_at,
        }),
      );
    },
    send: (u) => rpc('send_request', { p_username: u }),
    respond: (u, accept) => rpc('respond_request', { p_username: u, p_accept: accept }),
    remove: (u) => rpc('remove_connection', { p_username: u }),
    requestLink: (id, u) => rpc('request_link', { p_offline: id, p_username: u }),
    cancelLink: (id) => rpc('cancel_link', { p_id: id }),
    respondLink: (id, accept) => rpc('respond_link', { p_id: id, p_accept: accept }),
    merge: (id, u) => rpc('merge_offline_player', { p_offline: id, p_username: u }),
    async updateProfile(p) {
      const r = await rpc('update_my_profile_v2', {
        p_first: p.firstName ?? null,
        p_last: p.lastName ?? null,
        p_details: p.details ?? null,
        p_discoverable: p.discoverable ?? null,
        p_notify_live: p.notifyLive ?? null,
      });
      if (r?.ok) {
        // The database's copy is the truth (it tidies names and answers).
        const fresh = await db.rpc<Partial<MyProfile> | null>('my_profile').catch(() => null);
        if (fresh?.username) {
          Object.assign(social.me, {
            displayName: fresh.displayName ?? social.me.displayName,
            firstName: fresh.firstName ?? social.me.firstName,
            lastName: fresh.lastName ?? social.me.lastName,
            details: (fresh.details as ProfileDetails) ?? social.me.details,
            discoverable: fresh.discoverable ?? social.me.discoverable,
            notifyLive: fresh.notifyLive ?? social.me.notifyLive,
          });
        }
        adapter.myName = social.me.displayName;
        if (p.firstName !== undefined || p.lastName !== undefined) void db.poll();
        profileChanged();
      }
      return r;
    },
    async updatePlayer(patch) {
      const r = await rpc('family_update_player', { p_patch: patch });
      if (r?.ok) {
        if (patch.name) {
          social.me.displayName = patch.name.trim();
          adapter.myName = social.me.displayName;
          profileChanged();
        }
        void db.poll();
      }
      return r;
    },
    deleteMatch: (id) => rpc('family_delete_match', { p_id: id }),
    async notifyMatch(id) {
      try {
        const r = await fn('notify', { matchId: id });
        if (r.status >= 400 && r.status !== 404) console.warn('notify', r.status, r.data);
      } catch (e) {
        console.warn('notify', e);
      }
    },
    savePush: (x) => rpc('save_push_subscription', { p_endpoint: x.endpoint, p_p256dh: x.p256dh, p_auth: x.auth, p_lang: x.lang, p_user_agent: navigator.userAgent.slice(0, 300) }),
    disablePush: (endpoint) => rpc('disable_push_subscription', { p_endpoint: endpoint }),
    async members() {
      const rows = (await db.rpc<RawMember[]>('admin_profiles_v3')) ?? [];
      return rows.map(
        (m): Member => ({
          userId: m.user_id,
          username: m.username,
          displayName: m.display_name,
          kind: m.kind,
          holder: m.holder,
          email: m.email,
          createdAt: m.created_at,
          connections: m.connections,
          blocked: !!m.blocked,
          verified: !!m.verified,
          guardian: !!m.guardian,
          consentAt: m.consent_at,
          staff: !!m.staff,
        }),
      );
    },
    setFlags: (u, f) => rpc('admin_set_flags', { p_username: u, p_blocked: f.blocked ?? null, p_verified: f.verified ?? null }),
    async removeAccount(userId) {
      const r = await fn('delete-account', { userId });
      if (r.status >= 400 || !r.data.ok) return { error: r.data.error || `http_${r.status}` };
      return { ok: true };
    },
    refresh: () => void db.poll(),
  };
  setSocial(social);
  const adapter = new ArtifactDbAdapter(db, user, `Online (Supabase) — each coach sees their connected players, each family their own player`);
  adapter.social = true;
  adapter.myName = profile.displayName;
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
    const rows = (await (await rest(`subscriptions?select=plan,expires_at&user_id=eq.${myId}`)).json()) as { plan: 'coach' | 'family'; expires_at: string | null }[];
    if (rows[0]) setMyPlan({ plan: rows[0].plan, until: rows[0].expires_at });
  } catch {
    /* subscriptions not set up */
  }
  setTeam({
    myEmail: user.email,
    signOut: () => void signOut(),
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
      // supabase/functions/delete-account; projects set up before it have the database function instead.
      await Promise.race([disablePush((endpoint) => db.rpc<Result>('disable_push_subscription', { p_endpoint: endpoint })), new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
      const r = await fn('delete-account', {});
      if (r.status === 404) await db.rpc('delete_my_account');
      else if (r.status >= 400 || !r.data.ok) throw new Error(r.data.error === 'failed' && r.data.detail ? r.data.detail : r.data.error || `HTTP ${r.status}`);
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
  // Families chart their own player's matches through a checked database function (supabase/social.sql).
  adapter.familyWriter = { save: (match) => db.rpc('family_save_match', { p_match: match }) };
  // A live match this person just started: tell the family and coaches once (supabase/functions/notify).
  const announced = new Set<string>();
  adapter.onSaved = (coll, body) => {
    const id = typeof body.id === 'string' ? body.id : '';
    if (coll !== 'matches' || body.status !== 'live' || !id || announced.has(id)) return;
    if (body.scorerId && body.scorerId !== myId) return;
    const started = Date.parse(String(body.createdAt ?? ''));
    if (!started || Date.now() - started > 6 * 3600 * 1000) return;
    announced.add(id);
    void social.notifyMatch(id);
  };
  const state = await adapter.load();
  void syncPush(social.savePush, state.settings.lang);
  if (fresh) window.location.hash = 'profile-welcome';
  render(state, adapter);
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
