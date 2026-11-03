/**
 * AI Coach card (report and live pages). A coach asks their own OpenAI / Gemini model for a
 * two-paragraph debrief; the result is kept with the match so parents can read it too.
 */
import { useState } from 'react';
import { useStore } from '../lib/store';
import { formatDate } from '../lib/i18n';
import { replay } from '../lib/match';
import { AI_PROVIDERS, AiError, askCoach, DEFAULT_MODELS, insightParagraphs, KEY_PAGES, keyFor, loadAiSettings, PROVIDER_NAME, saveAiSettings, type AiProvider, type AiSettings } from '../lib/ai';
import type { Match } from '../types';
import { Button, cx, Field, inputCls, Modal } from './ui';
import { useCanEdit } from './MatchBits';

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function AiCoach({ m, live }: { m: Match; live?: boolean }) {
  const { state, dispatch, t, lang, adapter } = useStore();
  const canEdit = useCanEdit();
  // Online version: a family account decides whether its matches may go to an AI service.
  const player = state.players.find((p) => p.id === m.playerId);
  const needsConsent = !!adapter.social && ACCOUNT_ID.test(m.playerId) && player?.aiConsent !== true;
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AiError | null>(null);
  const charted = replay(m).ctx.length;
  const ins = m.ai;
  if (!ins && !canEdit) return null; // families see the analysis once the coach has made one
  if (!charted && !ins) return null;
  const paras = ins ? insightParagraphs(ins.text) : [];
  const provider = PROVIDER_NAME[settings.provider];

  const run = async (s = settings) => {
    if (needsConsent) return;
    if (!keyFor(s)) {
      setSetup(true);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const insight = await askCoach(m, s, lang === 'fa' ? 'fa' : 'en');
      dispatch({ type: 'setMatchAi', id: m.id, ai: insight });
    } catch (e) {
      setErr(e instanceof AiError ? e : new AiError('other', e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const errText = (e: AiError) => {
    const vars = { provider, model: settings.models[settings.provider], msg: e.message.slice(0, 180) };
    const key = { key: 'aiErrKey', quota: 'aiErrQuota', model: 'aiErrModel', network: 'aiErrNetwork', blocked: 'aiErrBlocked', empty: 'aiErrEmpty', other: 'aiErrOther' }[e.kind] as Parameters<typeof t>[0];
    return t(key, vars);
  };

  return (
    <>
      <section className="overflow-hidden rounded-2xl bg-band text-band-ink shadow-sm" data-testid="ai-coach" aria-busy={busy}>
        <div className="h-1 bg-gradient-to-r from-accent via-[#d9f24a] to-accent" aria-hidden="true" />
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-band-ink/10 text-[18px]" aria-hidden="true">
                ✦
              </span>
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold leading-tight">{t('aiTitle')}</h2>
                <p className="text-[12.5px] text-band-muted">{t(live ? 'aiSubLive' : 'aiSub')}</p>
              </div>
            </div>
            {canEdit && (
              <button type="button" onClick={() => setSetup(true)} className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold text-band-muted hover:bg-band-ink/10" data-testid="ai-settings">
                {t('aiSettingsBtn')}
              </button>
            )}
          </div>

          <div className="mt-4">
            {busy ? (
              <div className="flex flex-col gap-2" data-testid="ai-busy">
                <p className="text-[13px] text-band-muted">{t('aiThinking', { n: charted, provider })}</p>
                {[92, 100, 84, 96, 70].map((w, i) => (
                  <span key={i} className="h-3 animate-pulse rounded-full bg-band-ink/15" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : ins ? (
              <div className="flex flex-col gap-4" data-testid="ai-insight" lang={ins.lang}>
                {paras.map((p, i) => (
                  <div key={i}>
                    <p className="mb-1 text-[11.5px] font-bold uppercase tracking-wide text-[#d9f24a]">{i === 0 ? t('aiTactics') : t('aiWork')}</p>
                    <p className="text-[15px] leading-relaxed" data-testid={`ai-p${i + 1}`}>
                      {p}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[14px] text-band-muted">{t(live ? 'aiEmptyLive' : 'aiEmpty')}</p>
            )}
          </div>

          {err && (
            <p className="mt-3 rounded-xl bg-[#ffb4ab]/15 px-3 py-2 text-[13px] text-[#ffd2cc]" role="alert" data-testid="ai-error">
              {errText(err)}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="num text-[12px] text-band-muted" data-testid="ai-meta">
              {ins && t('aiMeta', { model: ins.model, date: formatDate(lang, ins.createdAt.slice(0, 10), { day: 'numeric', month: 'short' }), n: ins.points })}
              {ins && charted > ins.points && <span className="ms-1 font-semibold text-[#d9f24a]">· {t('aiStale', { n: charted - ins.points })}</span>}
            </p>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                {ins && (
                  <button
                    type="button"
                    className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-band-muted hover:bg-band-ink/10"
                    onClick={() => dispatch({ type: 'setMatchAi', id: m.id, ai: null })}
                    data-testid="ai-delete"
                  >
                    {t('aiDelete')}
                  </button>
                )}
                {needsConsent ? (
                  <p className="max-w-xs text-[12.5px] font-semibold text-band-muted" data-testid="ai-needs-consent">
                    {t('aiNeedsConsent', { name: player?.name ?? '' })}
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !charted}
                    onClick={() => void run()}
                    className="rounded-full bg-[#d9f24a] px-4 py-1.5 text-[13.5px] font-bold text-[#0c1f38] transition active:scale-[0.98] disabled:opacity-60"
                    data-testid="ai-ask"
                  >
                    {ins ? t('aiAgain') : t('aiAsk')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      {/* Outside the dark card so the dialog keeps the page's own text colours. */}
      {setup && (
        <AiSettingsModal
          initial={settings}
          onClose={() => setSetup(false)}
          onSave={(s, thenRun) => {
            setSettings(s);
            setSetup(false);
            setErr(null);
            if (thenRun) void run(s);
          }}
        />
      )}
    </>
  );
}

/** Provider, the coach's own API key and model — stored on this device only. */
function AiSettingsModal({ initial, onClose, onSave }: { initial: AiSettings; onClose: () => void; onSave: (s: AiSettings, thenRun: boolean) => void }) {
  const { t, toast } = useStore();
  const [s, setS] = useState<AiSettings>(initial);
  const [show, setShow] = useState(false);
  const p = s.provider;
  const key = s.keys[p] ?? '';
  const name = PROVIDER_NAME[p];
  const save = (next: AiSettings, thenRun: boolean) => {
    const ok = saveAiSettings(next);
    toast(ok ? t('aiSaved') : t('aiNotStored'), ok ? 'ok' : 'warn');
    onSave(next, thenRun);
  };
  return (
    <Modal open onClose={onClose} title={t('aiSettingsTitle')}>
      <div className="flex flex-col gap-4" data-testid="ai-settings-modal">
        <div role="radiogroup" aria-label={t('aiProvider')} className="grid grid-cols-2 gap-2">
          {AI_PROVIDERS.map((x: AiProvider) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={p === x}
              onClick={() => setS({ ...s, provider: x })}
              className={cx('rounded-2xl border-2 p-3 text-start', p === x ? 'border-accent bg-accent-soft' : 'border-line bg-surface')}
              data-testid={`ai-provider-${x}`}
            >
              <span className="block font-semibold">{PROVIDER_NAME[x]}</span>
              <span className="block text-[12px] text-muted">{s.keys[x] ? t('aiKeySaved') : t('aiNoKey')}</span>
            </button>
          ))}
        </div>
        <Field label={t('aiKey')} htmlFor="ai-key">
          <div className="flex gap-2">
            <input
              id="ai-key"
              type={show ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className={inputCls}
              placeholder={p === 'openai' ? 'sk-…' : 'AIza…'}
              value={key}
              onChange={(e) => setS({ ...s, keys: { ...s.keys, [p]: e.target.value.trim() } })}
            />
            <Button size="sm" onClick={() => setShow(!show)}>
              {show ? t('aiHide') : t('aiShow')}
            </Button>
          </div>
        </Field>
        <p className="-mt-2 text-[12.5px] text-muted">
          {t('aiKeyHelp')}{' '}
          <a href={KEY_PAGES[p]} target="_blank" rel="noreferrer" className="font-semibold text-accent">
            {t('aiGetKey', { provider: name })} ↗
          </a>
        </p>
        <Field label={t('aiModel')} htmlFor="ai-model">
          <input id="ai-model" dir="ltr" className={inputCls} value={s.models[p]} onChange={(e) => setS({ ...s, models: { ...s.models, [p]: e.target.value } })} />
        </Field>
        <p className="-mt-2 text-[12.5px] text-muted">
          {t('aiModelHelp', { model: DEFAULT_MODELS[p] })}{' '}
          {s.models[p].trim() !== DEFAULT_MODELS[p] && (
            <button type="button" className="font-semibold text-accent" onClick={() => setS({ ...s, models: { ...s.models, [p]: DEFAULT_MODELS[p] } })}>
              {t('aiUseDefault')}
            </button>
          )}
        </p>
        <p className="rounded-xl bg-sunken p-3 text-[12.5px]">{t('aiPrivacy', { provider: name })}</p>
        <div className="flex flex-wrap justify-end gap-2">
          {initial.keys[p] && (
            <Button
              variant="danger"
              onClick={() => {
                const { [p]: _gone, ...rest } = s.keys;
                save({ ...s, keys: rest }, false);
              }}
              data-testid="ai-remove-key"
            >
              {t('aiRemoveKey')}
            </Button>
          )}
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!key} onClick={() => save({ ...s, models: { ...s.models, [p]: s.models[p].trim() || DEFAULT_MODELS[p] } }, true)} data-testid="ai-save">
            {t('aiSaveAndRun')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
