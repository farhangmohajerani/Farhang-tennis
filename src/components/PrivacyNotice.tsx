/**
 * The privacy notice people accept at sign-up (CONSENT_VERSION in lib/social.ts). Plain words, what the
 * app really does. Shown on the sign-in page (outside the store) and in Settings.
 */
type Section = { h: string; p: string };

const TEXT: Record<'en' | 'fa', { title: string; updated: string; sections: Section[] }> = {
  en: {
    title: 'Privacy notice',
    updated: 'Version of November 2026',
    sections: [
      { h: 'Who we are', p: '21GRAM Tennis is the training app of the 21GRAM tennis academy. For questions or requests about your data, ask your coach or the academy.' },
      {
        h: 'What we keep',
        p: 'Your email and password (to sign in), your username and name. For a player: name, birth year, playing hand, and the training plans, session results, matches and notes that the family and its coaches add.',
      },
      {
        h: 'Who can see it',
        p: 'Only you and the coaches you allow. A coach sees a player only after the family accepts, and can be disconnected at any time. Coaches never see your email or password, and families never see other families.',
      },
      { h: 'Being found', p: 'Coaches can find a family only by its exact username, unless the family chooses to be found by name in Settings.' },
      {
        h: 'Notifications',
        p: 'If you turn them on, this device gets a notification when a match of a player you are connected to starts. You can turn them off in Settings at any time.',
      },
      {
        h: 'AI analysis',
        p: 'Only if the family allows it: a coach can send a match’s statistics and point log — never the player’s or the opponent’s name — to an AI service (OpenAI or Google Gemini) to write a short analysis.',
      },
      { h: 'Where it is stored', p: 'In our database at Supabase, our hosting provider. We do not sell your data or show advertising.' },
      { h: 'Players under 18', p: 'A parent or legal guardian makes and manages the account of a player under 18.' },
      {
        h: 'Your choices',
        p: 'You can change your details, disconnect a coach, turn off notifications or AI analysis, and delete your account with its data at any time in Settings.',
      },
      { h: 'Changes', p: 'If this notice changes in an important way, the app asks you to accept it again.' },
    ],
  },
  fa: {
    title: 'حریم خصوصی',
    updated: 'نسخهٔ نوامبر ۲۰۲۶',
    sections: [
      { h: 'ما چه کسی هستیم', p: '21GRAM Tennis اپ تمرینی آکادمی تنیس 21GRAM است. برای هر سؤال یا درخواست دربارهٔ اطلاعاتتان، به مربی‌تان یا آکادمی بگویید.' },
      {
        h: 'چه چیزی نگه می‌داریم',
        p: 'ایمیل و رمز عبور (برای ورود)، نام کاربری و نام شما. برای بازیکن: نام، سال تولد، دست بازی، و برنامه‌های تمرین، نتیجهٔ جلسه‌ها، بازی‌ها و یادداشت‌هایی که خانواده و مربی‌هایش ثبت می‌کنند.',
      },
      {
        h: 'چه کسی می‌بیند',
        p: 'فقط خودتان و مربی‌هایی که اجازه می‌دهید. مربی فقط بعد از تأیید خانواده بازیکن را می‌بیند و هر وقت بخواهید می‌توانید اتصال را قطع کنید. مربی‌ها هیچ‌وقت ایمیل و رمز شما را نمی‌بینند و خانواده‌ها هم خانواده‌های دیگر را نمی‌بینند.',
      },
      { h: 'پیدا شدن', p: 'مربی‌ها خانواده را فقط با نام کاربری دقیقش پیدا می‌کنند، مگر اینکه خانواده در تنظیمات اجازه دهد با نام هم پیدا شود.' },
      {
        h: 'اعلان‌ها',
        p: 'اگر روشنشان کنید، وقتی بازی بازیکنی که به او متصل هستید شروع شود، روی همین دستگاه اعلان می‌آید. هر وقت بخواهید در تنظیمات خاموششان کنید.',
      },
      {
        h: 'تحلیل هوش مصنوعی',
        p: 'فقط اگر خانواده اجازه دهد: مربی می‌تواند آمار و ثبت امتیازهای یک بازی را — بدون نام بازیکن یا حریف — برای یک سرویس هوش مصنوعی (OpenAI یا Google Gemini) بفرستد تا تحلیل کوتاهی بنویسد.',
      },
      { h: 'کجا نگه داشته می‌شود', p: 'در پایگاه دادهٔ ما در Supabase (سرویس میزبانی ما). اطلاعات شما را نمی‌فروشیم و تبلیغ نشان نمی‌دهیم.' },
      { h: 'بازیکنان زیر ۱۸ سال', p: 'حساب بازیکن زیر ۱۸ سال را پدر، مادر یا سرپرست قانونی‌اش می‌سازد و مدیریت می‌کند.' },
      {
        h: 'اختیار با شماست',
        p: 'هر وقت بخواهید در تنظیمات می‌توانید اطلاعاتتان را عوض کنید، اتصال مربی را قطع کنید، اعلان یا تحلیل هوش مصنوعی را خاموش کنید و حسابتان را با همهٔ اطلاعاتش حذف کنید.',
      },
      { h: 'تغییرات', p: 'اگر این متن به‌طور مهمی تغییر کند، اپ دوباره از شما تأیید می‌گیرد.' },
    ],
  },
};

export const privacyTitle = (lang: 'en' | 'fa') => TEXT[lang].title;

export function PrivacyNoticeBody({ lang }: { lang: 'en' | 'fa' }) {
  const x = TEXT[lang];
  return (
    <div className="flex flex-col gap-3 text-[14px] leading-relaxed" data-testid="privacy-notice">
      <p className="text-[12px] text-muted">{x.updated}</p>
      {x.sections.map((s) => (
        <section key={s.h}>
          <h3 className="font-semibold">{s.h}</h3>
          <p className="text-muted">{s.p}</p>
        </section>
      ))}
    </div>
  );
}

/** Full-screen version for the sign-in page (no store, no modal component there). */
export function PrivacyNoticeOverlay({ lang, onClose, closeLabel }: { lang: 'en' | 'fa'; onClose: () => void; closeLabel: string }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" role="dialog" aria-modal="true" aria-label={TEXT[lang].title} dir={lang === 'fa' ? 'rtl' : 'ltr'}>
      <div className="gutter mx-auto flex max-w-lg flex-col gap-4 py-8">
        <h2 className="font-display text-3xl">{TEXT[lang].title}</h2>
        <PrivacyNoticeBody lang={lang} />
        <button type="button" className="h-11 rounded-full bg-accent font-semibold text-accent-ink" onClick={onClose} data-testid="privacy-close">
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
