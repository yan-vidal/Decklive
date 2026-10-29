// Relógio e data no fuso do aparelho, com a troca alinhada à virada do minuto.
import { STRINGS, type Lang } from './i18n';

export interface ClockText {
  time: string;
  // AM/PM no formato 12 h; vazio no de 24 h.
  period: string;
  date: string;
}

// Margem depois da virada para getMinutes() já ter mudado.
const TICK_SLACK_MS = 20;

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

export function formatTime(d: Date, hour12: boolean): { time: string; period: string } {
  const h = d.getHours();
  const m = pad2(d.getMinutes());
  if (!hour12) return { time: pad2(h) + ':' + m, period: '' };
  return { time: (h % 12 || 12) + ':' + m, period: h < 12 ? 'AM' : 'PM' };
}

const LOCALES: Record<Lang, string> = { pt: 'pt-BR', en: 'en-US' };
const formatters: Partial<Record<Lang, Intl.DateTimeFormat | null>> = {};

function formatter(lang: Lang): Intl.DateTimeFormat | null {
  if (formatters[lang] === undefined) {
    let f: Intl.DateTimeFormat | null = null;
    try {
      // Navegador de TV sem os dados do idioma cai na tabela própria.
      if (Intl.DateTimeFormat.supportedLocalesOf([LOCALES[lang]]).length > 0) {
        f = new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long', day: 'numeric', month: 'long' });
      }
    } catch (e) {
      f = null;
    }
    formatters[lang] = f;
  }
  return formatters[lang] || null;
}

// Dia da semana, dia e mês por extenso, com a primeira letra maiúscula (como o DeckLock).
export function formatDate(d: Date, lang: Lang): string {
  const f = formatter(lang);
  let text: string;
  if (f) {
    text = f.format(d);
  } else {
    const s = STRINGS[lang];
    const wd = s.weekdays[d.getDay()];
    const mo = s.months[d.getMonth()];
    text = lang === 'pt' ? wd + ', ' + d.getDate() + ' de ' + mo : wd + ', ' + mo + ' ' + d.getDate();
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function msUntilNextMinute(d: Date): number {
  return 60000 - (d.getSeconds() * 1000 + d.getMilliseconds());
}

export class Clock {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private lang: Lang,
    private hour12: () => boolean,
    private render: (text: ClockText) => void,
  ) {}

  // Desenha agora e agenda a próxima virada; chamado também no visibilitychange.
  refresh(): void {
    const now = new Date();
    const t = formatTime(now, this.hour12());
    this.render({ time: t.time, period: t.period, date: formatDate(now, this.lang) });
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, msUntilNextMinute(now) + TICK_SLACK_MS);
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
