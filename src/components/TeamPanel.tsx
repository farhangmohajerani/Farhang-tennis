import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { getTeam, type TeamMember } from '../lib/team';
import { Badge, Button, Card, ConfirmButton, cx, inputCls, SectionTitle } from './ui';

/** Admin: invite and remove coaches (Supabase mode). */
export function TeamPanel() {
  const { t, toast } = useStore();
  const team = getTeam();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    team?.list().then(setMembers).catch(() => undefined);
  }, [team]);
  useEffect(load, [load]);
  if (!team) return null;
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const invite = async (role: 'admin' | 'coach') => {
    setBusy(true);
    try {
      const { code } = await team.invite(email.trim().toLowerCase(), role);
      toast(t('invitedWithCode', { email: email.trim(), code }));
      setEmail('');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  /** The invite as a message: the share sheet where there is one, otherwise copied. */
  const sendInvite = async (m: TeamMember) => {
    const text = t('coachInviteText', { email: m.email, code: m.code ?? '', url: `${window.location.origin}${window.location.pathname}` });
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) {
        await nav.share({ text });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(t('inviteCopied'));
    } catch {
      toast(t('inviteCopyFailed'), 'warn');
    }
  };
  return (
    <Card className="p-5">
      <SectionTitle>{t('teamTitle')}</SectionTitle>
      <p className="mb-3 text-[13px] text-muted">{t('teamHelp')}</p>
      <ul className="mb-3 flex flex-col divide-y divide-line rounded-xl border border-line" data-testid="team-list">
        {members.map((m) => (
          <li key={m.email + m.role} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{m.email}</span>
            <Badge tone={m.role === 'admin' ? 'band' : 'accent'}>{t(m.role === 'admin' ? 'role_admin' : 'role_coach')}</Badge>
            {m.pending && !m.requested && <Badge tone="warn">{t('pendingInvite')}</Badge>}
            {m.pending && !m.requested && m.code && (
              <span className="inline-flex items-center gap-2">
                <span className="num rounded-lg bg-sunken px-2 py-0.5 font-mono text-[15px] font-semibold tracking-[0.2em]" dir="ltr" data-testid={`invite-code-${m.email}`}>
                  {m.code}
                </span>
                <Button size="sm" onClick={() => void sendInvite(m)} data-testid={`send-invite-${m.email}`}>
                  {t('sendInvite')}
                </Button>
              </span>
            )}
            {m.requested && (
              <>
                <Badge tone="warn">{t('wantsAccess')}</Badge>
                <Button
                  size="sm"
                  variant="primary"
                  data-testid={`approve-${m.email}`}
                  onClick={async () => {
                    try {
                      await team.approve(m);
                      toast(t('approved', { email: m.email }));
                      load();
                    } catch (e) {
                      toast(e instanceof Error ? e.message : String(e), 'error');
                    }
                  }}
                >
                  {t('approve')}
                </Button>
              </>
            )}
            {m.email !== team.myEmail && (
              <ConfirmButton
                label={t('remove')}
                confirmLabel={`${t('removeAccess')}?`}
                onConfirm={async () => {
                  await team.remove(m).catch((e) => toast(String(e), 'error'));
                  toast(t('accessRemoved'));
                  load();
                }}
              />
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void invite('coach');
        }}
      >
        <input id="invite-email" type="email" autoComplete="off" placeholder={t('inviteEmail')} aria-label={t('inviteEmail')} className={cx(inputCls)} value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={!valid || busy} data-testid="invite-coach">
            {t('inviteCoach')}
          </Button>
          <Button disabled={!valid || busy} onClick={() => void invite('admin')}>
            {t('inviteAdmin')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Admin: a notice on the dashboard when coaches are waiting for approval. */
export function CoachRequestsBanner() {
  const { t, state, adapter } = useStore();
  const team = getTeam();
  const [n, setN] = useState(0);
  useEffect(() => {
    // Usernames mode has no coach approvals: coaches sign up freely.
    if (!team || adapter.social || state.settings.role !== 'admin') return;
    team.list().then((ms) => setN(ms.filter((m) => m.requested).length)).catch(() => undefined);
  }, [team, adapter.social, state.settings.role]);
  if (!n) return null;
  return (
    <a href="#admin" className="mb-4 flex items-center gap-2 rounded-2xl border border-warn bg-warn-soft p-3 text-sm font-semibold text-warn" data-testid="requests-banner">
      {t('coachRequests', { n })} →
    </a>
  );
}
