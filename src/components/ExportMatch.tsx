/**
 * "Share report": preview the match report exactly as it will be sent, then send the file (share
 * sheet: Mail, WhatsApp, AirDrop, Files), download it, save it as PDF, or copy a short summary.
 */
import { useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import type { Lang } from '../lib/i18n';
import { matchFileName, matchReportHtml, matchSummaryText } from '../lib/matchExport';
import type { Match } from '../types';
import { Button, cx, downloadText, Modal } from './ui';

export function ExportMatchButton({ m }: { m: Match }) {
  const { t } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="export-match">
        <span aria-hidden="true">📤</span>
        {t('exportBtn')}
      </Button>
      {open && <ExportMatchModal m={m} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExportMatchModal({ m, onClose }: { m: Match; onClose: () => void }) {
  const { state, t, lang, toast } = useStore();
  const [rlang, setRlang] = useState<Lang>(lang);
  const frame = useRef<HTMLIFrameElement>(null);
  const player = state.players.find((p) => p.id === m.playerId);
  const tournament = m.tournamentId ? state.tournaments.find((x) => x.id === m.tournamentId) : undefined;
  const playerName = player?.name ?? t('player');
  const ctx = useMemo(() => ({ lang: rlang, playerName, tournament }), [rlang, playerName, tournament]);
  const html = useMemo(() => matchReportHtml(m, ctx), [m, ctx]);
  const text = useMemo(() => matchSummaryText(m, ctx), [m, ctx]);
  const fileName = matchFileName(m, playerName);
  const title = `${playerName} — ${m.opponent || t('opponent')}`;

  const download = async () => {
    await downloadText(fileName, html, 'text/html;charset=utf-8');
  };
  const share = async () => {
    const file = new File([html], fileName, { type: 'text/html' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title, text });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // closed the share sheet
    }
    await download();
    toast(t('exportNoFileShare'), 'warn');
  };
  const print = () => {
    const w = frame.current?.contentWindow;
    try {
      w?.focus();
      w?.print();
    } catch {
      // Fallback: open the report on its own; the browser's share / print menu takes it from there.
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('exportCopied'));
    } catch {
      toast(t('inviteCopyFailed'), 'warn');
    }
  };
  const mailto = `mailto:?subject=${encodeURIComponent(`${title} · ${m.date}`)}&body=${encodeURIComponent(`${text}\n\n${t('exportEmailNote')}`)}`;

  return (
    <Modal open onClose={onClose} title={t('exportTitle')} wide>
      <div className="flex flex-col gap-4" data-testid="export-modal">
        <p className="text-sm text-muted">{t('exportHelp')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">{t('exportLang')}</span>
          <div className="inline-flex rounded-full bg-sunken p-1" role="radiogroup" aria-label={t('exportLang')}>
            {(['fa', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={rlang === l}
                onClick={() => setRlang(l)}
                className={cx('h-8 rounded-full px-4 text-[13px] font-semibold', rlang === l ? 'bg-surface text-ink shadow-sm' : 'text-muted')}
                data-testid={`export-lang-${l}`}
              >
                {l === 'fa' ? 'فارسی' : 'English'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void share()} data-testid="export-share">
            {t('exportShare')}
          </Button>
          <Button onClick={() => void download()} data-testid="export-download">
            {t('exportDownload')}
          </Button>
          <Button onClick={print} data-testid="export-print">
            {t('exportPrint')}
          </Button>
          <Button onClick={() => void copy()} data-testid="export-copy">
            {t('exportCopy')}
          </Button>
          <a href={mailto} className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-accent" data-testid="export-email">
            {t('exportEmail')}
          </a>
        </div>
        <p className="text-[12px] text-muted">{t('exportPrintHelp')}</p>
        <div>
          <div className="eyebrow mb-1">{t('exportPreview')}</div>
          <iframe
            ref={frame}
            title={t('exportPreview')}
            srcDoc={html}
            sandbox="allow-same-origin allow-modals"
            className="h-[60vh] w-full rounded-2xl border border-line bg-white"
            data-testid="export-preview"
          />
        </div>
      </div>
    </Modal>
  );
}
