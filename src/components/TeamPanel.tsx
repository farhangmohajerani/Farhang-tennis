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
      await team.invite(email.trim().toLowerCase(), role);
      toast(t('invited', { email: email.trim() }));
      setEmail('');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
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
  const { t, state } = useStore();
  const team = getTeam();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!team || state.settings.role !== 'admin') return;
    team.list().then((ms) => setN(ms.filter((m) => m.requested).length)).catch(() => undefined);
  }, [team, state.settings.role]);
  if (!n) return null;
  return (
    <a href="#admin" className="mb-4 flex items-center gap-2 rounded-2xl border border-warn bg-warn-soft p-3 text-sm font-semibold text-warn" data-testid="requests-banner">
      {t('coachRequests', { n })} →
    </a>
  );
}
