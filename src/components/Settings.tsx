/**
 * Settings (online version): a link to the profile, notifications on this device, privacy choices,
 * password, privacy notice, sign out and deleting the account.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { navigate } from '../lib/router';
import { getSocial, type PlayerPatch } from '../lib/social';
import { getTeam } from '../lib/team';
import { disablePush, enablePush, isIOS, pushState, type PushState } from '../lib/push';
import { Badge, Button, cx, Modal, Switch } from './ui';
import { useMe, useSocialError, VerifiedBadge } from './Social';
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
  const [busy, setBusy] = useState('');
  const own = state.players.find((p) => p.id === adapter.myId);
  if (!social || !me) return null;
  const family = me.kind === 'family';
  const self = me.holder === 'player';

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
        <button
          type="button"
          className="flex items-center gap-3 rounded-2xl border border-line p-3 text-start hover:border-accent"
          onClick={() => {
            onClose();
            navigate('profile');
          }}
          data-testid="settings-profile"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-band font-display text-2xl text-band-ink" aria-hidden="true">
            {me.displayName.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-semibold">
              {me.displayName} {me.verified && <VerifiedBadge />}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
              <Badge tone={family ? 'band' : 'accent'}>{t(!family ? 'kind_coach' : self ? 'kind_player' : 'kind_family')}</Badge>
              {team && (
                <span className="truncate" dir="ltr">
                  {team.myEmail}
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-[13px] font-semibold text-accent">{t('editProfile')} ›</span>
          </span>
        </button>

        {!self && (
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
        )}

        {family && (
          <Group title={t('settingsPrivacy')} testId="settings-privacy">
            <Switch
              checked={me.discoverable}
              onChange={(v) => void save('discover', () => social.updateProfile({ discoverable: v }), t('savedToast'))}
              label={t(self ? 'discoverLabelSelf' : 'discoverLabel')}
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
          <button
            type="button"
            className={rowBtn}
            onClick={() => {
              onClose();
              navigate('profile');
            }}
            data-testid="settings-edit-profile"
          >
            {t('editProfile')} <span className="text-muted" aria-hidden="true">›</span>
          </button>
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
