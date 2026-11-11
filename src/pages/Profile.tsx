/**
 * Profile (online version): the questions sign-up no longer asks. Families and players answer the
 * player's birth year, level, playing hand, backhand, years playing and goal; coaches their club, city
 * and experience. Nothing is filled in for them: an unanswered question stays empty.
 */
import { useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { navigate } from '../lib/router';
import { levelLabel } from '../lib/i18n';
import { getSocial, profileProgress, type PlayerPatch, type ProfileDetails } from '../lib/social';
import { LEVELS, YEARS_COACHING, YEARS_PLAYING, type Player } from '../types';
import { Button, Card, cx, Empty, inputCls, PageHeader } from '../components/ui';
import { useMe, useSocialError } from '../components/Social';

/** One question with a few answers as buttons (nothing chosen until the person taps one). */
function Choice<T extends string>({ label, value, options, onPick, testId }: { label: string; value: T | null | undefined; options: { v: T; label: string }[]; onPick: (v: T) => void; testId: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[14px] font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onPick(o.v)}
            data-testid={`${testId}-${o.v}`}
            className={cx(
              'min-h-11 rounded-full border-2 px-4 text-[14.5px] font-semibold transition',
              value === o.v ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface hover:border-accent',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <Card className="flex flex-col gap-5 p-5" data-testid={testId}>
      <h2 className="font-display text-2xl leading-tight">{title}</h2>
      {children}
    </Card>
  );
}

function Text({ label, value, onChange, testId, placeholder, max, area, dirAuto = true }: { label: string; value: string; onChange: (v: string) => void; testId: string; placeholder?: string; max: number; area?: boolean; dirAuto?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
      {label}
      {area ? (
        <textarea className={cx(inputCls, 'font-normal')} rows={3} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} dir={dirAuto ? 'auto' : undefined} />
      ) : (
        <input className={cx(inputCls, 'h-11 font-normal')} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} dir={dirAuto ? 'auto' : undefined} />
      )}
    </label>
  );
}

export function ProfilePage({ welcome }: { welcome?: boolean }) {
  const { state, t, lang, toast, adapter } = useStore();
  const social = getSocial();
  const me = useMe();
  const errText = useSocialError();
  const own = state.players.find((p) => p.id === adapter.myId) ?? null;
  const [first, setFirst] = useState(me?.firstName ?? '');
  const [last, setLast] = useState(me?.lastName ?? '');
  const [details, setDetails] = useState<ProfileDetails>(me?.details ?? {});
  const [player, setPlayer] = useState<Pick<Player, 'birthYear' | 'level' | 'hand' | 'backhand' | 'yearsPlaying' | 'goals'>>({
    birthYear: own?.birthYear ?? null,
    level: own?.level ?? null,
    hand: own?.hand ?? null,
    backhand: own?.backhand ?? null,
    yearsPlaying: own?.yearsPlaying,
    goals: own?.goals ?? '',
  });
  const [busy, setBusy] = useState(false);
  if (!social || !me) return <Empty>{t('profileOnline')}</Empty>;
  const coach = me.kind === 'coach';
  const self = me.holder === 'player';
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 76 }, (_, i) => thisYear - 4 - i);
  const progress = profileProgress({ kind: me.kind, details }, coach ? null : player);
  const setD = (k: keyof ProfileDetails, v: string) => setDetails({ ...details, [k]: v });
  const namesOk = first.trim().length >= 1 && first.trim().length <= 40 && last.trim().length >= 1 && last.trim().length <= 40;

  const save = async () => {
    if (!namesOk) return toast(t('needNameBoth'), 'error');
    setBusy(true);
    try {
      const nameChanged = first.trim() !== me.firstName || last.trim() !== me.lastName;
      const r = await social.updateProfile({ ...(nameChanged ? { firstName: first.trim(), lastName: last.trim() } : {}), details });
      if (r?.error) return toast(errText(r), 'error');
      if (!coach && own) {
        const patch: PlayerPatch = {};
        if (player.birthYear !== null && player.birthYear !== own.birthYear) patch.birthYear = player.birthYear;
        if (player.level && player.level !== own.level) patch.level = player.level;
        if (player.hand && player.hand !== own.hand) patch.hand = player.hand;
        if (player.backhand && player.backhand !== own.backhand) patch.backhand = player.backhand;
        if (player.yearsPlaying && player.yearsPlaying !== own.yearsPlaying) patch.yearsPlaying = player.yearsPlaying;
        if (player.goals.trim() !== (own.goals ?? '')) patch.goals = player.goals.trim();
        if (Object.keys(patch).length) {
          const p = await social.updatePlayer(patch);
          if (p?.error) return toast(errText(p), 'error');
        }
      }
      toast(t('profileSaved'));
      if (welcome) navigate('dashboard');
    } catch {
      toast(t('socialErr'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const pct = Math.round((progress.done / progress.total) * 100);
  return (
    <div className="mx-auto max-w-2xl pb-6" data-testid="profile-page">
      <PageHeader eyebrow={welcome ? t('profileStepEyebrow') : t('profileTitle')} title={welcome ? t('profileWelcomeTitle', { name: me.firstName }) : `${me.firstName} ${me.lastName}`.trim()} />
      <p className="-mt-2 mb-4 max-w-[60ch] text-[15px] text-muted">{t(coach ? 'profileWelcomeTextCoach' : 'profileWelcomeText')}</p>
      <div className="mb-5 flex items-center gap-3" data-testid="pf-progress">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="num shrink-0 text-[13px] font-semibold text-muted">{t('profileProgress', { done: progress.done, total: progress.total })}</span>
      </div>

      <div className="flex flex-col gap-4">
        <Section title={t(coach ? 'sectionCoachName' : self ? 'sectionYourName' : 'sectionPlayerName')} testId="pf-names">
          <div className="grid grid-cols-2 gap-3">
            <Text label={t('firstNameLabel')} value={first} onChange={setFirst} testId="pf-first" max={40} />
            <Text label={t('lastNameLabel')} value={last} onChange={setLast} testId="pf-last" max={40} />
          </div>
          {!coach && !self && <p className="-mt-2 text-[12.5px] text-muted">{t('playerNameHint')}</p>}
        </Section>

        {!coach && (
          <Section title={t(self ? 'sectionAboutYou' : 'sectionAboutPlayer')} testId="pf-player">
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
              {t('birthYearQ')}
              <span className="flex items-center gap-3">
                <select
                  className={cx(inputCls, 'h-11 max-w-[11rem] font-normal')}
                  value={player.birthYear ?? ''}
                  onChange={(e) => setPlayer({ ...player, birthYear: e.target.value ? Number(e.target.value) : null })}
                  data-testid="pf-birthyear"
                  dir="ltr"
                >
                  <option value="">{t('chooseOne')}</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                {player.birthYear && <span className="text-[14px] font-normal text-muted">{t('yearsOld', { n: thisYear - player.birthYear })}</span>}
              </span>
            </label>
            <Choice label={t('levelQ')} value={player.level} options={LEVELS.map((l) => ({ v: l, label: levelLabel(lang, l) }))} onPick={(v) => setPlayer({ ...player, level: v })} testId="pf-level" />
            <Choice
              label={t('handQ')}
              value={player.hand}
              options={[
                { v: 'right', label: t('rightHanded') },
                { v: 'left', label: t('leftHanded') },
              ]}
              onPick={(v) => setPlayer({ ...player, hand: v })}
              testId="pf-hand"
            />
            <Choice
              label={t('backhandQ')}
              value={player.backhand}
              options={[
                { v: 'two', label: t('twoHanded') },
                { v: 'one', label: t('oneHanded') },
              ]}
              onPick={(v) => setPlayer({ ...player, backhand: v })}
              testId="pf-backhand"
            />
            <Choice label={t('yearsPlayingQ')} value={player.yearsPlaying} options={YEARS_PLAYING.map((y) => ({ v: y, label: t(`yp_${y}` as Parameters<typeof t>[0]) }))} onPick={(v) => setPlayer({ ...player, yearsPlaying: v })} testId="pf-years" />
            <Text label={t('goalsQ')} value={player.goals} onChange={(v) => setPlayer({ ...player, goals: v })} testId="pf-goals" placeholder={t('goalsPlaceholder')} max={500} area />
          </Section>
        )}

        {!coach && !self && (
          <Section title={t('sectionParent')} testId="pf-parent-section">
            <Text label={t('parentNameQ')} value={details.parentName ?? ''} onChange={(v) => setD('parentName', v)} testId="pf-parent" max={80} />
          </Section>
        )}

        {coach && (
          <Section title={t('sectionCoach')} testId="pf-coach">
            <div className="grid gap-3 sm:grid-cols-2">
              <Text label={t('clubQ')} value={details.club ?? ''} onChange={(v) => setD('club', v)} testId="pf-club" max={80} />
              <Text label={t('cityQ')} value={details.city ?? ''} onChange={(v) => setD('city', v)} testId="pf-city" max={60} />
            </div>
            <Choice
              label={t('yearsCoachingQ')}
              value={details.yearsCoaching}
              options={YEARS_COACHING.map((y) => ({ v: y, label: t(`yc_${y}` as Parameters<typeof t>[0]) }))}
              onPick={(v) => setDetails({ ...details, yearsCoaching: v })}
              testId="pf-coach-years"
            />
            <Text label={t('certificationsQ')} value={details.certifications ?? ''} onChange={(v) => setD('certifications', v)} testId="pf-cert" placeholder={t('certificationsPlaceholder')} max={120} />
            <Text label={t('bioQ')} value={details.bio ?? ''} onChange={(v) => setD('bio', v)} testId="pf-bio" max={300} area />
          </Section>
        )}
      </div>

      <div
        className="sticky z-20 mt-5 flex items-center justify-end gap-2 rounded-2xl border border-line bg-surface/95 p-3 shadow-sm backdrop-blur"
        style={{ bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
      >
        {welcome && (
          <Button onClick={() => navigate('dashboard')} data-testid="pf-skip">
            {t('later')}
          </Button>
        )}
        <Button variant="primary" disabled={busy || !namesOk} onClick={() => void save()} data-testid="pf-save">
          {busy ? '…' : t(welcome ? 'saveAndContinue' : 'save')}
        </Button>
      </div>
    </div>
  );
}
