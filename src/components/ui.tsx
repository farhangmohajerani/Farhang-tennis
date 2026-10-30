import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { KpiKey, StarLevels } from '../types';
import { pct, starsFor, type Ratio } from '../lib/kpi';
import { useStore } from '../lib/store';
import { kpiKey } from '../lib/i18n';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:border-accent',
        variant === 'ghost' && 'text-accent hover:bg-accent-soft',
        variant === 'danger' && 'border border-bad/40 bg-surface text-bad hover:bg-bad-soft',
        className,
      )}
    />
  );
}

/** Two-step confirmation (window.confirm is unavailable in sandboxed viewers). */
export function ConfirmButton({ label, confirmLabel, onConfirm, variant = 'danger', size = 'sm' }: { label: string; confirmLabel: string; onConfirm: () => void; variant?: Variant; size?: 'sm' | 'md' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <Button variant="danger" size={size} onClick={() => { setArmed(false); onConfirm(); }}>
      {confirmLabel}
    </Button>
  ) : (
    <Button variant={variant} size={size} onClick={() => setArmed(true)}>
      {label}
    </Button>
  );
}

export function Card({ children, className, as: As = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <As className={cx('rounded-2xl border border-line bg-surface', className)}>{children}</As>;
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'band'; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-5',
        tone === 'neutral' && 'bg-sunken text-muted',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'good' && 'bg-good-soft text-good',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'bad' && 'bg-bad-soft text-bad',
        tone === 'band' && 'bg-band text-band-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stars({ n, label }: { n: 0 | 1 | 2 | 3 | null; label?: string }) {
  const { t } = useStore();
  if (n === null) return <span className="text-[12px] text-muted">{t('insufficient')}</span>;
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label ?? t('stars', { n })}>
      {[1, 2, 3].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
          <path d="M10 1.8l2.5 5.3 5.8.7-4.3 4 1.1 5.8L10 14.8l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7z" fill={i <= n ? 'var(--tp-star)' : 'none'} stroke={i <= n ? 'var(--tp-star)' : 'var(--tp-line)'} strokeWidth="1.4" />
        </svg>
      ))}
    </span>
  );
}

/** One KPI: label, percentage, fraction and stars. Explicitly shows "insufficient data" when the denominator is 0. */
export function KpiTile({ k, r, levels, compact }: { k: KpiKey; r: Ratio; levels: StarLevels; compact?: boolean }) {
  const { t } = useStore();
  const s = starsFor(r, levels);
  return (
    <div className={cx('flex flex-col gap-1 rounded-xl bg-sunken', compact ? 'p-3' : 'p-4')} data-kpi={k}>
      <span className="eyebrow">{t(kpiKey(k))}</span>
      <span className={cx('num font-mono font-medium', compact ? 'text-xl' : 'text-2xl')} data-testid={`kpi-${k}`}>
        {r.ok ? pct(r) : <span className="text-base text-muted">{t('insufficient')}</span>}
      </span>
      <span className="num text-[12px] text-muted">
        {r.num} / {r.den}
      </span>
      <Stars n={s} />
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1" htmlFor={htmlFor}>
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      {children}
      {hint && !error && <span className="text-[12px] text-muted">{hint}</span>}
      {error && <span className="text-[12px] font-semibold text-bad" role="alert">{error}</span>}
    </label>
  );
}

export const inputCls = 'w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted focus:border-accent outline-none';

export function NumberStepper({ id, value, onChange, label, invalid }: { id: string; value: number; onChange: (n: number) => void; label: string; invalid?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-semibold">{label}</label>
      <div className={cx('flex items-stretch overflow-hidden rounded-xl border bg-surface', invalid ? 'border-bad' : 'border-line')}>
        <button type="button" aria-label={`${label} −1`} className="w-11 shrink-0 text-xl text-accent hover:bg-accent-soft" onClick={() => onChange(Math.max(0, value - 1))}>
          −
        </button>
        <input
          id={id}
          inputMode="numeric"
          pattern="[0-9]*"
          className="num w-full min-w-0 border-x border-line bg-transparent py-2 text-center font-mono text-lg outline-none"
          value={String(value)}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/\D/g, '') || '0', 10);
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
        <button type="button" aria-label={`${label} +1`} className="w-11 shrink-0 text-xl text-accent hover:bg-accent-soft" onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 pb-5 pt-6">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="font-display text-[34px] leading-[1.05] tracking-tight md:text-[42px]">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-display text-2xl leading-tight">{children}</h2>
      {aside}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</div>;
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
      style={{ bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}
      aria-live="polite"
      role="status"
    >
      {toasts.map((x) => (
        <div
          key={x.id}
          className={cx(
            'toast-in pointer-events-auto max-w-md rounded-full px-4 py-2 text-sm font-semibold shadow-lg',
            x.tone === 'ok' && 'bg-band text-band-ink',
            x.tone === 'warn' && 'bg-warn text-bg',
            x.tone === 'error' && 'bg-bad text-bg',
          )}
        >
          {x.text}
        </div>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-band/60 md:items-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-surface md:rounded-3xl', wide ? 'md:max-w-3xl' : 'md:max-w-lg')}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 id={titleId} className="font-display text-2xl">{title}</h2>
          <button type="button" className="h-9 w-9 rounded-full text-xl text-muted hover:bg-sunken" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * Offer a file. Inside claude.ai the `downloads` capability asks the viewer to confirm;
 * on a normal deployment a plain browser download is used. Resolves true when started.
 */
export async function downloadText(filename: string, text: string, mime: string): Promise<boolean> {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (c && typeof c.use === 'function') {
    const dl = (await c.use('downloads').catch(() => null)) as { save(r: { filename: string; data: string }): Promise<unknown> } | null;
    if (dl) {
      try {
        await dl.save({ filename, data: text });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string, fallbackEl?: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackEl) {
      fallbackEl.focus();
      fallbackEl.select();
    }
    return false;
  }
}

export const Icon = {
  court: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" className={p.className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="2.5" width="18" height="19" rx="1" />
      <path d="M6 2.5v19M18 2.5v19M3 12h18M6 7h12M6 17h12M12 7v10" />
    </svg>
  ),
  search: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" className={p.className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  ),
  up: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" className={p.className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 15l6-6 6 6" />
    </svg>
  ),
  down: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" className={p.className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  x: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" className={p.className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  trophy: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" className={p.className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8" />
    </svg>
  ),
};
