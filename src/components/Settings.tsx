/**
 * Settings (online version): profile and username, notifications on this device, privacy choices,
 * the family's player details, password, privacy notice, sign out and deleting the account.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { asciiDigits } from '../lib/i18n';
import { cleanUsername, getSocial, USERNAME_RE, type PlayerPatch } from '../lib/social';
import { getTeam } from '../lib/team';
import { disablePush, enablePush, isIOS, pushState, type PushState } from '../lib/push';
import { Badge, Button, cx, inputCls, Modal, Switch } from './ui';
import { Handle, useMe, useSocialError, VerifiedBadge } from './Social';
import { PrivacyNoticeBody } from './PrivacyNotice';

/** This device's notification state; null while it is being checked. */
export function usePushState(): [PushState | null, (s: PushState) => void] {
  const [st, setSt] = useState<PushState | null>(null);
  useEffect(() => {
    let live = true;
    pushState()
      .then((s) => live && setSt(s))
      .catch(() => live && setSt('unsupported'));
    return () => {
      live = false;
    };
  }, []);
  return [st, setSt];
}

/** iPhone and iPad: notifications need the app on the Home Screen (iOS 16.4 or later). */
export function InstallGuide() {
  const { t } = useStore();
  return (
    <div className="rounded-2xl bg-sunken p-3 text-[13.5px]" data-testid="install-guide">
      <p className="mb-1.5 font-semibold">{t('installTitle')}</p>
      <ol className="flex list-decimal flex-col gap-1 ps-5">
        <li>{t('installStep1')}</li>
        <li>{t('installStep2')}</li>
        <li>{t('installStep3')}</li>
      </ol>
    </div>
  );
}

/** Turn notifications on or off for this device (asks the browser at the moment of the tap). */
export function PushControl({ onChange }: { onChange?: (s: PushState) => void }) {
  const { t, lang, toast } = useStore();
  const social = getSocial();
  const [st, setSt] = usePushState();
  const [busy, setBusy] = useState(false);
  if (!social || st === null) return null;
  const set = (s: PushState) => {
    setSt(s);
    onChange?.(s);
  };
  if (st === 'install') return <InstallGuide />;
  if (st === 'unsupported') return <p className="text-[13px] text-muted" data-testid="push-unsupported">{t('pushUnsupported')}</p>;
  if (st === 'denied') return <p className="rounded-xl bg-warn-soft p-2.5 text-[13px] font-semibold text-warn" data-testid="push-denied">{t(isIOS() ? 'pushDeniedIos' : 'pushDenied')}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="push-control">
      <span className={cx('min-w-0 flex-1 text-[13.5px]', st === 'on' ? 'font-semibold text-good' : 'text-muted')}>{t(st === 'on' ? 'pushOnHere' : 'pushOffHere')}</span>
      {st === 'on' ? (
        <Button
          size="sm"
          disabled={busy}
          data-testid="push-off"
          onClick={async () => {
            setBusy(true);
            try {
              await disablePush(social.disablePush);
              set('off');
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('pushTurnOff')}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          data-testid="push-on"
          onClick={async () => {
            setBusy(true);
            try {
              const r = await enablePush(social.savePush, lang);
              set(r);
              if (r === 'on') {
                if (!social.me.notifyLive) await social.updateProfile({ notifyLive: true });
                toast(t('pushOnToast'));
              } else if (r === 'off') toast(t('pushDismissed'), 'warn');
            } catch {
              toast(t('pushFailed'), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('pushTurnOn')}
        </Button>
      )}
    </div>
  );
}

function Group({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col" data-testid={testId}>
      <h3 className="eyebrow mb-1.5">{title}</h3>
      <div className="flex flex-col divide-y divide-line rounded-2xl border border-line px-3.5">{children}</div>
    </section>
  );
}

const rowBtn = 'flex w-full items-center justify-between gap-3 py-3 text-start text-[15px] font-semibold';

export function SettingsModal({ onClose, onChangePassword, onDelete }: { onClose: () => void; onChangePassword: () => void; onDelete: () => void }) {
  const { state, t, toast, adapter } = useStore();
  const social = getSocial();
  const me = useMe();
  const team = getTeam();
  const errText = useSocialError();
  const [view, setView] = useState<'main' | 'privacy'>('main');
  const [name, setName] = useState(me?.displayName ?? '');
  const [username, setUsername] = useState(me?.username ?? '');
  const [userStatus, setUserStatus] = useState<'checking' | 'available' | 'taken' | null>(null);
  const [busy, setBusy] = useState('');
  const own = state.players.find((p) => p.id === adapter.myId);
  const [details, setDetails] = useState({ birthYear: String(own?.birthYear ?? ''), hand: own?.hand ?? 'right', backhand: own?.backhand ?? 'two' });
  useEffect(() => {
    if (!social || !me || username === me.username || !USERNAME_RE.test(username)) return setUserStatus(null);
    setUserStatus('checking');
    let live = true;
    const timer = setTimeout(() => {
      social
        .usernameAvailable(username)
        .then((ok) => live && setUserStatus(ok ? 'available' : 'taken'))
        .catch(() => live && setUserStatus(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [username, social, me]);
  if (!social || !me) return null;
  const family = me.kind === 'family';
  const year = new Date().getFullYear();
  const by = Number(details.birthYear);
  const yearOk = /^\d{4}$/.test(details.birthYear) && by >= year - 90 && by <= year - 3;

  const save = async (key: string, fn: () => Promise<{ error?: string; ok?: boolean } | null>, done: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r?.error) toast(errText(r), 'error');
      else toast(done);
    } catch {
      toast(t('socialErr'), 'error');
    } finally {
      setBusy('');
    }
  };
  const patchPlayer = (patch: PlayerPatch, done: string) => save(Object.keys(patch).join(','), () => social.updatePlayer(patch), done);

  if (view === 'privacy') {
    return (
      <Modal open onClose={onClose} title={t('privacyTitle')}>
        <PrivacyNoticeBody lang={state.settings.lang} />
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setView('main')} data-testid="privacy-back">
            {t('back')}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={t('settingsTitle')}>
      <div className="flex flex-col gap-5" data-testid="settings">
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-band font-display text-2xl text-band-ink" aria-hidden="true">
            {me.displayName.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">
              {me.displayName} {me.verified && <VerifiedBadge />}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
              <Handle u={me.username} />
              <Badge tone={family ? 'band' : 'accent'}>{t(family ? 'kind_family' : 'kind_coach')}</Badge>
            </p>
            {team && (
              <p className="truncate text-[12px] text-muted" dir="ltr">
                {team.myEmail}
              </p>
            )}
          </div>
        </div>

        <Group title={t(family ? 'settingsPlayer' : 'settingsProfile')} testId="settings-profile">
          <label className="flex flex-col gap-1 py-3 text-[13px] font-semibold">
            {t(family ? 'playerName' : 'yourName')}
            <span className="flex gap-2">
              <input className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} dir="auto" data-testid="settings-name" />
              <Button
                size="sm"
                variant="primary"
                className="shrink-0 self-center"
                disabled={busy !== '' || name.trim().length < 2 || name.trim() === me.displayName}
                data-testid="settings-save-name"
                onClick={() => void save('name', () => (family ? social.updatePlayer({ name: name.trim() }) : social.updateProfile({ displayName: name.trim() })), t('savedToast'))}
              >
                {t('save')}
              </Button>
            </span>
          </label>
          <label className="flex flex-col gap-1 py-3 text-[13px] font-semibold">
            {t('usernameLabel')}
            <span className="flex gap-2">
              <span className="flex min-w-0 flex-1 items-center rounded-xl border border-line bg-surface ps-3" dir="ltr">
                <span className="text-muted">@</span>
                <input
                  className="min-w-0 flex-1 bg-transparent px-1 py-2 font-normal text-ink outline-none"
                  value={username}
                  onChange={(e) => setUsername(cleanUsername(e.target.value))}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  data-testid="settings-username"
                />
              </span>
              <Button
                size="sm"
                variant="primary"
                className="shrink-0 self-center"
                disabled={busy !== '' || username === me.username || !USERNAME_RE.test(username) || userStatus === 'taken'}
                data-testid="settings-save-username"
                onClick={() => void save('username', () => social.changeUsername(username), t('usernameChanged', { u: username }))}
              >
                {t('save')}
              </Button>
            </span>
            <span
              className={cx(
                'text-[12.5px] font-normal',
                userStatus === 'taken' || (username && !USERNAME_RE.test(username)) ? 'font-semibold text-bad' : userStatus === 'available' ? 'font-semibold text-good' : 'text-muted',
              )}
            >
              {userStatus === 'taken' ? t('usernameTaken') : userStatus === 'available' ? t('usernameFree') : userStatus === 'checking' ? '…' : t('usernameChangeHint')}
            </span>
          </label>
          {family && own && (
            <div className="flex flex-col gap-2 py-3" data-testid="settings-details">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="col-span-2 flex flex-col gap-1 text-[12.5px] font-semibold sm:col-span-1">
                  {t('birthYear')}
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    dir="ltr"
                    value={details.birthYear}
                    onChange={(e) => setDetails({ ...details, birthYear: asciiDigits(e.target.value).replace(/\D/g, '').slice(0, 4) })}
                    data-testid="settings-birthyear"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12.5px] font-semibold">
                  {t('hand')}
                  <select className={inputCls} value={details.hand} onChange={(e) => setDetails({ ...details, hand: e.target.value as 'right' | 'left' })} data-testid="settings-hand">
                    <option value="right">{t('rightHanded')}</option>
                    <option value="left">{t('leftHanded')}</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[12.5px] font-semibold">
                  {t('backhandType')}
                  <select className={inputCls} value={details.backhand} onChange={(e) => setDetails({ ...details, backhand: e.target.value as 'one' | 'two' })} data-testid="settings-backhand">
                    <option value="two">{t('twoHanded')}</option>
                    <option value="one">{t('oneHanded')}</option>
                  </select>
                </label>
              </div>
              <Button
                size="sm"
                className="self-end"
                disabled={busy !== '' || !yearOk || (by === own.birthYear && details.hand === own.hand && details.backhand === own.backhand)}
                data-testid="settings-save-details"
                onClick={() => void patchPlayer({ birthYear: by, hand: details.hand, backhand: details.backhand }, t('savedToast'))}
              >
                {t('save')}
              </Button>
            </div>
          )}
        </Group>

        <Group title={t('settingsNotifications')} testId="settings-notifications">
          <Switch
            checked={me.notifyLive}
            onChange={(v) => void save('notify', () => social.updateProfile({ notifyLive: v }), t(v ? 'notifyOnToast' : 'notifyOffToast'))}
            label={t('notifyLive')}
            hint={t(family ? 'notifyLiveHintFamily' : 'notifyLiveHintCoach')}
            disabled={busy !== ''}
            data-testid="settings-notify"
          />
          {me.notifyLive && (
            <div className="py-3">
              <PushControl />
            </div>
          )}
        </Group>

        {family && (
          <Group title={t('settingsPrivacy')} testId="settings-privacy">
            <Switch
              checked={me.discoverable}
              onChange={(v) => void save('discover', () => social.updateProfile({ discoverable: v }), t('savedToast'))}
              label={t('discoverLabel')}
              hint={t('discoverHint')}
              disabled={busy !== ''}
              data-testid="settings-discoverable"
            />
            {own && (
              <Switch
                checked={own.aiConsent === true}
                onChange={(v) => void patchPlayer({ aiConsent: v }, t(v ? 'aiAllowedToast' : 'aiStoppedToast'))}
                label={t('allowAi')}
                hint={t('allowAiHint')}
                disabled={busy !== ''}
                data-testid="settings-ai"
              />
            )}
          </Group>
        )}

        <Group title={t('settingsAccount')} testId="settings-account">
          <button type="button" className={rowBtn} onClick={onChangePassword} data-testid="settings-password">
            {t('changePassword')} <span className="text-muted" aria-hidden="true">›</span>
          </button>
          <button type="button" className={rowBtn} onClick={() => setView('privacy')} data-testid="settings-privacy-notice">
            {t('privacyTitle')} <span className="text-muted" aria-hidden="true">›</span>
          </button>
          {team && (
            <button type="button" className={rowBtn} onClick={() => team.signOut()} data-testid="settings-sign-out">
              {t('signOutBtn')} <span className="text-muted" aria-hidden="true">›</span>
            </button>
          )}
          {team && (
            <button type="button" className={cx(rowBtn, 'text-bad')} onClick={onDelete} data-testid="settings-delete">
              {t('deleteAccount')} <span aria-hidden="true">›</span>
            </button>
          )}
        </Group>
      </div>
    </Modal>
  );
}
