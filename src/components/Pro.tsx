/** 21GRAM Tennis Pro: the badge on Pro drills and the card shown in place of a locked drill. */
import { useStore } from '../lib/store';
import { Badge, Card, cx } from './ui';

export function ProBadge({ locked }: { locked?: boolean }) {
  const { t } = useStore();
  return (
    <span className="inline-flex shrink-0" data-testid={locked ? 'pro-locked' : 'pro-badge'}>
      <Badge tone="band">
        {locked ? '🔒 ' : ''}
        {t('proBadge')}
      </Badge>
    </span>
  );
}

/** Why the drill is locked and which plan opens it. Purchases are not offered here yet — say so plainly. */
export function ProCard({ className }: { className?: string }) {
  const { t } = useStore();
  return (
    <Card className={cx('p-5', className)}>
      <div className="mb-1 flex items-center gap-2" data-testid="pro-card">
        <ProBadge locked />
        <h2 className="font-display text-2xl leading-tight">{t('proLockedTitle')}</h2>
      </div>
      <p className="max-w-[65ch] text-[15px]">{t('proLockedText')}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(['coach', 'family'] as const).map((p) => (
          <div key={p} className="rounded-2xl border border-line bg-sunken p-4" data-plan={p}>
            <h3 className="font-semibold">{t(p === 'coach' ? 'planCoachTitle' : 'planFamilyTitle')}</h3>
            <p className="mt-1 text-[13.5px] text-muted">{t(p === 'coach' ? 'planCoachText' : 'planFamilyText')}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-muted">{t('proHowTo')}</p>
    </Card>
  );
}
